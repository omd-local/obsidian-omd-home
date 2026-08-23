import type { OmdProgressEvent, OmdSearchHit } from "./model.ts";
import { guardSparseComparisonAnswer } from "./ai-answer.ts";
import {
  appendCommonExecutableDirectoriesToPath,
  type CapturePolishOptions,
  omdCaptureArgs,
  parseOmdEvent,
  parsePythonShebang,
  prependExecutableDirectoryToPath,
} from "./omd-events.ts";

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
}

const DEFAULT_MAX_STDOUT_CHARS = 1_000_000;
const DEFAULT_MAX_STDERR_CHARS = 256_000;
const BRIDGE_TIMEOUT_MS = 95_000;
const CAPTURE_TIMEOUT_MS = 10 * 60_000;
const WHICH_TIMEOUT_MS = 5_000;

export interface AiPreview {
  preview: {
    provider: string;
    model: string;
    privacy_mode: string;
    destination_domain: string;
    character_count: number;
    estimated_input_tokens: number;
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
}

export interface HybridRetrievalOptions {
  hybridRetrievalEnabled: boolean;
  embeddingModel: string;
  semanticRerankEnabled: boolean;
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
    source: string,
    vaultPath: string,
    tags: string[],
    polish: CapturePolishOptions,
    onEvent: (event: OmdProgressEvent) => void,
  ): Promise<string | null> {
    this.assertDesktop();
    let result: SpawnResult;
    try {
      result = await this.spawnManagedProcess(
        this.omdExecutable(),
        omdCaptureArgs(source, vaultPath, tags, polish),
        {
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
      throw new Error(captureProcessErrorMessage(error), { cause: error as Error });
    }
    if (result.code !== 0) throw new Error(captureErrorMessage(result.stderr));
    const done = result.stderr.split(/\r?\n/).map(parseOmdEvent).findLast((event) => event?.event === "done");
    return done?.output ?? null;
  }

  async search(vaultPath: string, query: string): Promise<OmdSearchHit[]> {
    const response = await this.callPythonBridge({ action: "search", vault: vaultPath, query, limit: 10 });
    return Array.isArray(response.hits) ? response.hits as OmdSearchHit[] : [];
  }

  async previewAi(
    vaultPath: string,
    query: string,
    provider: string,
    model: string,
    endpoint: string,
    retrieval: HybridRetrievalOptions,
  ): Promise<AiPreview> {
    return await this.callPythonBridge({
      action: "preview_ai",
      vault: vaultPath,
      query,
      provider,
      model,
      endpoint,
      limit: 8,
      hybrid_retrieval_enabled: retrieval.hybridRetrievalEnabled,
      embedding_model: retrieval.embeddingModel,
      semantic_rerank_enabled: retrieval.semanticRerankEnabled,
    }) as unknown as AiPreview;
  }

  async executeAi(
    vaultPath: string,
    query: string,
    provider: string,
    model: string,
    endpoint: string,
    consentGrant: Record<string, unknown> | null,
    retrieval: HybridRetrievalOptions,
  ): Promise<AiAnswer> {
    const answer = await this.callPythonBridge({
      action: "execute_ai",
      vault: vaultPath,
      query,
      provider,
      model,
      endpoint,
      consent_grant: consentGrant,
      limit: 8,
      hybrid_retrieval_enabled: retrieval.hybridRetrievalEnabled,
      embedding_model: retrieval.embeddingModel,
      semantic_rerank_enabled: retrieval.semanticRerankEnabled,
    }) as unknown as AiAnswer;
    return guardSparseComparisonAnswer(query, answer);
  }

  private async callPythonBridge(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertDesktop();
    const configuredBridgePath = this.bridgePath();
    const embeddedBridgeSource = this.embeddedBridgeSource();
    const args = pythonBridgeArgs(configuredBridgePath, embeddedBridgeSource);
    let result: SpawnResult;
    try {
      result = await this.spawnManagedProcess(await this.resolvePythonExecutable(), args, {
        stdin: pythonBridgeStdin(configuredBridgePath, embeddedBridgeSource, payload),
        timeoutMs: BRIDGE_TIMEOUT_MS,
        maxStdoutChars: DEFAULT_MAX_STDOUT_CHARS,
        maxStderrChars: DEFAULT_MAX_STDERR_CHARS,
      });
    } catch (error) {
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

  private async resolvePythonExecutable(): Promise<string> {
    const configured = this.pythonExecutable().trim();
    if (configured) return configured;
    const omd = this.omdExecutable().trim();
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const executable = /[\\/]/u.test(omd)
      ? omd
      : (await this.spawnManagedProcess(locator, [omd], {
        timeoutMs: WHICH_TIMEOUT_MS,
        maxStdoutChars: 16_000,
        maxStderrChars: 16_000,
      })).stdout.trim().split(/\r?\n/u).find(Boolean) ?? "";
    if (!executable) throw new Error("Could not find the configured OMD executable");
    const runtimeWindow = window as Window & { require?: (id: string) => typeof import("node:fs") };
    if (!runtimeWindow.require) throw new Error("Desktop file APIs are unavailable");
    const firstLine = runtimeWindow.require("node:fs").readFileSync(executable, "utf8").slice(0, 256);
    const interpreter = parsePythonShebang(firstLine);
    if (!interpreter) throw new Error("Could not determine OMD's Python interpreter. Set it in OMD Home settings.");
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
    this.activeControllers.add(controller);
    try {
      return await spawnProcess(command, args, { ...options, signal: controller.signal });
    } finally {
      this.activeControllers.delete(controller);
    }
  }
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
  return new Error(bridgeErrorMessage(error, fallback), { cause: error });
}

export function bridgeProcessFailureMessage(stderr: string, code: number): string {
  const detail = extractBridgeErrorDetail(stderr);
  const mapped = detail ? mapBridgeDetailToUserMessage(detail) : null;
  if (mapped) return mapped;
  const exitCode = Number.isInteger(code) && code >= 0 ? code : 1;
  return `OMD Home's Python bridge exited before returning a result (exit ${exitCode}). Check the configured OMD executable and Python environment, then try again.`;
}

function isDesktopApp(): boolean {
  return typeof window !== "undefined"
    && typeof (window as Window & { require?: (id: string) => unknown }).require === "function";
}

export function captureErrorMessage(value: string): string {
  const detail = normalize(value);
  if (
    detail.includes("missingdependencyexception")
    && (detail.includes("pdfconverter") || detail.includes("markitdown[pdf]"))
  ) {
    return "OMD cannot convert PDFs because MarkItDown PDF support is missing. Install markitdown[pdf] in the configured OMD environment, then retry.";
  }
  const lines = value.trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    const event = parseOmdEvent(line);
    if (event) return mapCaptureEventToUserMessage(event);
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
  for (const key of ["type", "kind", "code"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      detail.kind = value.trim();
      break;
    }
  }
  return detail.message || detail.kind ? detail : null;
}

function mapBridgeDetailToUserMessage(detail: BridgeErrorDetail): string | null {
  const tokens = normalize(`${detail.kind ?? ""} ${detail.message ?? ""}`);
  if (!tokens) return null;
  if (tokens.includes("no module named") || tokens.includes("modulenotfounderror")) {
    return "The Python environment used by OMD Home is missing a required module. Point the OMD executable to the current OMD environment, then try again.";
  }
  if (tokens.includes("can't open file") || tokens.includes("cannot open file")) {
    return "The configured OMD Home bridge file could not be opened. Use the bundled bridge or choose an existing bridge file.";
  }
  if (tokens.includes("syntaxerror") || tokens.includes("unsupported python") || tokens.includes("requires python")) {
    return "The configured Python version cannot run the OMD Home bridge. Point OMD Home to the Python used by the current OMD executable.";
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
    return "Ollama is not reachable at the configured local endpoint. Start Ollama and try again.";
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
  if (tokens.includes("context budget") || tokens.includes("context_limit_exceeded")) {
    return "The retrieved vault evidence exceeded the local model context budget. OMD Home reduced the evidence selection; try again or ask a narrower question.";
  }
  if (tokens.includes("vault path does not exist")) {
    return "The selected vault could not be read by OMD Home.";
  }
  if (tokens.includes("retrieval root must be an existing directory")) {
    return "The selected vault could not be read by OMD Home.";
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
    return "The configured OMD executable could not be found.";
  }
  if (tokens.includes("could not determine omd's python interpreter")) {
    return "OMD Home could not determine OMD's Python interpreter. Set it in settings.";
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
    return "The configured OMD executable could not be found.";
  }
  if (tokens.includes("timed out")) return "OMD capture timed out. Try again.";
  if (tokens.includes("stdout exceeded") || tokens.includes("stderr exceeded")) {
    return "OMD capture output exceeded its safety limit.";
  }
  return "OMD capture failed. Check the OMD setup and try again.";
}

function mapCaptureEventToUserMessage(event: OmdProgressEvent): string {
  const tokens = normalize(`${event.kind ?? ""} ${event.event} ${event.message ?? ""}`);
  if (tokens.includes("cancel")) return "OMD capture was cancelled.";
  if (tokens.includes("playwright") || tokens.includes("browser")) {
    return "OMD could not load the page. Check the local browser capture setup and try again.";
  }
  if (
    tokens.includes("no such file")
    || tokens.includes("enoent")
    || tokens.includes("unsupported url")
    || tokens.includes("invalid url")
    || tokens.includes("permission denied")
  ) {
    return "OMD could not read that source. Check the URL or file path and try again.";
  }
  if (tokens.includes("timed out") || tokens.includes("timeout")) return "OMD capture timed out. Try again.";
  return "OMD capture failed. Check the OMD setup and try again.";
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

interface BridgeErrorDetail {
  message?: string;
  kind?: string;
}
