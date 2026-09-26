import type { OmdProgressEvent } from "./model";
import {
  ocrLanguageValue,
  whisperLanguageValue,
  type CaptureRequest,
} from "./capture-request.ts";
import { socialCaptureProvider } from "./omnibox-utils.ts";

export interface CapturePolishOptions {
  enabled: boolean;
  model: string;
  host: string;
}

export interface CaptureSourceAccessOptions {
  douyinCookiesPath: string;
  xhsCookiesPath: string;
}

export function omdCaptureArgs(
  request: CaptureRequest,
  vaultPath: string,
  polish?: CapturePolishOptions,
  sourceAccess?: CaptureSourceAccessOptions,
): string[] {
  const args = ["capture", request.source, "--vault", vaultPath, "--json-events"];
  const cleanTags = request.tags.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean);
  if (cleanTags.length) args.push("--tags", cleanTags.join(","));
  const ocrLanguage = ocrLanguageValue(request.ocr);
  if (ocrLanguage) args.push("--ocr-lang", ocrLanguage);
  const whisperLanguage = whisperLanguageValue(request.asr);
  if (whisperLanguage) args.push("--whisper-lang", whisperLanguage);
  const provider = socialCaptureProvider(request.source);
  const cookiesPath = provider === "douyin"
    ? sourceAccess?.douyinCookiesPath.trim()
    : provider === "xhs" ? sourceAccess?.xhsCookiesPath.trim() : "";
  if (cookiesPath) args.push(provider === "douyin" ? "--douyin-cookies" : "--xhs-cookies", cookiesPath);
  if (request.polish && polish?.enabled) {
    args.push(
      "--polish-md",
      "--polish-md-model", polish.model.trim() || "qwen3:4b-instruct",
      "--polish-md-host", polish.host.trim() || "http://localhost:11434",
    );
  }
  return args;
}

export function parsePythonShebang(value: string): string | null {
  const match = value.split(/\r?\n/, 1)[0]?.match(/^#!\s*(\/\S*python(?:\d+(?:\.\d+)*)?)\s*$/);
  return match?.[1] ?? null;
}

export function prependExecutableDirectoryToPath(
  executable: string,
  currentPath: string,
  delimiter: string,
): string {
  const separator = Math.max(executable.lastIndexOf("/"), executable.lastIndexOf("\\"));
  if (separator <= 0) return currentPath;
  const executableDirectory = executable.slice(0, separator);
  const entries = currentPath.split(delimiter).filter((entry) => entry && entry !== executableDirectory);
  return [executableDirectory, ...entries].join(delimiter);
}

export function appendCommonExecutableDirectoriesToPath(
  currentPath: string,
  homeDirectory: string,
  delimiter: string,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32") return currentPath;
  const commonDirectories = platform === "darwin"
    ? ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"]
    : ["/usr/local/bin"];
  if (homeDirectory.trim()) commonDirectories.push(`${homeDirectory.replace(/\/$/u, "")}/.local/bin`);
  const entries = currentPath.split(delimiter).filter(Boolean);
  for (const directory of commonDirectories) {
    if (!entries.includes(directory)) entries.push(directory);
  }
  return entries.join(delimiter);
}

export function parseOmdEvent(line: string): OmdProgressEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.v !== 1 || typeof value.event !== "string" || typeof value.ts !== "number") {
    return null;
  }
  return value as unknown as OmdProgressEvent;
}

export function sanitizeCaptureProgressEvent(
  event: OmdProgressEvent,
  sensitiveValues: readonly string[] = [],
): OmdProgressEvent {
  const sanitized: OmdProgressEvent = {
    v: 1,
    event: safeProgressToken(event.event, "progress"),
    ts: Number.isFinite(event.ts) ? event.ts : Date.now() / 1_000,
  };
  const kind = typeof event.kind === "string" ? safeProgressToken(event.kind, "") : "";
  if (kind) sanitized.kind = kind;
  if (typeof event.percent === "number" && Number.isFinite(event.percent)) {
    sanitized.percent = Math.min(100, Math.max(0, event.percent));
  }
  for (const field of ["label", "name", "message"] as const) {
    const value = event[field];
    if (typeof value !== "string") continue;
    const safe = safeProgressText(value, sensitiveValues);
    if (safe) sanitized[field] = safe;
  }
  return sanitized;
}

export function shouldSurfaceCaptureEvent(event: OmdProgressEvent): boolean {
  // OMD currently emits `done` when the converter finishes writing its
  // temporary route path. The capture command still has to rename the note,
  // write frontmatter and its sidecar, and update the vault index. OMD Home
  // owns the user-visible terminal event after those steps and Inbox marking.
  return event.event !== "done";
}

export function captureWorkflowDoneEvent(output: string, now = Date.now()): OmdProgressEvent {
  return {
    v: 1,
    event: "done",
    kind: "done",
    ts: now / 1_000,
    message: "Saved to OMD Inbox",
    output,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeProgressToken(value: string, fallback: string): string {
  const token = value.trim();
  return token.length <= 64 && /^[A-Za-z0-9_.:-]+$/u.test(token) ? token : fallback;
}

function safeProgressText(value: string, sensitiveValues: readonly string[]): string {
  let safe = value;
  for (const sensitive of sensitiveValues) {
    const token = sensitive.trim();
    if (token) safe = safe.split(token).join("[local access file]");
  }
  safe = [...safe].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("").replace(/\s+/gu, " ").trim();
  return safe.slice(0, 240);
}
