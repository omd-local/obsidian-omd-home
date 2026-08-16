import { spawnProcess, type SpawnOptions, type SpawnResult } from "../omd-bridge.ts";
import {
  ENRICH_NOTE_SCHEMA_VERSION,
  validateCapabilityResponse,
  type OmdCapabilities,
} from "./contract.ts";
import { OmdEnrichmentError } from "./errors.ts";

const CAPABILITY_TIMEOUT_MS = 5_000;
const CAPABILITY_OUTPUT_LIMIT_BYTES = 16 * 1024;

export type EnrichmentProcessExecutor = (
  command: string,
  args: string[],
  options?: SpawnOptions,
) => Promise<SpawnResult>;

export class OmdCapabilityService {
  private readonly execute: EnrichmentProcessExecutor;
  private readonly cache = new Map<string, Promise<OmdCapabilities>>();
  private readonly controllers = new Set<AbortController>();

  constructor(execute: EnrichmentProcessExecutor = spawnProcess) {
    this.execute = execute;
  }

  async get(executable: string): Promise<OmdCapabilities> {
    const fingerprint = executable.trim();
    if (!fingerprint) {
      throw new OmdEnrichmentError("missing_executable", "Set the OMD executable path before using note enrichment.");
    }
    let pending = this.cache.get(fingerprint);
    if (!pending) {
      pending = this.probe(fingerprint);
      this.cache.set(fingerprint, pending);
    }
    return await pending;
  }

  async requireEnrichNote(executable: string): Promise<OmdCapabilities> {
    const capability = await this.get(executable);
    if (!capability.enrich_note.supported) {
      throw new OmdEnrichmentError("unsupported_capability", "The configured OMD build does not support note enrichment.");
    }
    if (!capability.enrich_note.schema_versions.includes(ENRICH_NOTE_SCHEMA_VERSION)) {
      throw new OmdEnrichmentError("unsupported_schema", "The configured OMD build does not support enrich-note schema v1.");
    }
    return capability;
  }

  async ensureSupported(executable: string): Promise<OmdCapabilities> {
    return await this.requireEnrichNote(executable);
  }

  async retry(executable: string): Promise<OmdCapabilities> {
    this.clear(executable);
    return await this.requireEnrichNote(executable);
  }

  clear(executable?: string): void {
    if (executable === undefined) this.cache.clear();
    else this.cache.delete(executable.trim());
  }

  cancelActive(executable?: string): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    if (executable !== undefined) this.clear(executable);
  }

  dispose(): void {
    this.cancelActive();
    this.cache.clear();
  }

  private async probe(executable: string): Promise<OmdCapabilities> {
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const result = await this.execute(executable, ["capabilities", "--json"], {
        signal: controller.signal,
        timeoutMs: CAPABILITY_TIMEOUT_MS,
        maxStdoutBytes: CAPABILITY_OUTPUT_LIMIT_BYTES,
        maxStderrBytes: CAPABILITY_OUTPUT_LIMIT_BYTES,
        maxStdoutChars: CAPABILITY_OUTPUT_LIMIT_BYTES,
        maxStderrChars: CAPABILITY_OUTPUT_LIMIT_BYTES,
      });
      if (result.code !== 0) {
        if (looksLikeLegacyOmd(result.stdout, result.stderr)) {
          throw new OmdEnrichmentError(
            "unsupported_capability",
            "The configured OMD executable is too old for capabilities/enrich-note. Point OMD Home at a newer OMD build.",
          );
        }
        throw new OmdEnrichmentError("omd_failed", "OMD could not report its enrichment capabilities.");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.stdout.trim());
      } catch (error) {
        throw new OmdEnrichmentError("capability_invalid_json", "OMD returned an invalid capability response.", { cause: error as Error });
      }
      return validateCapabilityResponse(parsed);
    } catch (error) {
      if (error instanceof OmdEnrichmentError) throw error;
      const detail = error instanceof Error ? error.message : "";
      if (error instanceof Error && error.name === "AbortError") {
        throw new OmdEnrichmentError("cancelled", "The OMD capability check was cancelled.", { cause: error });
      }
      if (/ENOENT|not found|could not find/iu.test(detail)) {
        throw new OmdEnrichmentError("missing_executable", "The configured OMD executable could not be found.", { cause: error as Error });
      }
      if (/timed out/iu.test(detail)) {
        throw new OmdEnrichmentError("capability_timeout", "The OMD capability check timed out after five seconds.", { cause: error as Error });
      }
      if (/exceeded/iu.test(detail)) {
        throw new OmdEnrichmentError("output_overflow", "The OMD capability response exceeded its safety limit.", { cause: error as Error });
      }
      throw new OmdEnrichmentError("omd_failed", "OMD could not report its enrichment capabilities.", { cause: error as Error });
    } finally {
      this.controllers.delete(controller);
    }
  }
}

function looksLikeLegacyOmd(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`;
  return /\bcapabilities\b.+\bnot found\b/iu.test(combined)
    || /\bthe following arguments are required:\s+input\b/iu.test(combined)
    || /\bomd enrich-note\b/iu.test(combined);
}
