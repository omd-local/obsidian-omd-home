import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import type { OmdProgressEvent, OmdSearchHit } from "./model.ts";
import type {
  AnswerModelCompatibilityStatus,
  HostedAiCatalog,
  HostedAiCheckResult,
  HostedAiCredentialState,
} from "./ollama-local-types.ts";
import {
  appendCommonExecutableDirectoriesToPath,
  type CapturePolishOptions,
  omdCaptureArgs,
  parseOmdEvent,
  parsePythonShebang,
  prependExecutableDirectoryToPath,
} from "./omd-events.ts";
import type { CaptureRequest } from "./capture-request.ts";

export interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface SpawnOptions {
  onStderrLine?: (line: string) => void;
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxStdoutChars?: number;
  maxStderrChars?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  shell?: false;
}

const DEFAULT_MAX_STDOUT_CHARS = 1_000_000;
const DEFAULT_MAX_STDERR_CHARS = 256_000;
const BRIDGE_TIMEOUT_MS = 95_000;
const HYBRID_BRIDGE_TIMEOUT_MS = 5 * 60_000;
const CAPTURE_TIMEOUT_MS = 10 * 60_000;
const WHICH_TIMEOUT_MS = 5_000;
const CAPTURE_MANIFEST_CLOCK_SKEW_MS = 1_000;
const CAPTURE_MANIFEST_RETRY_DELAYS_MS = [0, 75, 175, 350] as const;
const MAX_CAPTURE_MANIFEST_BYTES = 1_000_000;
const MAX_CAPTURE_MANIFESTS = 512;
const OMD_PLANNED_OUTPUT_NAME = /^\d{4}-\d{2}-\d{2}-.+-[0-9a-f]{8}\.md$/u;

function normalizeAnswerCompatibility(value: unknown): AnswerModelCompatibilityStatus {
  return value === "supported" || value === "unsupported" || value === "unverified"
    ? value
    : "unverified";
}

export interface AiPreview {
  preview: {
    provider: string;
    model: string;
    capability?: string;
    operation?: string;
    privacy_mode: string;
    destination_domain: string;
    character_count: number;
    estimated_input_tokens: number;
    sends_attachment?: boolean;
    policy_url?: string | null;
    data_handling_summary: string;
  };
  evidence: OmdSearchHit[];
  consent_grant?: Record<string, unknown> | null;
  retrieval_mode?: "sparse" | "hybrid";
  retrieval_model?: string | null;
  warnings?: string[];
}

export interface AiAnswer {
  text: string;
  evidence: OmdSearchHit[];
  provider: string;
  model: string;
  retrieval_mode?: "sparse" | "hybrid";
  retrieval_model?: string | null;
  warnings?: string[];
  usage?: Record<string, number>;
  timing?: Record<string, number>;
  embeddingFallbackModel?: string;
}

export interface HybridRetrievalOptions {
  hybridRetrievalEnabled: boolean;
  embeddingModel: string;
  embeddingModelRevision?: string;
  semanticRerankEnabled: boolean;
}

function normalizeCredential(value: Record<string, unknown> | undefined): HostedAiCredentialState | null {
  if (!value) return null;
  const provider = typeof value.provider === "string" ? value.provider : "";
  const envVar = typeof value.envVar === "string" ? value.envVar : "";
  const source = value.source;
  const keychainSupported = value.keychainSupported;
  if (!provider || !envVar) return null;
  if (source !== "missing" && source !== "env" && source !== "keychain") return null;
  if (typeof keychainSupported !== "boolean") return null;
  return {
    provider: provider as HostedAiCredentialState["provider"],
    envVar,
    source,
    keychainSupported,
    envPresent: typeof value.envPresent === "boolean" ? value.envPresent : source === "env",
    keychainPresent: typeof value.keychainPresent === "boolean" ? value.keychainPresent : source === "keychain",
  };
}

function normalizeSearchHits(value: unknown): OmdSearchHit[] | null {
  if (!Array.isArray(value)) return null;
  const hits: OmdSearchHit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (
      typeof record.path !== "string"
      || typeof record.title !== "string"
      || typeof record.evidence !== "string"
      || typeof record.score !== "number"
      || !Number.isFinite(record.score)
    ) return null;
    hits.push({ path: record.path, title: record.title, evidence: record.evidence, score: record.score });
  }
  return hits;
}

function normalizeAiPreview(value: Record<string, unknown>): AiPreview | null {
  const previewValue = value.preview;
  if (!previewValue || typeof previewValue !== "object" || Array.isArray(previewValue)) return null;
  const preview = previewValue as Record<string, unknown>;
  const requiredStrings = ["provider", "model", "privacy_mode", "destination_domain", "data_handling_summary"] as const;
  if (requiredStrings.some((key) => typeof preview[key] !== "string" || !preview[key].trim())) return null;
  if (
    typeof preview.character_count !== "number"
    || !Number.isFinite(preview.character_count)
    || preview.character_count < 0
    || typeof preview.estimated_input_tokens !== "number"
    || !Number.isFinite(preview.estimated_input_tokens)
    || preview.estimated_input_tokens < 0
  ) return null;
  if (preview.policy_url !== undefined && preview.policy_url !== null && typeof preview.policy_url !== "string") return null;
  if (preview.sends_attachment !== undefined && typeof preview.sends_attachment !== "boolean") return null;
  const evidence = normalizeSearchHits(value.evidence);
  if (!evidence) return null;
  const retrievalMode = value.retrieval_mode;
  if (retrievalMode !== undefined && retrievalMode !== "sparse" && retrievalMode !== "hybrid") return null;
  const retrievalModel = value.retrieval_model;
  if (retrievalModel !== undefined && retrievalModel !== null && typeof retrievalModel !== "string") return null;
  const consentGrant = value.consent_grant;
  if (consentGrant !== undefined && consentGrant !== null && (typeof consentGrant !== "object" || Array.isArray(consentGrant))) return null;
  const warnings = value.warnings;
  if (warnings !== undefined && (!Array.isArray(warnings) || warnings.some((item) => typeof item !== "string"))) return null;
  return {
    preview: {
      provider: preview.provider as string,
      model: preview.model as string,
      capability: typeof preview.capability === "string" ? preview.capability : undefined,
      operation: typeof preview.operation === "string" ? preview.operation : undefined,
      privacy_mode: preview.privacy_mode as string,
      destination_domain: preview.destination_domain as string,
      character_count: preview.character_count,
      estimated_input_tokens: preview.estimated_input_tokens,
      sends_attachment: typeof preview.sends_attachment === "boolean" ? preview.sends_attachment : undefined,
      policy_url: preview.policy_url,
      data_handling_summary: preview.data_handling_summary as string,
    },
    evidence,
    consent_grant: consentGrant as Record<string, unknown> | null | undefined,
    retrieval_mode: retrievalMode,
    retrieval_model: retrievalModel,
    warnings: warnings as string[] | undefined,
  };
}

