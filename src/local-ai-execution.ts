import { LocalAiError, type LocalAiSnapshot } from "./ollama-local-types.ts";
import { snapshotsMatch } from "./local-ai-readiness.ts";

export async function executeWithLocalAiGate<T>(
  snapshot: LocalAiSnapshot,
  getCurrentSnapshot: () => LocalAiSnapshot,
  gate: (snapshot: LocalAiSnapshot, signal?: AbortSignal) => Promise<void>,
  downstream: (snapshot: LocalAiSnapshot, signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  await gate(snapshot, signal);
  throwIfAborted(signal);
  const currentSnapshot = getCurrentSnapshot();
  if (!snapshotsMatch(snapshot, currentSnapshot)) {
    throw new LocalAiError(
      "snapshot_mismatch",
      "The Local AI settings changed while OMD Home was checking the request. Retry with the current settings.",
    );
  }
  return await downstream(snapshot, signal);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("The Local AI request was cancelled.");
  error.name = "AbortError";
  throw error;
}
