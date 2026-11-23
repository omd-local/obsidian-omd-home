import type { AiAnswer } from "./omd-bridge";

export function formatAnswerElapsedTime(elapsedMs: number): string {
  const safeMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (safeMs < 1_000) return `${Math.round(safeMs)}ms`;
  if (safeMs < 10_000) return `${(safeMs / 1_000).toFixed(1)}s`;
  return `${Math.round(safeMs / 1_000)}s`;
}

export function answerSourceCount(answer: Pick<AiAnswer, "evidence">): number {
  return new Set(answer.evidence.map((hit) => hit.path.trim()).filter(Boolean)).size;
}

export function scopedAiAnswerText(answer: Pick<AiAnswer, "text" | "evidence">): string {
  const count = answerSourceCount(answer);
  const body = answer.text.trim().replace(/^Based on \d+ retrieved notes?\.\s*/u, "").trim();
  const text = presentAnswerSections(body, count);
  if (count === 0) return text;
  const scope = count === 1
    ? "Based on 1 retrieved note."
    : `Based on ${count} retrieved notes.`;
  return `${scope}${text ? `\n\n${text}` : ""}`;
}

// The bridge also accepts Markdown formatting around the two provenance labels.
const SECTION_HEADING = /^[ \t]*(?:(?:#{1,6}[ \t]+)?(?:[-*+][ \t]+)?[*_]{0,3}(Source states|Model inference)[*_]{0,3}[ \t]*:?[*_]{0,3}[ \t]*$|(?:#{1,6}[ \t]+)?[*_]{0,3}(Source states|Model inference)[*_]{0,3}[ \t]*:[*_]{0,3}[ \t]*)/gimu;
const EMPTY_INFERENCE = /^(?:none|n\/a|not applicable|no additional inference|无|无额外推断|不适用)$/iu;

function isEmptyInferenceLine(line: string): boolean {
  const claim = line.trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/u, "")
    .replace(/\[\[[^\]\n]+\]\]|\[[SE]\d+(?:\s*,\s*[SE]\d+)*\]/gu, "")
    .replace(/^[\s*_~`]+|[\s*_~`.,!?。！？．，]+$/gu, "");
  return !claim || EMPTY_INFERENCE.test(claim);
}

function presentAnswerSections(text: string, sourceCount: number): string {
  const headings = [...text.matchAll(SECTION_HEADING)];
  const source = headings[0];
  if (source?.index !== 0 || sectionHeadingLabel(source) !== "source states") return text;

  // A label inside a list claim is content, not a section boundary. Inline
  // section labels remain supported only when they begin the answer line.
  const inference = headings
    .find((heading) => heading.index !== source.index && sectionHeadingLabel(heading) === "model inference");

  const hasInference = inference !== undefined;
  const facts = text.slice(source[0].length, hasInference ? inference.index : undefined).trimEnd();
  const sourceLabel = sourceCount === 1 ? "From the note:" : "From your notes:";
  const sourceSeparator = facts && !facts.startsWith("\n") ? " " : "";
  const sourcedText = `${sourceLabel}${sourceSeparator}${facts}`;
  if (!hasInference) return sourcedText;

  const interpretation = text.slice(inference.index + inference[0].length)
    .split("\n")
    .filter((line) => !line.trim() || !isEmptyInferenceLine(line))
    .join("\n")
    .trim();
  return interpretation ? `${sourcedText}\n\nWhat this may mean:\n${interpretation}` : sourcedText;
}

function sectionHeadingLabel(heading: RegExpMatchArray): string {
  return (heading[1] ?? heading[2] ?? "").toLowerCase();
}

export function formatAiAnswerForClipboard(answer: Pick<AiAnswer, "text" | "evidence">): string {
  const text = scopedAiAnswerText(answer);
  const paths = [...new Set(answer.evidence.map((hit) => hit.path.trim()).filter(Boolean))];
  if (!paths.length) return text;
  const sources = paths.map((path, index) => safeClipboardSource(path, index + 1)).join("\n");
  return `${text}\n\nSources:\n${sources}`;
}

function safeClipboardSource(path: string, index: number): string {
  const hasUnsafeDelimiter = [...path].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return "[]|#^\\".includes(character) || codePoint <= 31 || codePoint === 127;
  });
  if (hasUnsafeDelimiter) {
    return `- Source ${index} (filename omitted because it contains Markdown link delimiters)`;
  }
  return `- [[${path}]]`;
}
