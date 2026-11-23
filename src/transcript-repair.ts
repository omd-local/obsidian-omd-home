import {
  inspectTranscriptReviewMarkers,
  isTranscriptQualityWarningHeading,
  isTranscriptStatusLine,
  transcriptWarningLineValue,
} from "./markdown-structure.ts";

export interface TranscriptRecognitionContext {
  readonly requested?: string | null;
  readonly detected?: string | null;
}

export interface InvalidTranscriptTail {
  readonly sourceDurationSeconds: number;
  readonly transcriptEndSeconds: number;
  readonly startSeconds: number;
  readonly segmentCount: number;
  readonly segmentLines: readonly string[];
  readonly segmentTexts: readonly string[];
}

export interface TranscriptRepairIssue {
  readonly kind: "invalid-tail" | "quality-warning";
  readonly message: string;
  readonly warnings: readonly string[];
  readonly requestedLanguage: TranscriptRepairLanguage;
  readonly detectedLanguage: string | null;
  readonly sourceDurationSeconds: number | null;
  readonly transcriptEndSeconds: number | null;
  readonly invalidTail: InvalidTranscriptTail | null;
  readonly suggestedRange: TranscriptRepairRange | null;
  readonly segments: readonly TimestampedSegment[];
}

export type TranscriptRepairLanguage = "auto" | "en" | "zh";

