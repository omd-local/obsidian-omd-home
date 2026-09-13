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
  const text = answer.text.trim().replace(/^Based on \d+ retrieved notes?\.\s*/u, "").trim();
  const count = answerSourceCount(answer);
  if (count === 0) return text;
  const scope = count === 1
    ? "Based on 1 retrieved note."
    : `Based on ${count} retrieved notes.`;
  return `${scope}${text ? `\n\n${text}` : ""}`;
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
