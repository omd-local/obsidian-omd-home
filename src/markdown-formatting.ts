export const FORMATTING_CONFLICT_MESSAGE =
  "The note changed after this preview was created. Generate formatting again; nothing was overwritten.";

export const FORMATTING_NO_CHANGES_MESSAGE =
  "No formatting changes suggested. The note was not changed.";

export const FORMATTING_UNSAFE_OUTPUT_MESSAGE =
  "The formatting result contained an unsafe metadata block. The note was not changed.";

export type MarkdownFormattingApplyResult = "applied" | "conflict" | "no-op";

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