function normalizeNumberRecord(value: unknown): Record<string, number> | undefined | null {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) return null;
    result[key] = item;
  }
  return result;
}

function normalizeAiAnswer(value: Record<string, unknown>): AiAnswer | null {
  const text = value.text;
  const provider = value.provider;
  const model = value.model;
  if (
    value.grounding_contract_version !== 1
    ||
    typeof text !== "string"
    || !text.trim()
    || typeof provider !== "string"
    || !provider.trim()
    || typeof model !== "string"
    || !model.trim()
  ) return null;
  const evidence = normalizeSearchHits(value.evidence);
  if (!evidence) return null;
  const retrievalMode = value.retrieval_mode;
  if (retrievalMode !== undefined && retrievalMode !== "sparse" && retrievalMode !== "hybrid") return null;
  const retrievalModel = value.retrieval_model;
  if (retrievalModel !== undefined && retrievalModel !== null && typeof retrievalModel !== "string") return null;
  const warnings = value.warnings;
  if (warnings !== undefined && (!Array.isArray(warnings) || warnings.some((item) => typeof item !== "string"))) return null;
  const usage = normalizeNumberRecord(value.usage);
  const timing = normalizeNumberRecord(value.timing);
  if (usage === null || timing === null) return null;
  return {
    text,
    evidence,
    provider,
    model,
    retrieval_mode: retrievalMode,
    retrieval_model: retrievalModel,
    warnings,
    usage,
    timing,
  };
}

function assertGroundedAnswerContract(answer: AiAnswer): void {
  const warnings = new Set(answer.warnings ?? []);
  const missingCitations = warnings.has("answer_citation_coverage_incomplete");
  const invalidSections = warnings.has("answer_provenance_labels_missing");
  if (missingCitations && invalidSections) {
    throw new Error(
      "The answer model omitted claim citations and the required Source states / Model inference format. No unverified answer was shown; try again or ask a narrower question.",
    );
  }
  if (missingCitations) {
    throw new Error("The answer model did not cite every claim from the retrieved notes. No unverified answer was shown; try again or ask a narrower question.");
  }
  if (invalidSections) {
    throw new Error("The answer model did not separate Source states from Model inference in the required format. No unverified answer was shown; try again.");
  }
  if (!answer.evidence.length) {
    throw new Error(
      "The answer model did not return a verifiable grounded answer. No retrieved evidence was attached, so no answer was shown.",
    );
  }
}

const BUNDLED_BRIDGE_BOOTSTRAP = "import json,sys\ns=json.loads(sys.stdin.readline())['source']\nexec(compile(s,'<omd-home-bridge>','exec'))";

export function pythonBridgeArgs(configuredPath: string, embeddedSource: string): string[] {
  const configured = configuredPath.trim();
  if (configured) return [configured];
  if (!embeddedSource.trim()) {
    throw new Error("The OMD Home Python bridge is unavailable. Choose a custom bridge path in settings.");
  }
  return ["-c", BUNDLED_BRIDGE_BOOTSTRAP];
}

export function pythonBridgeStdin(
  configuredPath: string,
  embeddedSource: string,
  payload: Record<string, unknown>,
): string {
  if (configuredPath.trim()) return JSON.stringify(payload);
  return `${JSON.stringify({ source: embeddedSource })}\n${JSON.stringify(payload)}`;
}

export function windowsPythonCandidatesForOmd(omdExecutable: string): string[] {
  const executable = omdExecutable.trim().replaceAll("/", "\\");
  if (!path.win32.isAbsolute(executable)) return [];
  const scriptsDirectory = path.win32.dirname(executable);
  const candidates = [
    path.win32.join(scriptsDirectory, "python.exe"),
    path.win32.join(scriptsDirectory, "python3.exe"),
  ];
  if (path.win32.basename(scriptsDirectory).toLowerCase() === "scripts") {
    const environmentRoot = path.win32.dirname(scriptsDirectory);
    candidates.push(
      path.win32.join(environmentRoot, "python.exe"),
      path.win32.join(environmentRoot, "python3.exe"),
    );
  }
  return [...new Set(candidates)];
}

export async function firstVerifiedWindowsPython(
  omdExecutable: string,
  verify: (candidate: string) => Promise<boolean>,
): Promise<string | null> {
  for (const candidate of windowsPythonCandidatesForOmd(omdExecutable)) {
    if (await verify(candidate)) return candidate;
  }
  return null;
}

export class OmdBridge {
  private readonly omdExecutable: () => string;
  private readonly pythonExecutable: () => string;
  private readonly bridgePath: () => string;
  private readonly embeddedBridgeSource: () => string;
  private readonly activeControllers = new Set<AbortController>();

