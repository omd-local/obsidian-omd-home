/** Preserve Markdown offsets while hiding fenced examples from structural matching. */
export function maskFencedMarkdown(markdown: string): string {
  let fenceCharacter = "";
  let fenceLength = 0;
  return markdown.split(/(?<=\n)/u).map((line) => {
    const content = line.replace(/\r?\n$/u, "");
    if (!fenceCharacter) {
      const openingMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(content);
      const opening = openingMatch?.[1] ?? "";
      if (!opening) return line;
      const trailing = openingMatch?.[2] ?? "";
      if (opening[0] === "`" && trailing.includes("`")) return line;
      fenceCharacter = opening[0] ?? "";
      fenceLength = opening.length;
      return maskLineContent(line);
    }

    const closing = new RegExp(`^ {0,3}${fenceCharacter}{${fenceLength},}[ \\t]*$`, "u");
    const masked = maskLineContent(line);
    if (closing.test(content)) {
      fenceCharacter = "";
      fenceLength = 0;
    }
    return masked;
  }).join("");
}

export interface TranscriptReviewMarkers {
  readonly hasHeading: boolean;
  readonly needsReview: boolean;
  readonly warnings: readonly string[];
}

const TRANSCRIPT_WARNING_LINE = /^ {0,3}-[ \t]+\*\*Transcript warning\*\*[ \t]*:[ \t]*(\S(?:.*\S)?)[ \t]*$/iu;
const TRANSCRIPT_STATUS_LINE = /^ {0,3}-[ \t]+\*\*Transcript status\*\*[ \t]*:/iu;
const TRANSCRIPT_NEEDS_REVIEW_LINE = /^ {0,3}-[ \t]+\*\*Transcript status\*\*[ \t]*:[ \t]*Needs review[ \t]*$/iu;
const TRANSCRIPT_QUALITY_HEADING = /^ {0,3}##[ \t]+Transcript quality warning[ \t]*$/iu;

export function transcriptWarningLineValue(line: string): string | null {
  return TRANSCRIPT_WARNING_LINE.exec(line)?.[1] ?? null;
}

export function isTranscriptStatusLine(line: string): boolean {
  return TRANSCRIPT_STATUS_LINE.test(line);
}

export function isTranscriptQualityWarningHeading(line: string): boolean {
  return TRANSCRIPT_QUALITY_HEADING.test(line);
}

/** Parse the shared transcript-review grammar outside fenced examples. */
export function inspectTranscriptReviewMarkers(markdown: string): TranscriptReviewMarkers {
  const structuralMarkdown = maskFencedMarkdown(markdown);
  const lines = structuralMarkdown.split(/\r?\n/u);
  const warnings = lines
    .map(transcriptWarningLineValue)
    .filter((warning): warning is string => warning !== null);
  return {
    hasHeading: lines.some(isTranscriptQualityWarningHeading),
    needsReview: lines.some((line) => TRANSCRIPT_NEEDS_REVIEW_LINE.test(line)),
    warnings,
  };
}

function maskLineContent(line: string): string {
  let masked = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    masked += character === "\r" || character === "\n" ? character : " ";
  }
  return masked;
}
