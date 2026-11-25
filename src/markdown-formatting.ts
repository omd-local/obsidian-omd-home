import { inspectTranscriptReviewMarkers, maskFencedMarkdown } from "./markdown-structure.ts";

export const FORMATTING_CONFLICT_MESSAGE =
  "The note changed after this preview was created. Generate formatting again; nothing was overwritten.";

export const FORMATTING_NO_CHANGES_MESSAGE =
  "No formatting changes suggested. The note was not changed.";

export const FORMATTING_TRANSCRIPT_QUALITY_MESSAGE =
  "This transcript needs review before formatting. Open Review and repair transcript to resolve its warning, then try again. The note was not changed.";

export const FORMATTING_UNSAFE_OUTPUT_MESSAGE =
  "The formatting result contained an unsafe metadata block. The note was not changed.";

export type MarkdownFormattingApplyResult = "applied" | "conflict" | "no-op";
export type MarkdownFormattingMode = "layout-only" | "transcript-cleanup";
export type MarkdownFormattingScope = "whole-note" | "body-section" | "transcript-section";

export interface MarkdownFormattingTarget {
  readonly mode: MarkdownFormattingMode;
  readonly scope: MarkdownFormattingScope;
  readonly source: string;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}
/** Select the punctuation-aware path for captured transcript sections. */
export function markdownFormattingMode(markdown: string): MarkdownFormattingMode {
  const body = markdownBodyForFormatting(markdown);
  return /^## Transcript[ \t]*$/mu.test(maskFencedMarkdown(body))
    ? "transcript-cleanup"
    : "layout-only";
}

/** Do not let formatting make an explicitly unreliable transcript look trustworthy. */
export function markdownFormattingBlockedReason(markdown: string): string | null {
  const markers = inspectTranscriptReviewMarkers(markdownBodyForFormatting(markdown));
  return (markers.hasHeading || markers.warnings.length > 0 || markers.needsReview)
    ? FORMATTING_TRANSCRIPT_QUALITY_MESSAGE
    : null;
}

/**
 * Limit rich captured notes to the prose section the user asked to improve.
 * Everything outside the returned range is reattached byte-for-byte and never
 * enters the local-model prompt. Ordinary notes without a capture section keep
 * the established whole-body behavior.
 */
export function markdownFormattingTarget(markdown: string): MarkdownFormattingTarget {
  const body = markdownBodyForFormatting(markdown);
  const transcript = levelTwoSectionRange(body, "Transcript");
  if (transcript) {
    return {
      mode: "transcript-cleanup",
      scope: "transcript-section",
      source: body.slice(transcript.start, transcript.end),
      bodyStart: transcript.start,
      bodyEnd: transcript.end,
    };
  }

  const capturedBody = levelTwoSectionRange(body, "Body");
  if (capturedBody) {
    return {
      mode: "layout-only",
      scope: "body-section",
      source: body.slice(capturedBody.start, capturedBody.end),
      bodyStart: capturedBody.start,
      bodyEnd: capturedBody.end,
    };
  }

  return {
    mode: "layout-only",
    scope: "whole-note",
    source: body,
    bodyStart: 0,
    bodyEnd: body.length,
  };
}

/** Reassemble one formatted target without allowing unrelated note regions to drift. */
export function mergeMarkdownFormattingTarget(
  baseline: string,
  target: MarkdownFormattingTarget,
  formattedTarget: string,
): string {
  const original = splitFrontmatter(baseline);
  if (original.body.slice(target.bodyStart, target.bodyEnd) !== target.source) {
    throw new Error(FORMATTING_CONFLICT_MESSAGE);
  }
  const formattedBody = `${original.body.slice(0, target.bodyStart)}${formattedTarget}${original.body.slice(target.bodyEnd)}`;
  return preserveMarkdownFrontmatter(baseline, formattedBody);
}

export function markdownFormattingScopeDescription(scope: MarkdownFormattingScope): string {
  if (scope === "transcript-section") {
    return "Add punctuation and paragraph breaks to the Transcript section. Metadata, images, links, timestamps, and every source word stay unchanged.";
  }
  if (scope === "body-section") {
    return "Improve paragraph and Markdown structure in the Body section. Metadata, images, links, and OCR stay unchanged.";
  }
  return "Improve paragraph and Markdown structure in editable text. Frontmatter stays unchanged; links, code, words, and numbers remain protected.";
}

interface MarkdownVaultWriter<FileRef> {
  process(file: FileRef, transform: (current: string) => string): Promise<string>;
}

class MarkdownFormattingConflictError extends Error {
  constructor() {
    super(FORMATTING_CONFLICT_MESSAGE);
    this.name = "MarkdownFormattingConflictError";
  }
}

/**
 * Give the formatter only the note body. Vault metadata never enters the
 * model prompt, so it cannot be echoed back with damaged delimiters.
 */
export function markdownBodyForFormatting(markdown: string): string {
  return splitFrontmatter(markdown).body;
}

/**
 * Keep vault metadata byte-for-byte stable even if a local model invents a
 * YAML block. Any newly introduced leading delimiter fails closed because it
 * is ambiguous with ordinary Markdown thematic rules and must never be
 * silently stripped from the preview.
 */
export function preserveMarkdownFrontmatter(baseline: string, formatted: string): string {
  const original = splitFrontmatter(baseline);
  const originalBodyStartsWithDelimiter = startsFrontmatterDelimiter(original.body);
  if (originalBodyStartsWithDelimiter) {
    return `${original.frontmatter}${formatted}`;
  }
  if (startsFrontmatterDelimiter(formatted)) {
    throw new Error(FORMATTING_UNSAFE_OUTPUT_MESSAGE);
  }
  return `${original.frontmatter}${formatted}`;
}

/**
 * Apply through Obsidian's serialized vault mutation API. Throwing from the
 * transform aborts the write, which closes the race between a separate read
 * and modify call when an editor or sync changes the note.
 */
export async function applyMarkdownFormattingPreview<FileRef>(
  vault: MarkdownVaultWriter<FileRef>,
  file: FileRef,
  baseline: string,
  formatted: string,
): Promise<MarkdownFormattingApplyResult> {
  if (formatted === baseline) return "no-op";
  try {
    await vault.process(file, (current) => {
      if (current !== baseline) throw new MarkdownFormattingConflictError();
      return formatted;
    });
  } catch (error) {
    if (error instanceof MarkdownFormattingConflictError) return "conflict";
    throw error;
  }
  return "applied";
}

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/u.exec(markdown);
  if (!match) return { frontmatter: "", body: markdown };
  return { frontmatter: match[0], body: markdown.slice(match[0].length) };
}

function startsFrontmatterDelimiter(markdown: string): boolean {
  return /^(?:\uFEFF)?---[ \t]*(?:\r?\n|$)/u.test(markdown);
}

function levelTwoSectionRange(markdown: string, heading: string): { start: number; end: number } | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const searchable = maskFencedMarkdown(markdown);
  const match = new RegExp(`^ {0,3}##[ \\t]+${escapedHeading}[ \\t]*$`, "mu").exec(searchable);
  if (!match || match.index === undefined) return null;
  const nextHeading = /^ {0,3}#{1,2}(?:[ \t]+.*)?$/gmu;
  nextHeading.lastIndex = match.index + match[0].length;
  const next = nextHeading.exec(searchable);
  return { start: match.index, end: next?.index ?? markdown.length };
}
