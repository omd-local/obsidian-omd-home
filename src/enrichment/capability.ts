import { spawnProcess, type SpawnOptions, type SpawnResult } from "../omd-bridge.ts";
import {
  ENRICH_NOTE_SCHEMA_VERSION,
  validateCapabilityResponse,
  type OmdCapabilities,
} from "./contract.ts";
import { OmdEnrichmentError } from "./errors.ts";
import {
  hasCaptureLanguageOverrides,
  ocrLanguageValue,
  type CaptureRequest,
} from "../capture-request.ts";

const CAPABILITY_TIMEOUT_MS = 5_000;
const CAPABILITY_OUTPUT_LIMIT_BYTES = 16 * 1024;

export type EnrichmentProcessExecutor = (
  command: string,
  args: string[],
  options?: SpawnOptions,
) => Promise<SpawnResult>;

interface CapabilityCacheEntry {
  promise: Promise<OmdCapabilities>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
}

export function omdCapabilityIdentityLabel(
  capability: Pick<OmdCapabilities, "package_version" | "protocol_version" | "build_revision">,
): string {
  const parts: string[] = [];
  if (capability.package_version) parts.push(`package ${capability.package_version}`);
  if (capability.protocol_version !== undefined) parts.push(`protocol v${capability.protocol_version}`);
  if (capability.build_revision) parts.push(`build ${capability.build_revision}`);
  return parts.join(" · ");
}

export class OmdCapabilityService {
  private readonly execute: EnrichmentProcessExecutor;
  private readonly cache = new Map<string, CapabilityCacheEntry>();

  constructor(execute: EnrichmentProcessExecutor = spawnProcess) {
    this.execute = execute;
  }

  async get(executable: string, signal?: AbortSignal): Promise<OmdCapabilities> {
    const fingerprint = executable.trim();
    if (!fingerprint) {
      throw new OmdEnrichmentError("missing_executable", "Set the OMD executable path before using note enrichment.");
    }
    if (signal?.aborted) throw cancelledCapabilityError();
    let entry = this.cache.get(fingerprint);
    if (!entry) {
      entry = this.createCacheEntry(fingerprint);
      this.cache.set(fingerprint, entry);
    }
    entry.waiters += 1;
    try {
      return await waitForCapability(entry.promise, signal);
    } finally {
      entry.waiters -= 1;
      if (signal?.aborted && !entry.settled && entry.waiters === 0) {
        entry.controller.abort();
        this.cache.delete(fingerprint);
      }
    }
  }

  async requireEnrichNote(executable: string, signal?: AbortSignal): Promise<OmdCapabilities> {
    const capability = await this.get(executable, signal);
    if (!capability.enrich_note.supported) {
      throw new OmdEnrichmentError("unsupported_capability", "The configured OMD build does not support note enrichment.");
    }
    if (!capability.enrich_note.schema_versions.includes(ENRICH_NOTE_SCHEMA_VERSION)) {
      throw new OmdEnrichmentError("unsupported_schema", "The configured OMD build does not support enrich-note schema v1.");
    }
    return capability;
  }

  async requireRecognitionCapability(executable: string, signal?: AbortSignal): Promise<OmdCapabilities> {
    const capability = await this.requireEnrichNote(executable, signal);
    if (!capability.capture_language_options?.supported) {
      throw new OmdEnrichmentError(
        "unsupported_capability",
        "The configured OMD build does not advertise capture language options.",
      );
    }
    return capability;
  }

  async ensureSupported(executable: string): Promise<OmdCapabilities> {
    return await this.requireEnrichNote(executable);
  }

