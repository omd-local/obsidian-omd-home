import { spawnProcess } from "../omd-bridge.ts";
import {
  validateEnrichEvent,
  validateEnrichResponse,
  type OmdEnrichEvent,
  type OmdEnrichRequest,
  type OmdEnrichResponse,
} from "./contract.ts";
import { mapOmdErrorKind, OmdEnrichmentError } from "./errors.ts";
import type { EnrichmentProcessExecutor } from "./capability.ts";

const RUN_TIMEOUT_MS = 120_000;
const STDOUT_LIMIT_BYTES = 256 * 1024;
const STDERR_LIMIT_BYTES = 256 * 1024;

export interface RunEnrichmentOptions {
  executable: string;
  request: OmdEnrichRequest;
  onEvent?: (event: OmdEnrichEvent) => void;
}

export interface RunEnrichmentResult {
  response: OmdEnrichResponse;
  events: OmdEnrichEvent[];
  terminalEvent: OmdEnrichEvent;
}

export class OmdEnrichmentRunner {
  private readonly execute: EnrichmentProcessExecutor;
  private activeController: AbortController | null = null;
  private generation = 0;

  constructor(execute: EnrichmentProcessExecutor = spawnProcess) {
    this.execute = execute;
  }

  async run(options: RunEnrichmentOptions): Promise<RunEnrichmentResult> {
    this.cancel();
    const runGeneration = ++this.generation;
    const controller = new AbortController();
    this.activeController = controller;
    const events: OmdEnrichEvent[] = [];
    const terminalEvents: OmdEnrichEvent[] = [];
    const streamState: { error: Error | null } = { error: null };

    try {
      const result = await this.execute(
        options.executable.trim(),
        ["enrich-note", "--request-json", "-", "--json-events"],
        {
          stdin: JSON.stringify(options.request),
          signal: controller.signal,
          timeoutMs: RUN_TIMEOUT_MS,
          maxStdoutBytes: STDOUT_LIMIT_BYTES,
          maxStderrBytes: STDERR_LIMIT_BYTES,
          maxStdoutChars: STDOUT_LIMIT_BYTES,
          maxStderrChars: STDERR_LIMIT_BYTES,
          onStderrLine: (line) => {
            if (!line.trim() || streamState.error || runGeneration !== this.generation) return;
            const parsed = parseEnrichEventLine(line);
            if (parsed === null) {
              streamState.error = new OmdEnrichmentError("invalid_event", "OMD emitted malformed enrichment progress output.");
              return;
            }
            let event: OmdEnrichEvent;
            try {
              event = validateEnrichEvent(parsed);
            } catch (error) {
              streamState.error = error instanceof OmdEnrichmentError
                ? error
                : new OmdEnrichmentError("invalid_event", "OMD emitted an invalid enrichment progress event.");
              return;
            }
            if (event.request_id && event.request_id !== options.request.request_id) return;
            events.push(event);
            if (event.event === "done" || event.event === "error") terminalEvents.push(event);
            if (terminalEvents.length > 1) {
              streamState.error = new OmdEnrichmentError("invalid_event", "OMD emitted more than one terminal enrichment event.");
              return;
            }
            options.onEvent?.(event);
          },
        },
      );

      if (streamState.error !== null) {
        const streamError = new OmdEnrichmentError("invalid_event", streamState.error.message, { cause: streamState.error });
        throw streamError;
      }
      const terminal = terminalEvents[0];
      if (result.code !== 0) {
        if (!terminal || terminal.event !== "error") {
          throw new OmdEnrichmentError("invalid_event", "OMD failed without one valid terminal error event.");
        }
        if (typeof terminal.kind === "string") {
          throw mapOmdErrorKind(terminal.kind, options.request.model);
        }
        throw new OmdEnrichmentError("omd_failed", "OMD enrichment failed. Check the OMD setup and try again.");
      }
      if (!terminal || terminal.event !== "done") {
        throw new OmdEnrichmentError("invalid_event", "OMD succeeded without one valid terminal done event.");
      }

      const parsed = parseStrictStdout(result.stdout);
      const candidatePaths = new Map(options.request.candidates.map((candidate) => [candidate.id, candidate]));
      return {
        response: validateEnrichResponse(parsed, options.request, candidatePaths),
        events,
        terminalEvent: terminal,
      };
    } catch (error) {
      if (error instanceof OmdEnrichmentError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new OmdEnrichmentError("cancelled", "OMD enrichment was cancelled.", { cause: error });
      }
      const detail = error instanceof Error ? error.message : "";
      if (/timed out/iu.test(detail)) {
        throw new OmdEnrichmentError("generation_timeout", "The local model timed out while generating suggestions.", { cause: error as Error });
      }
      if (/exceeded/iu.test(detail)) {
        throw new OmdEnrichmentError("output_overflow", "OMD enrichment output exceeded its safety limit.", { cause: error as Error });
      }
      if (/ENOENT|not found|could not find/iu.test(detail)) {
        throw new OmdEnrichmentError("missing_executable", "The configured OMD executable could not be found.", { cause: error as Error });
      }
      throw new OmdEnrichmentError("omd_failed", "OMD enrichment failed. Check the OMD setup and try again.", { cause: error as Error });
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }
  }

  cancel(): void {
    this.generation += 1;
    this.activeController?.abort();
    this.activeController = null;
  }

  dispose(): void {
    this.cancel();
  }
}

export function parseEnrichEventLine(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseStrictStdout(stdout: string): unknown {
  if (!stdout.endsWith("\n")) {
    throw new OmdEnrichmentError("invalid_response", "OMD proposal output must end with a newline.");
  }
  const body = stdout.endsWith("\r\n") ? stdout.slice(0, -2) : stdout.slice(0, -1);
  if (!body) {
    throw new OmdEnrichmentError("invalid_response", "OMD proposal output must contain exactly one JSON object followed by a newline.");
  }
  if (body.includes("\n") || body.includes("\r")) {
    throw new OmdEnrichmentError("invalid_response", "OMD proposal output must not contain more than one line of JSON.");
  }
  if (body.trim() !== body) {
    throw new OmdEnrichmentError("invalid_response", "OMD proposal output must contain exactly one JSON object followed by a newline.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (error) {
    throw new OmdEnrichmentError("invalid_response", "OMD returned malformed proposal JSON.", { cause: error as Error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OmdEnrichmentError("invalid_response", "OMD proposal output must be a JSON object.");
  }
  return parsed;
}
