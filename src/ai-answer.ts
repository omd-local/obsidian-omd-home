import type { AiAnswer } from "./omd-bridge";

const COMPARISON_QUERY = /\b(?:across|both|common|overlap|overlapping|shared)\b/iu;
const REJECTED_COMPARISON = /(?:\bno\b[^.\n]{0,48}\boverlap|\bzero\s+overlapping)/iu;

export function formatAnswerElapsedTime(elapsedMs: number): string {
  const safeMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (safeMs < 1_000) return `${Math.round(safeMs)}ms`;
  if (safeMs < 10_000) return `${(safeMs / 1_000).toFixed(1)}s`;
  return `${Math.round(safeMs / 1_000)}s`;
}

export function formatAiAnswerForClipboard(answer: Pick<AiAnswer, "text" | "evidence">): string {
  const text = answer.text.trim();
  const paths = [...new Set(answer.evidence.map((hit) => hit.path.trim()).filter(Boolean))];
  if (!paths.length) return text;
  const sources = paths.map((path) => `- [[${path}]]`).join("\n");
  return `${text}\n\nSources:\n${sources}`;
}

export function guardSparseComparisonAnswer<T extends Pick<AiAnswer, "text" | "evidence">>(
  query: string,
  answer: T,
): T {
  const paths = [...new Set(answer.evidence.map((hit) => hit.path.trim()).filter(Boolean))];
  if (!COMPARISON_QUERY.test(query) || paths.length < 2 || !REJECTED_COMPARISON.test(answer.text)) {
    return answer;
  }
  const sources = paths.map((path) => `[[${path}]]`).join(" and ");
  return {
    ...answer,
    text: `The sparse evidence retrieved both sources, but the local model could not verify a reliable overlap. Treat this comparison as inconclusive and review ${sources}, or retry with a larger local model.`,
  };
}
