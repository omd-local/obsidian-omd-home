import type { OmdProgressEvent, OmdSearchHit } from "./model.ts";
import {
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
}

export interface AiAnswer {
  text: string;
  evidence: OmdSearchHit[];
  provider: string;
  model: string;
  usage?: Record<string, number>;
  timing?: Record<string, number>;
}

export class OmdBridge {
  private readonly omdExecutable: () => string;
  private readonly pythonExecutable: () => string;
  private readonly bridgePath: () => string;
  private readonly activeControllers = new Set<AbortController>();

  constructor(
    omdExecutable: () => string,
    pythonExecutable: () => string,
    bridgePath: () => string,
  ) {
    this.omdExecutable = omdExecutable;
    this.pythonExecutable = pythonExecutable;
    this.bridgePath = bridgePath;
  }

  async capture(
    source: string,
    vaultPath: string,
    tags: string[],
    polish: CapturePolishOptions,
    onEvent: (event: OmdProgressEvent) => void,
  ): Promise<string | null> {
    this.assertDesktop();
    const result = await this.spawnManagedProcess(
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
  ): Promise<AiPreview> {
    return await this.callPythonBridge({
      action: "preview_ai", vault: vaultPath, query, provider, model, endpoint, limit: 8,
    }) as unknown as AiPreview;
  }

  async executeAi(
    vaultPath: string,
    query: string,
    provider: string,
    model: string,
    endpoint: string,
    consentGrant: Record<string, unknown> | null,
  ): Promise<AiAnswer> {
    return await this.callPythonBridge({
      action: "execute_ai", vault: vaultPath, query, provider, model, endpoint,
      consent_grant: consentGrant, limit: 8,
    }) as unknown as AiAnswer;
  }

  private async callPythonBridge(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertDesktop();
    const path = this.bridgePath();
    if (!path) throw new Error("Configure the OMD Home Python bridge path in settings");
    const result = await this.spawnManagedProcess(await this.resolvePythonExecutable(), [path], {
      stdin: JSON.stringify(payload),
      timeoutMs: BRIDGE_TIMEOUT_MS,
      maxStdoutChars: DEFAULT_MAX_STDOUT_CHARS,
      maxStderrChars: DEFAULT_MAX_STDERR_CHARS,
    });
    const response = parseBridgeResponse(result.stdout);
    if (result.code !== 0) {
      throw bridgeError(
        response?.ok === false ? response.error : undefined,
        lastUsefulLine(result.stderr) || "OMD Home bridge failed",
      );
    }
    if (!response) throw new Error("OMD Home bridge returned no response");
    if (response.ok !== true) throw bridgeError(response.error, "OMD Home bridge rejected the request");
    return response;
  }

  private async resolvePythonExecutable(): Promise<string> {
    const configured = this.pythonExecutable().trim();
    if (configured) return configured;
    const omd = this.omdExecutable().trim();
    const executable = omd.includes("/")
      ? omd
      : (await this.spawnManagedProcess("/usr/bin/which", [omd], {
        timeoutMs: WHICH_TIMEOUT_MS,
        maxStdoutChars: 16_000,
        maxStderrChars: 16_000,
      })).stdout.trim();
    if (!executable) throw new Error("Could not find the configured OMD executable");
    const runtimeWindow = window as Window & { require?: (id: string) => typeof import("node:fs") };
    if (!runtimeWindow.require) throw new Error("Desktop file APIs are unavailable");
    const firstLine = runtimeWindow.require("node:fs").readFileSync(executable, "utf8").slice(0, 256);
    const interpreter = parsePythonShebang(firstLine);
    if (!interpreter) throw new Error("Could not determine OMD's Python interpreter. Set it in OMD Home settings.");
    return interpreter;
  }

  private assertDesktop(): void {
    if (!isDesktopApp()) throw new Error("This OMD action is available on Mac only in v1");
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
  const env = {
    ...process.env,
    PATH: prependExecutableDirectoryToPath(command, process.env.PATH ?? "", delimiter),
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
    let settled = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutHandle = timeoutMs === undefined
      ? null
      : setTimeout(() => {
        failure = new Error(`Process timed out after ${timeoutMs}ms`);
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      }, timeoutMs);
    const abort = () => {
      failure = abortError();
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    };
    const cleanup = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", abort);
    };
    const failForOverflow = (stream: "stdout" | "stderr", limit: number) => {
      if (failure) return;
      failure = new Error(`Process ${stream} exceeded ${limit} characters`);
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    };
    const failForByteOverflow = (stream: "stdout" | "stderr", limit: number) => {
      if (failure) return;
      failure = new Error(`Process ${stream} exceeded ${limit} bytes`);
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
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
  if (typeof error === "string") {
    const parsed = parseJsonLine(error);
    if (parsed) return bridgeErrorMessage(parsed, error.trim() || fallback);
    return error.trim() || fallback;
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "reason"] as const) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return fallback;
}

function bridgeError(error: unknown, fallback: string): Error {
  return new Error(bridgeErrorMessage(error, fallback), { cause: error });
}

function isDesktopApp(): boolean {
  const runtime = globalThis as typeof globalThis & {
    window?: Window & { require?: (id: string) => unknown };
  };
  return typeof runtime.window?.require === "function";
}

function lastUsefulLine(value: string): string {
  return value.trim().split(/\r?\n/).filter((line) => line && !parseOmdEvent(line)).at(-1) ?? "";
}

export function captureErrorMessage(value: string): string {
  const lines = value.trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    const event = parseOmdEvent(line);
    if (event?.message?.trim()) return event.message.trim();
    if (!event) return line;
  }
  return "OMD capture failed";
}