export interface TimestampedSegment {
  readonly line: string;
  readonly lineIndex: number;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export type TranscriptRepairRangeReason = "invalid-tail" | "incomplete-tail" | "missing-gap" | "manual-review";

export interface TranscriptRepairRange {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly reason: TranscriptRepairRangeReason;
}

export interface ReplacementTranscriptSegment {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const RESOLVED_BY_TAIL_REPAIR = /(?:unstable repeated-text segments|unusually repeated phrases|extends well beyond the source duration)/iu;

/**
 * Turn OMD's conservative transcript warning into a bounded repair plan. The
 * automatic plan exists only when source duration and timestamp evidence prove
 * that a removable suffix is outside the media boundary.
 */
export function inspectTranscriptRepair(
  markdown: string,
  recognition: TranscriptRecognitionContext = {},
): TranscriptRepairIssue | null {
  const markers = inspectTranscriptReviewMarkers(markdown);
  const warnings = [...markers.warnings];
  if (!markers.hasHeading && !warnings.length && !markers.needsReview) return null;
  const sourceDurationSeconds = metadataNumber(markdown, "Duration");
  const segments = timestampedSegments(markdown);
  const transcriptEndSeconds = segments.reduce((maximum, segment) => Math.max(maximum, segment.end), 0) || null;
  const requestedLanguage = repairLanguage(recognition.requested);
  const detectedLanguage = normalizeLanguage(recognition.detected ?? metadataValue(markdown, "Language"));
  const invalidTail = sourceDurationSeconds === null
    ? null
    : invalidTranscriptTail(markdown, segments, sourceDurationSeconds);
  const languagePrefix = recognition.requested?.trim().toLowerCase() === "auto" && detectedLanguage
    ? `Speech language auto-detect succeeded: ${languageLabel(detectedLanguage)}.`
    : detectedLanguage
      ? `Whisper detected ${languageLabel(detectedLanguage)}.`
      : "Whisper flagged this transcript for review.";

  if (invalidTail) {
    const suggestedRange: TranscriptRepairRange = {
      startSeconds: invalidTail.startSeconds,
      endSeconds: Math.max(invalidTail.sourceDurationSeconds, invalidTail.transcriptEndSeconds),
      reason: "invalid-tail",
    };
    return {
      kind: "invalid-tail",
      message: `${languagePrefix} Whisper generated repeated segments after the source ended. Review the transcript tail before cleaning it.`,
      warnings,
      requestedLanguage,
      detectedLanguage,
      sourceDurationSeconds,
      transcriptEndSeconds,
      invalidTail,
      suggestedRange,
      segments,
    };
  }

  const warningDetail = warnings[0]
    ? ` ${warnings[0]}`
    : " Review the flagged transcript before cleaning it.";
  return {
    kind: "quality-warning",
    message: `${languagePrefix}${warningDetail}`,
    warnings,
    requestedLanguage,
    detectedLanguage,
    sourceDurationSeconds,
    transcriptEndSeconds,
    invalidTail: null,
    suggestedRange: suggestedTranscriptRange(warnings, sourceDurationSeconds, segments),
    segments,
  };
}

/**
 * Replace only timestamp rows that overlap a reviewed range and the exact raw
 * transcript bytes derived from those rows. A missing tail/gap inserts at the
 * adjacent segment boundary instead of rebuilding the whole transcript.
 */
export function replaceTranscriptRange(
  markdown: string,
  range: TranscriptRepairRange,
  replacementSegments: readonly ReplacementTranscriptSegment[],
): string {
  if (!Number.isFinite(range.startSeconds) || !Number.isFinite(range.endSeconds)
    || range.startSeconds < 0 || range.endSeconds <= range.startSeconds) {
    throw new Error("Choose a valid transcript range before applying the repair.");
  }
  const replacements = replacementSegments
    .filter((segment) => segment.text.trim() && Number.isFinite(segment.start) && Number.isFinite(segment.end))
    .map((segment) => ({
      start: Math.max(range.startSeconds, segment.start),
      end: Math.min(range.endSeconds, segment.end),
      text: segment.text.trim(),
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  if (!replacements.length) {
    throw new Error("The selected audio range produced no readable transcript. Nothing was changed.");
  }

  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const endedWithNewline = markdown.endsWith("\n");
  let normalized = markdown.replaceAll("\r\n", "\n");
  const originalSegments = timestampedSegments(normalized);
  if (!originalSegments.length) throw new Error("Timestamped transcript section is missing.");
  const cutSegment = originalSegments.find((segment) => (
    boundaryCutsSegment(range.startSeconds, segment)
    || boundaryCutsSegment(range.endSeconds, segment)
  ));
  if (cutSegment) {
    throw new Error(
      "Align the repair interval to timestamp row boundaries before applying it. Nothing was changed.",
    );
  }
  const selectedIndexes = originalSegments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.end > range.startSeconds && segment.start < range.endSeconds)
    .map(({ index }) => index);
  const selectedStartIndex = selectedIndexes[0] ?? insertionSegmentIndex(originalSegments, range.startSeconds);
  const selectedCount = selectedIndexes.length;

  normalized = replaceRawTranscriptBytes(
    normalized,
    originalSegments,
    selectedIndexes,
    range,
    replacements.map((segment) => segment.text).join(" "),
  );

  const lines = normalized.split("\n");
  const currentSegments = timestampedSegments(normalized);
  const timestampHeading = lines.findIndex((line) => /^### Timestamped[ \t]*$/u.test(line));
  if (timestampHeading < 0) throw new Error("Timestamped transcript section is missing.");
  const insertLine = selectedStartIndex < currentSegments.length
    ? currentSegments[selectedStartIndex]?.lineIndex ?? timestampHeading + 2
    : (currentSegments.at(-1)?.lineIndex ?? timestampHeading) + 1;
  const timestampLines = replacements.map((segment) => (
    `- [${formatTimestamp(segment.start)} → ${formatTimestamp(segment.end)}] ${segment.text}`
  ));
  lines.splice(insertLine, selectedCount, ...timestampLines);
  recordRangeRepair(lines, range, replacements, incompleteWarningIsResolved(lines));
  collapseExcessBlankLines(lines);

  let repaired = lines.join(newline);
  if (endedWithNewline && !repaired.endsWith(newline)) repaired += newline;
  if (!endedWithNewline) repaired = repaired.replace(new RegExp(`${escapeRegex(newline)}$`, "u"), "");
  return repaired;
}

/** Apply only the deterministic tail plan produced for the same Markdown. */
export function repairInvalidTranscriptTail(markdown: string, tail: InvalidTranscriptTail): string {
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const endedWithNewline = markdown.endsWith("\n");
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  removeTimestampedTail(lines, tail.segmentLines);

  removeTranscriptTextSuffix(lines, tail.segmentTexts);
  const repairRecord = `- **Transcript repair**: Removed ${tail.segmentCount} invalid tail segments beyond the ${formatSeconds(tail.sourceDurationSeconds)}s source duration.`;
  const remainingWarnings = lines.filter((line) => {
    const warning = transcriptWarningLineValue(line);
    return warning && !RESOLVED_BY_TAIL_REPAIR.test(warning);
  });

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const warning = transcriptWarningLineValue(lines[index] ?? "");
    if (warning && RESOLVED_BY_TAIL_REPAIR.test(warning)) lines.splice(index, 1);
  }

  const statusIndex = lines.findIndex(isTranscriptStatusLine);
  if (statusIndex >= 0) {
    lines[statusIndex] = remainingWarnings.length
      ? "- **Transcript status**: Needs review"
      : "- **Transcript status**: Repaired after review";
    lines.splice(statusIndex + 1, 0, repairRecord);
  } else {
    const metadataIndex = lines.findIndex((line) => /^## Metadata[ \t]*$/u.test(line));
    if (metadataIndex >= 0) lines.splice(metadataIndex + 1, 0, "", repairRecord);
  }

  if (!remainingWarnings.length) removeQualityWarningSection(lines);
  collapseExcessBlankLines(lines);
  let repaired = lines.join(newline);
  if (endedWithNewline && !repaired.endsWith(newline)) repaired += newline;
  if (!endedWithNewline) repaired = repaired.replace(new RegExp(`${escapeRegex(newline)}$`, "u"), "");
  return repaired;
}

function removeTimestampedTail(lines: string[], expectedTail: readonly string[]): void {
  const headingIndex = lines.findIndex((line) => /^### Timestamped[ \t]*$/u.test(line));
  if (headingIndex < 0) throw new Error("Timestamped transcript section is missing.");
  const segmentIndexes: number[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^#{1,3} /u.test(line)) break;
    if (/^- \[[^\]]+ → [^\]]+\][ \t]*/u.test(line)) segmentIndexes.push(index);
  }
  const tailIndexes = segmentIndexes.slice(-expectedTail.length);
  if (tailIndexes.length !== expectedTail.length
    || tailIndexes.some((lineIndex, index) => lines[lineIndex] !== expectedTail[index])) {
    throw new Error("The transcript changed after the repair preview was created. Nothing was removed.");
  }
  for (const index of tailIndexes.reverse()) lines.splice(index, 1);
}

function invalidTranscriptTail(
  markdown: string,
  segments: readonly TimestampedSegment[],
  sourceDurationSeconds: number,
): InvalidTranscriptTail | null {
  if (segments.length < 3 || sourceDurationSeconds <= 0) return null;
  const definitelyBeyondIndex = segments.findIndex((segment) => segment.start >= Math.ceil(sourceDurationSeconds));
  if (definitelyBeyondIndex < 0) return null;

  const beyond = segments.slice(definitelyBeyondIndex);
  const repeatedText = mostRepeatedText(beyond);
  if (!repeatedText || beyond.filter((segment) => normalizedText(segment.text) === repeatedText).length < 2) return null;

  let startIndex = definitelyBeyondIndex;
  while (startIndex > 0) {
    const previous = segments[startIndex - 1];
    if (!previous || previous.end <= sourceDurationSeconds || normalizedText(previous.text) !== repeatedText) break;
    startIndex -= 1;
  }
  const tail = segments.slice(startIndex);
  const nonEmpty = tail.filter((segment) => normalizedText(segment.text));
  if (nonEmpty.length < 3 || nonEmpty.some((segment) => normalizedText(segment.text) !== repeatedText)) return null;
  const segmentTexts = tail.map((segment) => segment.text.trim()).filter(Boolean);
  if (!transcriptSuffixCanBeRemoved(markdown, segmentTexts)) return null;

  return {
    sourceDurationSeconds,
    transcriptEndSeconds: tail.reduce((maximum, segment) => Math.max(maximum, segment.end), 0),
    startSeconds: tail[0]?.start ?? sourceDurationSeconds,
    segmentCount: tail.length,
    segmentLines: tail.map((segment) => segment.line),
    segmentTexts,
  };
}

export function timestampedSegments(markdown: string): TimestampedSegment[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const headingIndex = lines.findIndex((line) => /^### Timestamped[ \t]*$/u.test(line));
  if (headingIndex < 0) return [];
  const segments: TimestampedSegment[] = [];
  for (let lineIndex = headingIndex + 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (/^#{1,3} /u.test(line)) break;
    const match = /^- \[([^\]]+) → ([^\]]+)\][ \t]*(.*)$/u.exec(line);
    if (!match) continue;
    const start = timestampSeconds(match[1] ?? "");
    const end = timestampSeconds(match[2] ?? "");
    if (start === null || end === null || end < start) continue;
    segments.push({ line, lineIndex, start, end, text: match[3] ?? "" });
  }
  return segments;
}

function suggestedTranscriptRange(
  warnings: readonly string[],
  sourceDurationSeconds: number | null,
  segments: readonly TimestampedSegment[],
): TranscriptRepairRange | null {
  if (sourceDurationSeconds === null || sourceDurationSeconds <= 0 || !segments.length) return null;
  const transcriptEnd = segments.reduce((maximum, segment) => Math.max(maximum, segment.end), 0);
  const incomplete = warnings.some((warning) => /(?:much less time|may be incomplete|captured speech may be incomplete)/iu.test(warning));
  if (incomplete && transcriptEnd < sourceDurationSeconds - 1) {
    return {
      startSeconds: transcriptEnd,
      endSeconds: sourceDurationSeconds,
      reason: "incomplete-tail",
    };
  }

  const boundaries = [
    { start: 0, end: segments[0]?.start ?? 0 },
    ...segments.slice(0, -1).map((segment, index) => ({
      start: segment.end,
      end: segments[index + 1]?.start ?? segment.end,
    })),
    { start: transcriptEnd, end: sourceDurationSeconds },
  ];
  const gap = boundaries
    .filter((candidate) => candidate.end - candidate.start >= Math.max(5, sourceDurationSeconds * 0.08))
    .sort((left, right) => (right.end - right.start) - (left.end - left.start))[0];
  return gap
    ? { startSeconds: gap.start, endSeconds: gap.end, reason: "missing-gap" }
    : null;
}

function insertionSegmentIndex(segments: readonly TimestampedSegment[], startSeconds: number): number {
  const index = segments.findIndex((segment) => segment.start >= startSeconds);
  return index < 0 ? segments.length : index;
}

function boundaryCutsSegment(boundary: number, segment: TimestampedSegment): boolean {
  const tolerance = 0.001;
  return boundary > segment.start + tolerance && boundary < segment.end - tolerance;
}

interface RawSegmentLocation {
  readonly start: number;
  readonly end: number;
}

function replaceRawTranscriptBytes(
  markdown: string,
  segments: readonly TimestampedSegment[],
  selectedIndexes: readonly number[],
  range: TranscriptRepairRange,
  replacement: string,
): string {
  const lines = markdown.split("\n");
  const timestampIndex = lines.findIndex((line) => /^### Timestamped[ \t]*$/u.test(line));
  if (timestampIndex < 0) throw new Error("Timestamped transcript section is missing.");
  let transcriptIndex = -1;
  for (let index = timestampIndex - 1; index >= 0; index -= 1) {
    if (/^## Transcript(?: \(raw\))?[ \t]*$/u.test(lines[index] ?? "")) {
      transcriptIndex = index;
      break;
    }
  }
  if (transcriptIndex < 0) throw new Error("Transcript section is missing.");
  const body = lines.slice(transcriptIndex + 1, timestampIndex).join("\n");
  const locations = locateRawSegmentText(body, segments);
  if (!locations) {
    throw new Error("The timestamped transcript no longer matches the raw transcript. Nothing was changed.");
  }

  let start: number;
  let end: number;
  if (selectedIndexes.length) {
    const first = locations[selectedIndexes[0] ?? -1];
    const last = locations[selectedIndexes.at(-1) ?? -1];
    if (!first || !last) throw new Error("The selected transcript range could not be mapped. Nothing was changed.");
    start = first.start;
    end = last.end;
  } else {
    const previousIndex = findLastIndex(segments, (segment) => segment.end <= range.startSeconds + 0.001);
    const nextIndex = segments.findIndex((segment) => segment.start >= range.endSeconds - 0.001);
    if (previousIndex >= 0) {
      start = locations[previousIndex]?.end ?? body.trimEnd().length;
    } else if (nextIndex >= 0) {
      start = locations[nextIndex]?.start ?? 0;
    } else {
      start = body.trimEnd().length;
    }
    end = start;
  }

  const before = body.slice(0, start);
  const after = body.slice(end);
  const prefix = needsWordSeparator(before, replacement) ? " " : "";
  const suffix = needsWordSeparator(replacement, after) ? " " : "";
  const repairedBody = `${before}${prefix}${replacement}${suffix}${after}`;
  lines.splice(transcriptIndex + 1, timestampIndex - transcriptIndex - 1, ...repairedBody.split("\n"));
  return lines.join("\n");
}

function locateRawSegmentText(
  body: string,
  segments: readonly TimestampedSegment[],
): RawSegmentLocation[] | null {
  const compactBody = compactWithOffsets(body);
  const locations: RawSegmentLocation[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const needle = segment.text.replaceAll(/\s+/gu, "");
    if (!needle) {
      locations.push({ start: compactBody.offsets[cursor]?.start ?? body.length, end: compactBody.offsets[cursor]?.start ?? body.length });
      continue;
    }
    const found = compactBody.value.indexOf(needle, cursor);
    if (found < 0) return null;
    const first = compactBody.offsets[found];
    const last = compactBody.offsets[found + needle.length - 1];
    if (!first || !last) return null;
    locations.push({ start: first.start, end: last.end });
    cursor = found + needle.length;
  }
  return locations;
}

function compactWithOffsets(value: string): { value: string; offsets: Array<{ start: number; end: number }> } {
  let compact = "";
  const offsets: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (/\s/u.test(character)) continue;
    compact += character;
    offsets.push({ start: index, end: index + 1 });
  }
  return { value: compact, offsets };
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) return index;
  }
  return -1;
}

function needsWordSeparator(left: string, right: string): boolean {
  if (/\s$/u.test(left) || /^\s/u.test(right)) return false;
  const leftChar = left.at(-1) ?? "";
  const rightChar = right.at(0) ?? "";
  if (!leftChar || !rightChar || isCjk(leftChar) || isCjk(rightChar)) return false;
  if (/[([{“‘]/u.test(leftChar) || /[.,;:!?)}\]”’]/u.test(rightChar)) return false;
  return true;
}

function isCjk(value: string): boolean {
  return /[\u3400-\u4dbf\u4e00-\u9fff]/u.test(value);
}

function recordRangeRepair(
  lines: string[],
  range: TranscriptRepairRange,
  replacementSegments: readonly ReplacementTranscriptSegment[],
  resolveIncompleteWarning: boolean,
): void {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const warning = transcriptWarningLineValue(lines[index] ?? "") ?? "";
    if (resolveIncompleteWarning
      && /(?:much less time|may be incomplete|captured speech may be incomplete)/iu.test(warning)) {
      lines.splice(index, 1);
    }
  }
  const remainingWarnings = lines.some((line) => transcriptWarningLineValue(line) !== null);
  const repairRecord = `- **Transcript repair**: Re-transcribed ${formatTimestamp(range.startSeconds)}–${formatTimestamp(range.endSeconds)} locally and replaced only the reviewed range (${replacementSegments.length} segment${replacementSegments.length === 1 ? "" : "s"}).`;
  const statusIndex = lines.findIndex(isTranscriptStatusLine);
  if (statusIndex >= 0) {
    lines[statusIndex] = remainingWarnings
      ? "- **Transcript status**: Needs review"
      : "- **Transcript status**: Repaired after review";
    lines.splice(statusIndex + 1, 0, repairRecord);
  } else {
    const metadataIndex = lines.findIndex((line) => /^## Metadata[ \t]*$/u.test(line));
    if (metadataIndex >= 0) lines.splice(metadataIndex + 1, 0, "", repairRecord);
  }
  if (!remainingWarnings) removeQualityWarningSection(lines);
}

function incompleteWarningIsResolved(lines: readonly string[]): boolean {
  const markdown = lines.join("\n");
  const warnings = [...inspectTranscriptReviewMarkers(markdown).warnings];
  if (!warnings.some((warning) => /(?:much less time|may be incomplete|captured speech may be incomplete)/iu.test(warning))) {
    return false;
  }
  const duration = metadataNumber(markdown, "Duration");
  if (duration === null) return false;
  return suggestedTranscriptRange(warnings, duration, timestampedSegments(markdown)) === null;
}

function transcriptSuffixCanBeRemoved(markdown: string, segmentTexts: readonly string[]): boolean {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  try {
    removeTranscriptTextSuffix(lines, segmentTexts);
    return true;
  } catch {
    return false;
  }
}

function removeTranscriptTextSuffix(lines: string[], segmentTexts: readonly string[]): void {
  const timestampIndex = lines.findIndex((line) => /^### Timestamped[ \t]*$/u.test(line));
  if (timestampIndex < 0) throw new Error("Timestamped transcript section is missing.");
  let transcriptIndex = -1;
  for (let index = timestampIndex - 1; index >= 0; index -= 1) {
    if (/^## Transcript(?: \(raw\))?[ \t]*$/u.test(lines[index] ?? "")) {
      transcriptIndex = index;
      break;
    }
  }
  if (transcriptIndex < 0) throw new Error("Transcript section is missing.");

  const body = lines.slice(transcriptIndex + 1, timestampIndex).join("\n");
  let repaired = body.trimEnd();
  for (const text of [...segmentTexts].reverse()) {
    const suffix = new RegExp(`${escapeRegex(text.trim()).replaceAll(/\\\s+/gu, "\\s+")}\\s*$`, "u");
    if (!suffix.test(repaired)) {
      throw new Error("The timestamped tail does not match the transcript text. Nothing was removed.");
    }
    repaired = repaired.replace(suffix, "").trimEnd();
  }
  const replacement = ["", ...repaired.trim().split("\n"), ""];
  lines.splice(transcriptIndex + 1, timestampIndex - transcriptIndex - 1, ...replacement);
}

function removeQualityWarningSection(lines: string[]): void {
  const start = lines.findIndex(isTranscriptQualityWarningHeading);
  if (start < 0) return;
  let end = start + 1;
  while (end < lines.length && !/^## [^#]/u.test(lines[end] ?? "")) end += 1;
  lines.splice(start, end - start);
}

function collapseExcessBlankLines(lines: string[]): void {
  for (let index = lines.length - 1; index >= 2; index -= 1) {
    if (lines[index] === "" && lines[index - 1] === "" && lines[index - 2] === "") lines.splice(index, 1);
  }
}

function metadataValue(markdown: string, label: string): string | null {
  const match = new RegExp(`^- \\*\\*${escapeRegex(label)}\\*\\*: (.+)$`, "mu").exec(markdown);
  return match?.[1]?.trim() || null;
}

function metadataNumber(markdown: string, label: string): number | null {
  const raw = metadataValue(markdown, label)?.replace(/s$/iu, "");
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function timestampSeconds(value: string): number | null {
  const parts = value.trim().split(":").map(Number);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  return (parts[0] ?? 0) * 3_600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
}

function mostRepeatedText(segments: readonly TimestampedSegment[]): string | null {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    const text = normalizedText(segment.text);
    if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function normalizedText(value: string): string {
  return value.normalize("NFKC").replaceAll(/\s+/gu, "").trim().toLowerCase();
}

function normalizeLanguage(value: string | null | undefined): string | null {
  const token = value?.trim().toLowerCase().replaceAll("_", "-").split("-", 1)[0];
  if (!token) return null;
  if (["chi", "chinese", "cmn", "yue", "zho"].includes(token)) return "zh";
  if (["eng", "english"].includes(token)) return "en";
  return token;
}

function repairLanguage(value: string | null | undefined): TranscriptRepairLanguage {
  if (value?.trim().toLowerCase() === "auto") return "auto";
  const language = normalizeLanguage(value);
  return language === "en" || language === "zh" ? language : "auto";
}

function languageLabel(language: string): string {
  if (language === "zh") return "Chinese";
  if (language === "en") return "English";
  return language.toUpperCase();
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function formatTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainder = rounded % 60;
  return hours > 0
    ? [hours, minutes.toString().padStart(2, "0"), remainder.toString().padStart(2, "0")].join(":")
    : [minutes.toString().padStart(2, "0"), remainder.toString().padStart(2, "0")].join(":");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