  async requireCaptureLanguages(
    executable: string,
    request: Pick<CaptureRequest, "ocr" | "asr">,
    signal?: AbortSignal,
  ): Promise<OmdCapabilities | null> {
    if (!hasCaptureLanguageOverrides(request)) return null;
    let capability: OmdCapabilities;
    try {
      capability = await this.get(executable, signal);
    } catch (error) {
      if (error instanceof OmdEnrichmentError && error.code === "unsupported_capability") {
        throw captureLanguageUpdateError(error);
      }
      throw error;
    }
    const language = capability.capture_language_options;
    if (!language?.supported) throw captureLanguageUpdateError();

    const ocrValue = ocrLanguageValue(request.ocr);
    if (ocrValue) {
      const flags = [language.ocr.argument, ...language.ocr.aliases];
      if (!flags.includes("--ocr-lang")) {
        throw new OmdEnrichmentError(
          "unsupported_schema",
          "The configured OMD build cannot accept OMD Home's --ocr-lang argument. Update OMD or choose No language preference.",
        );
      }
      if (request.ocr.mode === "preset" && !language.ocr.presets.some((preset) => preset.value === ocrValue)) {
        throw new OmdEnrichmentError(
          "unsupported_capability",
          `The configured OMD build does not advertise the ${ocrValue} OCR preset. Update OMD or choose No language preference.`,
        );
      }
      if (ocrValue.includes("+") && (!language.ocr.composite || language.ocr.separator !== "+")) {
        throw new OmdEnrichmentError(
          "unsupported_schema",
          "The configured OMD build does not support composite OCR language packs joined with +. Update OMD or choose No language preference.",
        );
      }
    }

    if (request.asr.mode !== "inherit-adapter-default") {
      if (language.asr.argument !== "--whisper-lang") {
        throw new OmdEnrichmentError(
          "unsupported_schema",
          "The configured OMD build cannot accept OMD Home's --whisper-lang argument. Update OMD or choose No language preference.",
        );
      }
      if (!language.asr.modes.includes(request.asr.mode)) {
        throw new OmdEnrichmentError(
          "unsupported_capability",
          `The configured OMD build does not advertise ASR mode ${request.asr.mode}. Update OMD or choose No language preference.`,
        );
      }
    }
    return capability;
  }

  async retry(executable: string): Promise<OmdCapabilities> {
    this.clear(executable);
    return await this.requireEnrichNote(executable);
  }

  clear(executable?: string): void {
    if (executable === undefined) {
      for (const entry of this.cache.values()) {
        if (!entry.settled) entry.controller.abort();
      }
      this.cache.clear();
      return;
    }
    const fingerprint = executable.trim();
    const entry = this.cache.get(fingerprint);
    if (entry && !entry.settled) entry.controller.abort();
    this.cache.delete(fingerprint);
  }

  cancelActive(executable?: string): void {
    this.clear(executable);
  }

  dispose(): void {
    this.cancelActive();
    this.cache.clear();
  }

  private createCacheEntry(executable: string): CapabilityCacheEntry {
    const controller = new AbortController();
    const entry: CapabilityCacheEntry = {
      controller,
      promise: this.probe(executable, controller.signal),
      waiters: 0,
      settled: false,
    };
    void entry.promise.then(
      () => { entry.settled = true; },
      (error: unknown) => {
        entry.settled = true;
        if (isCancelledError(error) && this.cache.get(executable) === entry) {
          this.cache.delete(executable);
        }
      },
    );
    return entry;
  }

  private async probe(executable: string, signal: AbortSignal): Promise<OmdCapabilities> {
    try {
      const result = await this.execute(executable, ["capabilities", "--json"], {
        signal,
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
    }
  }
}

async function waitForCapability<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await pending;
  if (signal.aborted) throw cancelledCapabilityError();
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelledCapabilityError());
    signal.addEventListener("abort", abort, { once: true });
    void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function cancelledCapabilityError(): OmdEnrichmentError {
  return new OmdEnrichmentError("cancelled", "The OMD capability check was cancelled.");
}

function isCancelledError(error: unknown): boolean {
  return error instanceof OmdEnrichmentError && error.code === "cancelled";
}

function captureLanguageUpdateError(cause?: Error): OmdEnrichmentError {
  return new OmdEnrichmentError(
    "unsupported_capability",
    "The selected recognition preference requires a newer OMD build. Choose No language preference or update OMD.",
    cause ? { cause } : undefined,
  );
}

function looksLikeLegacyOmd(stdout: string, stderr: string): boolean {
  const combined = `${stdout}\n${stderr}`;
  return /\bcapabilities\b.+\bnot found\b/iu.test(combined)
    || /\bthe following arguments are required:\s+input\b/iu.test(combined)
    || /\bomd enrich-note\b/iu.test(combined);
}