  constructor(
    omdExecutable: () => string,
    pythonExecutable: () => string,
    bridgePath: () => string,
    embeddedBridgeSource: () => string = () => "",
  ) {
    this.omdExecutable = omdExecutable;
    this.pythonExecutable = pythonExecutable;
    this.bridgePath = bridgePath;
    this.embeddedBridgeSource = embeddedBridgeSource;
  }

  async capture(
    executable: string,
    request: CaptureRequest,
    vaultPath: string,
    polish: CapturePolishOptions,
    onEvent: (event: OmdProgressEvent) => void,
    signal?: AbortSignal,
  ): Promise<string | null> {
    this.assertDesktop();
    const captureStartedAt = Date.now();
    let result: SpawnResult;
    try {
      result = await this.spawnManagedProcess(
        executable,
        omdCaptureArgs(request, vaultPath, polish),
        {
          signal,
          timeoutMs: CAPTURE_TIMEOUT_MS,
          maxStdoutChars: 32_000,
          maxStderrChars: 1_000_000,
          onStderrLine: (line) => {
            const event = parseOmdEvent(line);
            if (event) onEvent(event);
          },
        },
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error(captureProcessErrorMessage(error), { cause: error as Error });
    }
    if (result.code !== 0) throw new Error(captureErrorMessage(result.stderr, request.source));
    const done = result.stderr.split(/\r?\n/).map(parseOmdEvent).findLast((event) => event?.event === "done");
    return await resolveOmdCaptureOutput(done?.output ?? null, request.source, vaultPath, captureStartedAt);
  }

  async search(vaultPath: string, query: string, signal?: AbortSignal): Promise<OmdSearchHit[]> {
    const response = await this.callPythonBridge({ action: "search", vault: vaultPath, query, limit: 10 }, { signal });
    return Array.isArray(response.hits) ? response.hits as OmdSearchHit[] : [];
  }

  async storeHostedApiKey(
    provider: HostedAiCredentialState["provider"],
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<HostedAiCredentialState> {
    const response = await this.callPythonBridge(
      { action: "store_hosted_api_key", provider, api_key: apiKey },
      { signal },
    );
    const credential = normalizeCredential(response.credential as Record<string, unknown> | undefined);
    if (!credential) throw new Error("OMD Home bridge returned an invalid credential state");
    return credential;
  }

  async hostedCredentialState(
    provider: HostedAiCredentialState["provider"],
    signal?: AbortSignal,
  ): Promise<HostedAiCredentialState> {
    const response = await this.callPythonBridge({ action: "hosted_credential_state", provider }, { signal });
    const credential = normalizeCredential(response.credential as Record<string, unknown> | undefined);
    if (!credential) throw new Error("OMD Home bridge returned an invalid credential state");
    return credential;
  }

  async deleteHostedApiKey(
    provider: HostedAiCredentialState["provider"],
    signal?: AbortSignal,
  ): Promise<HostedAiCredentialState> {
    const response = await this.callPythonBridge({ action: "delete_hosted_api_key", provider }, { signal });
    const credential = normalizeCredential(response.credential as Record<string, unknown> | undefined);
    if (!credential) throw new Error("OMD Home bridge returned an invalid credential state");
    return credential;
  }

  async discoverProviderModels(
    provider: HostedAiCredentialState["provider"],
    signal?: AbortSignal,
  ): Promise<HostedAiCatalog> {
    const response = await this.callPythonBridge({ action: "discover_provider_models", provider }, { signal });
    return {
      provider,
      destinationDomain: typeof response.destination_domain === "string" ? response.destination_domain : "",
      models: Array.isArray(response.models) ? response.models.filter((value): value is string => typeof value === "string") : [],
      elapsedSeconds: typeof response.elapsed_seconds === "number" ? response.elapsed_seconds : undefined,
      credential: normalizeCredential(response.credential as Record<string, unknown> | undefined) ?? undefined,
    };
  }

  async checkProviderModel(
    provider: HostedAiCredentialState["provider"],
    model: string,
    signal?: AbortSignal,
  ): Promise<HostedAiCheckResult> {
    const response = await this.callPythonBridge({ action: "check_provider_model", provider, model }, { signal });
    const normalizedAnswerCompatibility = normalizeAnswerCompatibility(response.answer_compatibility);
    const answerContract = typeof response.answer_contract === "string" && response.answer_contract.trim()
      ? response.answer_contract.trim()
      : null;
    const answerCompatibility = normalizedAnswerCompatibility === "supported" && answerContract === null
      ? "unverified"
      : normalizedAnswerCompatibility;
    const backendReason = typeof response.answer_compatibility_reason === "string"
      && response.answer_compatibility_reason.trim()
      ? response.answer_compatibility_reason.trim()
      : null;
    const answerCompatibilityReason = normalizedAnswerCompatibility === "supported" && answerContract === null
      ? `OMD reported ${model} as compatible without identifying the answer contract. Run Check setup after updating OMD.`
      : backendReason ?? `OMD did not verify ${model} against the selected provider's answer contract.`;
    return {
      provider,
      destinationDomain: typeof response.destination_domain === "string" ? response.destination_domain : "",
      models: Array.isArray(response.models) ? response.models.filter((value): value is string => typeof value === "string") : [],
      elapsedSeconds: typeof response.elapsed_seconds === "number" ? response.elapsed_seconds : undefined,
      credential: normalizeCredential(response.credential as Record<string, unknown> | undefined) ?? undefined,
      model: typeof response.model === "string" ? response.model : model,
      available: response.available === true,
      alternativeModels: Array.isArray(response.alternative_models)
        ? response.alternative_models.filter((value): value is string => typeof value === "string")
        : [],
      answerCompatibility,
      answerCompatibilityReason,
      answerContract,
    };
  }

  async previewAi(
    vaultPath: string,
    query: string,
    provider: string,
    model: string,
    endpoint: string,
    retrieval: HybridRetrievalOptions,
    signal?: AbortSignal,
  ): Promise<AiPreview> {
    const response = await this.callPythonBridge({
      action: "preview_ai",
      vault: vaultPath,
      query,
      provider,
      model,
      endpoint,
      limit: 8,
      hybrid_retrieval_enabled: retrieval.hybridRetrievalEnabled,
      embedding_model: retrieval.embeddingModel,
      embedding_model_revision: retrieval.embeddingModelRevision ?? null,
      semantic_rerank_enabled: retrieval.semanticRerankEnabled,
    }, { signal });
    const preview = normalizeAiPreview(response);
    if (!preview) throw new Error("OMD Home bridge returned an invalid AI preview.");
    return preview;
  }

  async executeAi(
    vaultPath: string,
    query: string,
    provider: string,
    model: string,
    endpoint: string,
    consentGranted: boolean,
    consentGrant: Record<string, unknown> | null,
    retrieval: HybridRetrievalOptions,
    signal?: AbortSignal,
  ): Promise<AiAnswer> {
    const response = await this.callPythonBridge({
      action: "execute_ai",
      vault: vaultPath,
      query,
      provider,
      model,
      endpoint,
      consent_granted: consentGranted,
      consent_grant: consentGrant,
      limit: 8,
      hybrid_retrieval_enabled: retrieval.hybridRetrievalEnabled,
      embedding_model: retrieval.embeddingModel,
      embedding_model_revision: retrieval.embeddingModelRevision ?? null,
      semantic_rerank_enabled: retrieval.semanticRerankEnabled,
    }, { signal });
    const answer = normalizeAiAnswer(response);
    if (!answer) {
      throw new Error(
        "OMD Home bridge returned an invalid AI answer. Grounding contract v1 is required; use the bundled bridge or update the custom bridge. No answer was shown.",
      );
    }
    assertGroundedAnswerContract(answer);
    return answer;
  }

  private async callPythonBridge(
    payload: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<Record<string, unknown>> {
    this.assertDesktop();
    const configuredBridgePath = this.bridgePath();
    const embeddedBridgeSource = this.embeddedBridgeSource();
    const args = pythonBridgeArgs(configuredBridgePath, embeddedBridgeSource);
    let result: SpawnResult;
    try {
      result = await this.spawnManagedProcess(await this.resolvePythonExecutable(options.signal), args, {
        stdin: pythonBridgeStdin(configuredBridgePath, embeddedBridgeSource, payload),
        timeoutMs: bridgeTimeoutMs(payload),
        signal: options.signal,
        maxStdoutChars: DEFAULT_MAX_STDOUT_CHARS,
        maxStderrChars: DEFAULT_MAX_STDERR_CHARS,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error(bridgeProcessErrorMessage(error), { cause: error as Error });
    }
    const response = parseBridgeResponse(result.stdout);
    if (result.code !== 0) {
      if (response?.ok === false) throw bridgeError(response.error, "OMD Home bridge failed");
      throw new Error(bridgeProcessFailureMessage(result.stderr, result.code));
    }
    if (!response) throw new Error("OMD Home bridge returned no response");
    if (response.ok !== true) throw bridgeError(response.error, "OMD Home bridge rejected the request");
    return response;
  }

  private async resolvePythonExecutable(signal?: AbortSignal): Promise<string> {
    const configured = this.pythonExecutable().trim();
    if (configured) return configured;
    const omd = this.omdExecutable().trim();
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const executable = /[\\/]/u.test(omd)
      ? omd
      : (await this.spawnManagedProcess(locator, [omd], {
        signal,
        timeoutMs: WHICH_TIMEOUT_MS,
        maxStdoutChars: 16_000,
        maxStderrChars: 16_000,
      })).stdout.trim().split(/\r?\n/u).find(Boolean) ?? "";
    if (!executable) throw new Error("Could not find the detected OMD executable");
    if (process.platform === "win32") {
      const interpreter = await firstVerifiedWindowsPython(executable, async (candidate) => {
        try {
          const result = await this.spawnManagedProcess(candidate, ["--version"], {
            signal,
            timeoutMs: WHICH_TIMEOUT_MS,
            maxStdoutChars: 16_000,
            maxStderrChars: 16_000,
          });
          return result.code === 0 && /\bPython\s+\d+(?:\.\d+)+/u.test(`${result.stdout}\n${result.stderr}`);
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          return false;
        }
      });
      if (!interpreter) {
        throw new Error("Could not find Python beside the detected OMD launcher. Open Advanced OMD paths to choose the environment's python.exe.");
      }
      return interpreter;
    }
    const runtimeWindow = window as Window & { require?: (id: string) => typeof import("node:fs") };
    if (!runtimeWindow.require) throw new Error("Desktop file APIs are unavailable");
    const firstLine = runtimeWindow.require("node:fs").readFileSync(executable, "utf8").slice(0, 256);
    const interpreter = parsePythonShebang(firstLine);
    if (!interpreter) throw new Error("Could not determine OMD's Python interpreter. Open Advanced OMD paths to choose it.");
    return interpreter;
  }

  private assertDesktop(): void {
    if (!isDesktopApp()) throw new Error("This OMD action requires the desktop Obsidian app");
  }

  dispose(): void {
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
  }

  cancelActive(): void { this.dispose(); }

  private async spawnManagedProcess(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult> {
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    if (options.signal?.aborted) {
      controller.abort();
    } else {
      options.signal?.addEventListener("abort", relayAbort, { once: true });
    }
    this.activeControllers.add(controller);
    try {
      return await spawnProcess(command, args, { ...options, signal: controller.signal });
    } finally {
      options.signal?.removeEventListener("abort", relayAbort);
      this.activeControllers.delete(controller);
    }
  }
}

export async function resolveOmdCaptureOutput(
  reportedOutput: string | null,
  source: string,
  vaultRoot: string,
  captureStartedAt: number,
): Promise<string | null> {
  if (!reportedOutput) return null;
  if (!path.isAbsolute(reportedOutput)) return reportedOutput;
  if (!OMD_PLANNED_OUTPUT_NAME.test(path.basename(reportedOutput)) && await isRegularFile(reportedOutput)) {
    return reportedOutput;
  }

  for (const delayMs of CAPTURE_MANIFEST_RETRY_DELAYS_MS) {
    if (delayMs > 0) await pause(delayMs);
    const resolved = await matchingCaptureManifestOutput(reportedOutput, source, vaultRoot, captureStartedAt);
    if (resolved) return resolved;
  }
  return await isRegularFile(reportedOutput) ? reportedOutput : null;
}

async function matchingCaptureManifestOutput(
  reportedOutput: string,
  source: string,
  vaultRoot: string,
  captureStartedAt: number,
): Promise<string | null> {
  try {
    const realVaultRoot = await realpath(vaultRoot);
    const realReportedDirectory = await realpath(path.dirname(reportedOutput));
    if (!isContainedPath(realVaultRoot, realReportedDirectory)) return null;

    const entries = (await readdir(realReportedDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".omd.json"))
      .slice(0, MAX_CAPTURE_MANIFESTS);
    let best: { output: string; updatedAt: number } | null = null;
    for (const entry of entries) {
      const manifestPath = path.join(realReportedDirectory, entry.name);
      const manifestStats = await stat(manifestPath);
      if (manifestStats.size <= 0 || manifestStats.size > MAX_CAPTURE_MANIFEST_BYTES) continue;
      const manifest = parseCaptureManifest(await readFile(manifestPath, "utf8"));
      if (!manifest || !captureManifestMatchesSource(manifest, source)) continue;
      const updatedAt = captureManifestTimestamp(manifest, manifestStats.mtimeMs);
      if (updatedAt < captureStartedAt - CAPTURE_MANIFEST_CLOCK_SKEW_MS) continue;

      const output = typeof manifest.output === "string" ? manifest.output : "";
      if (!path.isAbsolute(output) || path.extname(output).toLowerCase() !== ".md") continue;
      const realOutput = await realpath(output);
      if (path.dirname(realOutput) !== realReportedDirectory || !await isRegularFile(realOutput)) continue;
      if (!best || updatedAt > best.updatedAt) best = { output: realOutput, updatedAt };
    }
    return best?.output ?? null;
  } catch {
    return null;
  }
}

function parseCaptureManifest(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function captureManifestMatchesSource(manifest: Record<string, unknown>, source: string): boolean {
  return manifest.source === source || manifest.local_source_path === source;
}

function captureManifestTimestamp(manifest: Record<string, unknown>, fallback: number): number {
  for (const field of ["updated_at", "created_at"] as const) {
    const value = manifest[field];
    if (typeof value !== "string") continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

async function isRegularFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return !relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function bridgeTimeoutMs(payload: Record<string, unknown>): number {
  const action = typeof payload.action === "string" ? payload.action : "";
  const hybridEnabled = payload.hybrid_retrieval_enabled === true;
  if (hybridEnabled && (action === "preview_ai" || action === "execute_ai")) {
    return HYBRID_BRIDGE_TIMEOUT_MS;
  }
  return BRIDGE_TIMEOUT_MS;
}


export async function spawnProcess(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  const runtimeWindow = window as Window & { require?: (id: string) => typeof import("node:child_process") };
  if (!runtimeWindow.require) throw new Error("Desktop process APIs are unavailable");
  const { spawn } = runtimeWindow.require("node:child_process");
  const delimiter = process.platform === "win32" ? ";" : ":";
  const configuredPath = prependExecutableDirectoryToPath(command, process.env.PATH ?? "", delimiter);
  const env = {
    ...process.env,
    PATH: appendCommonExecutableDirectoriesToPath(
      configuredPath,
      process.env.HOME ?? "",
      delimiter,
      process.platform,
    ),
  };
  return await new Promise((resolve, reject) => {
    const {
      onStderrLine,
      stdin,
      timeoutMs,
      signal,
      maxStdoutChars = DEFAULT_MAX_STDOUT_CHARS,
      maxStderrChars = DEFAULT_MAX_STDERR_CHARS,
      maxStdoutBytes,
      maxStderrBytes,
    } = options;
    const child = spawn(command, args, { env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let pending = "";
    let failure: Error | null = null;
    let stdinFailure: Error | null = null;
    let settled = false;
    let forceKillTimer: number | null = null;
    const timeoutHandle = timeoutMs === undefined
      ? null
      : window.setTimeout(() => {
        failure = new Error(`Process timed out after ${timeoutMs}ms`);
        child.kill("SIGTERM");
        forceKillTimer = window.setTimeout(() => child.kill("SIGKILL"), 1_000);
      }, timeoutMs);
    const abort = () => {
      failure = abortError();
      child.kill("SIGTERM");
      forceKillTimer = window.setTimeout(() => child.kill("SIGKILL"), 1_000);
    };
    const cleanup = () => {
      if (timeoutHandle) window.clearTimeout(timeoutHandle);
      if (forceKillTimer) window.clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
    };
    const failForOverflow = (stream: "stdout" | "stderr", limit: number) => {
      if (failure) return;
      failure = new Error(`Process ${stream} exceeded ${limit} characters`);
      child.kill("SIGTERM");
      forceKillTimer = window.setTimeout(() => child.kill("SIGKILL"), 1_000);
    };
    const failForByteOverflow = (stream: "stdout" | "stderr", limit: number) => {
      if (failure) return;
      failure = new Error(`Process ${stream} exceeded ${limit} bytes`);
      child.kill("SIGTERM");
      forceKillTimer = window.setTimeout(() => child.kill("SIGKILL"), 1_000);
    };
    if (signal?.aborted) {
      abort();
    } else if (signal) {
      signal.addEventListener("abort", abort, { once: true });
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdout.length > maxStdoutChars) failForOverflow("stdout", maxStdoutChars);
      if (maxStdoutBytes !== undefined && stdoutBytes > maxStdoutBytes) failForByteOverflow("stdout", maxStdoutBytes);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      stderrBytes += Buffer.byteLength(chunk, "utf8");
      if (stderr.length > maxStderrChars) {
        failForOverflow("stderr", maxStderrChars);
        return;
      }
      if (maxStderrBytes !== undefined && stderrBytes > maxStderrBytes) {
        failForByteOverflow("stderr", maxStderrBytes);
        return;
      }
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) onStderrLine?.(line);
    });
    child.stdin.on("error", (error: Error) => {
      stdinFailure = error;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (pending) onStderrLine?.(pending);
      if (failure) {
        reject(failure);
        return;
      }
      if (stdinFailure && code === 0) {
        reject(stdinFailure);
        return;
      }
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    if (stdin !== undefined) child.stdin.end(stdin); else child.stdin.end();
  });
}

function abortError(): Error {
  const error = new Error("Process aborted");
  error.name = "AbortError";
  return error;
}

function parseJsonLine(value: string): unknown {
  const line = value.trim().split(/\r?\n/).findLast(Boolean);
  if (!line) return null;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

export function parseBridgeResponse(value: string): Record<string, unknown> | null {
  const parsed = parseJsonLine(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

export function bridgeErrorMessage(error: unknown, fallback: string): string {
  const detail = extractBridgeErrorDetail(error);
  if (!detail) return sanitizeBridgeFallback(fallback);
  return mapBridgeDetailToUserMessage(detail) ?? sanitizeBridgeFallback(fallback);
}

function bridgeError(error: unknown, fallback: string): Error {
  return new Error(bridgeErrorMessage(error, fallback));
}

export function bridgeProcessFailureMessage(stderr: string, code: number): string {
  const detail = extractBridgeErrorDetail(stderr);
  const mapped = detail ? mapBridgeDetailToUserMessage(detail) : null;
  if (mapped) return mapped;
  const exitCode = Number.isInteger(code) && code >= 0 ? code : 1;
  return `OMD Home's Python bridge exited before returning a result (exit ${exitCode}). Check the detected OMD and Python environment, then try again.`;
}

function isDesktopApp(): boolean {
  return typeof window !== "undefined"
    && typeof (window as Window & { require?: (id: string) => unknown }).require === "function";
}

export function captureErrorMessage(value: string, source = ""): string {
  const detail = normalize(value);
  if (
    detail.includes("missingdependencyexception")
    && (detail.includes("pdfconverter") || detail.includes("markitdown[pdf]"))
  ) {
    return "OMD cannot convert PDFs because MarkItDown PDF support is missing. Install markitdown[pdf] in the detected OMD environment, then retry.";
  }
  const lines = value.trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    const event = parseOmdEvent(line);
    if (event) return mapCaptureEventToUserMessage(event, source);
  }
  return "OMD capture failed. Check the OMD setup and try again.";
}

function extractBridgeErrorDetail(error: unknown): BridgeErrorDetail | null {
  if (typeof error === "string") {
    const parsed = parseJsonLine(error);
    if (parsed) return extractBridgeErrorDetail(parsed);
    return { message: error.trim() };
  }
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const detail: BridgeErrorDetail = {};
  for (const key of ["message", "error", "detail", "reason"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      detail.message = value.trim();
      break;
    }
  }
  for (const key of ["type", "kind"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      detail.kind = value.trim();
      break;
    }
  }
  if (typeof record.code === "string" && record.code.trim()) detail.code = record.code.trim();
  if (typeof record.provider === "string" && record.provider.trim()) detail.provider = record.provider.trim();
  const statusCode = record.status_code ?? record.statusCode;
  if (typeof statusCode === "number" && Number.isInteger(statusCode)) detail.statusCode = statusCode;
  if (typeof record.retryable === "boolean") detail.retryable = record.retryable;
  if (typeof record.action === "string" && record.action.trim()) detail.action = record.action.trim();
  return detail.message || detail.kind || detail.code || detail.provider || detail.statusCode ? detail : null;
}

function mapBridgeDetailToUserMessage(detail: BridgeErrorDetail): string | null {
  const tokens = normalize(`${detail.kind ?? ""} ${detail.code ?? ""} ${detail.message ?? ""}`);
  if (!tokens) return null;
  const provider = hostedProviderDisplayName(detail.provider);
  if (detail.code === "credentials_invalid") {
    return `${provider} rejected the developer API key. Replace it in Settings → OMD Home → AI answers, then check setup again.`;
  }
  if (detail.code === "credentials_missing") {
    return `${provider} developer API key is unavailable. Add or replace it in Settings → OMD Home → AI answers, then check setup again.`;
  }
  if (detail.code === "disclosure_unavailable") {
    return "OMD Home could not prepare the exact evidence disclosure. Nothing was sent. Retry the question; if it repeats, run Check OMD setup.";
  }
  if (detail.code === "provider_mismatch") {
    return "The selected provider no longer matches the approved request. Nothing was sent. Review the current provider and evidence, then approve a new request.";
  }
  if (detail.code === "cancelled") {
    return "The AI request was cancelled. Start a new request when you are ready.";
  }
  if (detail.code === "model_unavailable" || detail.code === "model_check_invalid") {
    return `${provider} could not use the selected answer model. Check setup and choose an available model, then try again.`;
  }
  if (detail.code === "timeout") {
    return `${provider} did not respond before the request timed out. Try again.`;
  }
  if (detail.code === "transport_error") {
    return `OMD Home could not connect to ${provider}. Check the network connection and try again.`;
  }
  if (detail.code === "incomplete_response") {
    return `${provider} stopped before completing the answer. Try again or ask a narrower question.`;
  }
  if (detail.code === "refused") {
    return `${provider} declined this request. Revise the question or choose another model.`;
  }
  if (detail.code === "malformed_structured_output") {
    return "The answer model did not provide the required Source states / Model inference structure. No unverified answer was shown; try again.";
  }
  if (detail.code === "malformed_response") {
    return `${provider} returned a response OMD Home could not read. Try again or choose another model.`;
  }
  if (detail.code === "response_too_large") {
    return `${provider} returned more data than OMD Home can safely process. Ask a narrower question and try again.`;
  }
  if (detail.code === "provider_failure") {
    return `${provider} could not complete the request. Check the provider setup and try again.`;
  }
  if (detail.code === "stream_error") {
    return `${provider} stopped while returning the answer. Try again or ask a narrower question.`;
  }
  if (detail.code === "consent_required" || detail.code === "consent_expired" || detail.code === "consent_mismatch" || detail.code === "consent_preview_required") {
    return "The cloud request approval is no longer current. Review the destination and exact evidence again, then approve a new request.";
  }
  if (detail.code === "http_error" || tokens.includes("http error")) {
    const operation = detail.action === "discover_provider_models" || detail.action === "check_provider_model"
      ? "provider setup request"
      : "answer request";
    if (detail.statusCode === 401) {
      return `${provider} rejected the developer API key. Replace the key in Settings → OMD Home → AI answers, then check setup again.`;
    }
    if (detail.statusCode === 403) {
      return `${provider} denied access. Check that the API account and selected model are permitted, then try again.`;
    }
    if (detail.statusCode === 429) {
      return `${provider} is rate-limited or the API account has no available quota. Check the provider account, then try again.`;
    }
    if (typeof detail.statusCode === "number" && detail.statusCode >= 500) {
      return `${provider} is temporarily unavailable (HTTP ${detail.statusCode}). Try again later.`;
    }
    if (detail.statusCode === 400) {
      return `${provider} rejected the ${operation} (HTTP 400). Check that the selected model supports this request, then try again.`;
    }
    return `${provider} rejected the ${operation}${typeof detail.statusCode === "number" ? ` (HTTP ${detail.statusCode})` : ""}. Check the provider setup and try again.`;
  }
  if (tokens.includes("no module named") || tokens.includes("modulenotfounderror")) {
    return "The Python environment used by OMD Home is missing a required module. Use Advanced OMD paths to select the current OMD environment, then try again.";
  }
  if (
    tokens.includes("cannot access provider credentials")
    || tokens.includes("cannot validate provider models")
    || tokens.includes("cannot create cloud consent grants")
    || tokens.includes("cannot run ai answers")
    || tokens.includes("cannot run cloud vault q&a")
  ) {
    return "The detected OMD build is too old for this AI provider. Update OMD, run Check OMD setup, then check the provider setup again.";
  }
  if (tokens.includes("can't open file") || tokens.includes("cannot open file")) {
    return "The configured OMD Home bridge file could not be opened. Use the bundled bridge or choose an existing bridge file.";
  }
  if (tokens.includes("syntaxerror") || tokens.includes("unsupported python") || tokens.includes("requires python")) {
    return "The selected Python version cannot run the OMD Home bridge. Use Advanced OMD paths to select the Python used by the detected OMD executable.";
  }
  if (tokens.includes("permission denied") || tokens.includes("eacces")) {
    return "OMD Home could not start the configured Python bridge because of file permissions.";
  }
  if (tokens.includes("loopback ollama endpoint")) {
    return "OMD Home v1 only permits a local Ollama endpoint.";
  }
  if (
    tokens.includes("does not expose its ai service modules")
    || tokens.includes("fallback execution only through local ollama")
  ) {
    return "This OMD build only supports local Ollama for vault questions.";
  }
  if (tokens.includes("ollama is not reachable at")) {
    return "Ollama is not reachable at the configured local endpoint. Open the Ollama app or start its local service, then try again.";
  }
  if (tokens.includes("ollama rejected the request")) {
    return "Ollama rejected the request. Check the selected local model and try again.";
  }
  if (tokens.includes("ollama returned an empty answer")) {
    return "Ollama returned an empty answer. Try again or choose another local model.";
  }
  if (tokens.includes("ollama returned an incomplete response")) {
    return "The local model ran out of answer space before finishing. Try again; if it repeats, ask a narrower question or choose a larger local model.";
  }
  if (tokens.includes("ollama returned an invalid response")) {
    return "Ollama returned an invalid response. Try again after the local service is ready.";
  }
  if (tokens.includes("the question is too long for the ai context budget")) {
    return "The question is too long for the AI context budget. Shorten it and try again.";
  }
  if (tokens.includes("context budget") || tokens.includes("context_limit_exceeded")) {
    return "The retrieved vault evidence exceeded the local model context budget. OMD Home reduced the evidence selection; try again or ask a narrower question.";
  }
  if (tokens.includes("vault path does not exist")) {
    return "The selected vault could not be read by OMD Home.";
  }
  if (tokens.includes("retrieval root must be an existing directory")) {
    return "The selected vault could not be read by OMD Home.";
  }
  if (tokens.includes("no matched vault body excerpts are available for this question")) {
    return "No relevant vault evidence was found. No model request was sent.";
  }
  if (
    tokens.includes("request must be a json object")
    || tokens.includes("unsupported action")
    || tokens.includes("must be a non-empty string")
    || tokens.includes("limit must be between 1 and 20")
  ) {
    return "OMD Home rejected the request. Check the plugin settings and try again.";
  }
  return null;
}

function hostedProviderDisplayName(value: string | undefined): string {
  if (value === "openai") return "OpenAI";
  if (value === "anthropic") return "Anthropic";
  if (value === "deepseek") return "DeepSeek";
  if (value === "ollama") return "Ollama";
  return "The selected AI provider";
}

function sanitizeBridgeFallback(fallback: string): string {
  const tokens = normalize(fallback);
  if (tokens.includes("returned no response")) return "OMD Home bridge returned no response.";
  if (tokens.includes("rejected the request")) return "OMD Home rejected the request. Check the plugin settings and try again.";
  if (tokens.includes("timed out")) return "OMD Home bridge timed out. Try again.";
  if (tokens.includes("stdout exceeded") || tokens.includes("stderr exceeded")) {
    return "OMD Home bridge output exceeded its safety limit.";
  }
  return "OMD Home bridge failed. Check the local bridge setup and try again.";
}

function bridgeProcessErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "OMD Home bridge was cancelled.";
  const detail = error instanceof Error ? error.message : String(error);
  const tokens = normalize(detail);
  if (tokens.includes("could not find the configured omd executable") || tokens.includes("spawn enoent")) {
    return "The detected OMD executable could not be found. Run Check OMD setup and try again.";
  }
  if (tokens.includes("could not determine omd's python interpreter")) {
    return "OMD Home could not determine OMD's Python interpreter. Open Advanced OMD paths to choose it.";
  }
  if (tokens.includes("could not find python beside the detected omd launcher")) {
    return "Could not find Python beside the detected OMD launcher. Open Advanced OMD paths to choose the environment's python.exe.";
  }
  if (tokens.includes("timed out")) return "OMD Home bridge timed out. Try again.";
  if (tokens.includes("stdout exceeded") || tokens.includes("stderr exceeded")) {
    return "OMD Home bridge output exceeded its safety limit.";
  }
  return sanitizeBridgeFallback(detail);
}

function captureProcessErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "OMD capture was cancelled.";
  const detail = error instanceof Error ? error.message : String(error);
  const tokens = normalize(detail);
  if (tokens.includes("spawn enoent") || tokens.includes("could not find the configured omd executable")) {
    return "The detected OMD executable could not be found. Run Check OMD setup and try again.";
  }
  if (tokens.includes("timed out")) return "OMD capture timed out. Try again.";
  if (tokens.includes("stdout exceeded") || tokens.includes("stderr exceeded")) {
    return "OMD capture output exceeded its safety limit.";
  }
  return "OMD capture failed. Check the OMD setup and try again.";
}

function mapCaptureEventToUserMessage(event: OmdProgressEvent, source = ""): string {
  if (event.kind === "ocr_language_pack_missing") return missingOcrLanguagePackMessage(event);
  const tokens = normalize(`${event.kind ?? ""} ${event.event} ${event.message ?? ""}`);
  if (tokens.includes("cancel")) return "OMD capture was cancelled.";
  if (
    tokens.includes("file_not_found")
    || tokens.includes("file not found")
    || tokens.includes("no such file")
    || tokens.includes("enoent")
  ) {
    const displayedSource = boundedLocalCaptureSource(source);
    return displayedSource
      ? `File not found: ${displayedSource}. Check the filename and location, then try again.`
      : "The selected file does not exist. Check the filename and location, then try again.";
  }
  if (tokens.includes("unsupported_extension") || tokens.includes("unsupported extension")) {
    return "OMD does not support this file type as a capture source. Choose a supported document, media file, or URL.";
  }
  if (tokens.includes("converter created empty output") || tokens.includes("empty output")) {
    return "OMD could not extract readable content from this file. For an image-only PDF, capture its pages as images with OCR or use a PDF with a text layer.";
  }
  if (tokens.includes("playwright") || tokens.includes("browser")) {
    return "OMD could not load the page. Check the local browser capture setup and try again.";
  }
  if (
    tokens.includes("unsupported url")
    || tokens.includes("invalid url")
    || tokens.includes("permission denied")
  ) {
    return "OMD could not read that source. Check the URL or file path and try again.";
  }
  if (tokens.includes("timed out") || tokens.includes("timeout")) return "OMD capture timed out. Try again.";
  return "OMD capture failed. Check the OMD setup and try again.";
}

function boundedLocalCaptureSource(source: string): string {
  const cleaned = Array.from(source, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1F || codePoint === 0x7F ? " " : character;
  }).join("").trim();
  if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(cleaned)) return "";
  return cleaned.length <= 500 ? cleaned : `${cleaned.slice(0, 499)}…`;
}

function missingOcrLanguagePackMessage(event: OmdProgressEvent): string {
  const record = event as unknown as Record<string, unknown>;
  const detail = event.message ?? "";
  const requested = recognitionSummaryValue(record.requested)
    || detail.match(/Requested OCR language:\s*([^.]+)/iu)?.[1]?.trim();
  const missing = recognitionSummaryValue(record.missing)
    || detail.match(/Missing Tesseract language pack\(s\):\s*([^.]+)/iu)?.[1]?.trim();
  const available = recognitionSummaryValue(record.available)
    || detail.match(/Available language packs:\s*(.+)$/iu)?.[1]?.trim();
  const summary = [
    requested ? `Requested: ${boundedRecognitionDetail(requested)}` : "",
    missing ? `Missing: ${boundedRecognitionDetail(missing)}` : "",
    available ? `Available: ${boundedRecognitionDetail(available)}` : "",
  ].filter(Boolean).join(". ");
  const prefix = summary ? `${summary}. ` : "";
  return `OMD image recognition is missing required Tesseract language data. ${prefix}Install the missing packs (macOS Homebrew: brew install tesseract-lang; Linux: install the matching tesseract-ocr-* packages; Windows: add the matching .traineddata files to Tesseract's tessdata directory), then retry.`;
}

function recognitionSummaryValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string").join(", ");
  }
  return "";
}

function boundedRecognitionDetail(value: string): string {
  const printable = [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("");
  return printable.replace(/\s+/gu, " ").trim().slice(0, 240);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

interface BridgeErrorDetail {
  message?: string;
  kind?: string;
  code?: string;
  provider?: string;
  statusCode?: number;
  retryable?: boolean;
  action?: string;
}
