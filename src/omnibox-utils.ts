import { homedir } from "node:os";

export const MAX_CAPTURE_SOURCE_INPUT_CHARS = 16_384;
export const MAX_LOCAL_ACCESS_PATH_CHARS = 4_096;

export type SocialCaptureProvider = "douyin" | "xhs";

export interface ParsedCaptureSource {
  source: string;
  submittedSource?: string;
}

export function looksCapturable(value: string): boolean {
  const submitted = value.trim();
  const source = normalizeCaptureSource(submitted);
  return /^https?:\/\//iu.test(source)
    || /https?:\/\//iu.test(submitted)
    || /\b[a-z][a-z0-9+.-]*:\/\//iu.test(submitted)
    || source.startsWith("/")
    || /^[A-Za-z]:[\\/]/u.test(source)
    || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(source);
}

export function isLocalImageSource(value: string): boolean {
  const source = normalizeCaptureSource(value);
  return source.startsWith("/") && /\.(?:png|jpe?g|webp|tiff|bmp)$/iu.test(source);
}

export function normalizeCaptureSource(value: string): string {
  const trimmed = value.trim();
  const unquoted = unquote(trimmed);
  if (/^file:\/\//iu.test(unquoted)) {
    try {
      return decodeURIComponent(new URL(unquoted).pathname);
    } catch {
      return unquoted;
    }
  }
  if (/^https?:\/\//iu.test(unquoted)) return unquoted;
  const normalizedPath = unquoted.replace(/\\ /gu, " ");
  return normalizedPath.startsWith("~/")
    ? `${homedir()}/${normalizedPath.slice(2)}`
    : normalizedPath;
}

export function parseCaptureSourceInput(value: string): ParsedCaptureSource {
  if (value.includes("\0")) throw new Error("The capture source contains an unsupported null character.");
  if (value.length > MAX_CAPTURE_SOURCE_INPUT_CHARS) {
    throw new Error(`The capture source is too long. Keep it under ${MAX_CAPTURE_SOURCE_INPUT_CHARS.toLocaleString()} characters.`);
  }
  const submitted = value.trim();
  if (!submitted) throw new Error("Enter one HTTP(S) URL or an absolute local file path.");

  const whole = normalizeCaptureSource(submitted);
  if (whole.startsWith("/") || isWindowsAbsolutePath(whole)) return { source: whole };
  if (/^https?:\/\/\S+$/iu.test(whole)) {
    return { source: validateHttpUrl(whole) };
  }

  const httpCandidates = extractHttpUrlCandidates(submitted);
  if (httpCandidates.length > 1) {
    throw new Error("Found more than one HTTP(S) URL. Keep only the link you want to capture.");
  }
  if (httpCandidates.length === 1) {
    const source = validateHttpUrl(httpCandidates[0]);
    if (!socialCaptureProvider(source)) {
      throw new Error("Pasted share text is supported for Douyin and Xiaohongshu / Rednote. Paste other web links by themselves.");
    }
    return source === submitted ? { source } : { source, submittedSource: submitted };
  }
  if (/\b[a-z][a-z0-9+.-]*:\/\//iu.test(submitted)) {
    throw new Error("Only HTTP(S) links can be captured from pasted share text.");
  }
  throw new Error("Enter one HTTP(S) URL or an absolute local file path.");
}

export function captureSourceInputError(value: string): string | null {
  try {
    parseCaptureSourceInput(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Enter one HTTP(S) URL or an absolute local file path.";
  }
}

export function socialCaptureProvider(value: string): SocialCaptureProvider | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (hostMatches(hostname, ["douyin.com", "iesdouyin.com"])) return "douyin";
  if (hostMatches(hostname, ["xiaohongshu.com", "xhslink.com", "rednote.com"])) return "xhs";
  return null;
}

export function isXhsShortlinkSource(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  return hostMatches(hostname, ["xhslink.com"]);
}

export function normalizeLocalAccessPath(value: string): string {
  if (value.includes("\0")) throw new Error("The cookies path contains an unsupported null character.");
  if (value.length > MAX_LOCAL_ACCESS_PATH_CHARS) throw new Error("The cookies path is too long.");
  if (!value.trim()) return "";
  const normalized = normalizeCaptureSource(value);
  if (!normalized.startsWith("/") && !isWindowsAbsolutePath(normalized)) {
    throw new Error("Choose an absolute local cookies.txt path.");
  }
  return normalized;
}

export function localAccessPathError(value: string): string | null {
  try {
    normalizeLocalAccessPath(value);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Choose an absolute local cookies.txt path.";
  }
}

function extractHttpUrlCandidates(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s<>"'`]+/giu) ?? [];
  return matches
    .map((candidate) => candidate.replace(/[\])}>,.!?;:，。！？；：】）》」』]+$/gu, ""))
    .filter(Boolean);
}

function validateHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("The HTTP(S) URL is not valid.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    throw new Error("Only a valid HTTP(S) URL can be captured from pasted share text.");
  }
  return value;
}

function hostMatches(hostname: string, domains: readonly string[]): boolean {
  return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(value);
}

export function captureSourceFromDrop(
  desktopPath: string,
  uriList: string,
  plainText: string,
): string {
  const uri = uriList
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) ?? "";
  const candidate = normalizeCaptureSource(desktopPath || uri || plainText);
  return looksCapturable(candidate) ? candidate : "";
}

interface DroppedFileWebUtils {
  getPathForFile(file: File): string;
}

export function captureSourceFromDataTransfer(
  dataTransfer: DataTransfer | null,
  webUtils: DroppedFileWebUtils | null = desktopFileWebUtils(),
): string {
  const file = dataTransfer?.files?.[0];
  let desktopPath = "";
  if (file) {
    try {
      desktopPath = webUtils?.getPathForFile(file) ?? "";
    } catch {
      desktopPath = "";
    }
    if (!desktopPath) {
      const legacyPath = (file as File & { path?: unknown }).path;
      desktopPath = typeof legacyPath === "string" ? legacyPath : "";
    }
  }
  return captureSourceFromDrop(
    desktopPath,
    dataTransfer?.getData("text/uri-list") ?? "",
    dataTransfer?.getData("text/plain") ?? "",
  );
}

function desktopFileWebUtils(): DroppedFileWebUtils | null {
  try {
    const runtimeWindow = window as Window & { require?: (id: string) => unknown };
    const electron = runtimeWindow.require?.("electron") as {
      webUtils?: DroppedFileWebUtils;
    } | undefined;
    return electron?.webUtils ?? null;
  } catch {
    return null;
  }
}

export function isRecordingToggleCommandName(value: string): boolean {
  return /^(?:start\/stop|toggle) (?:audio )?recording$/iu.test(value.trim());
}

export function recordingCommandKind(id: string, name: string): "start" | "stop" | "toggle" | null {
  if (id === "audio-recorder:start") return "start";
  if (id === "audio-recorder:stop") return "stop";
  return isRecordingToggleCommandName(name) ? "toggle" : null;
}

export interface RecordingCommandRef {
  id: string;
  name: string;
}

export interface RecordingQuickAction {
  id: string;
  label: "Recording" | "Start recording" | "Stop recording";
  icon: "mic" | "square";
}

export function isPluginRecordingWrapperCommand(id: string, pluginId: string): boolean {
  return id === `${pluginId}:toggle-recording`
    || id === `${pluginId}:start-recording`
    || id === `${pluginId}:stop-recording`;
}

export function resolveRecordingCommand(
  commands: RecordingCommandRef[],
  kind: "start" | "stop" | "toggle",
): RecordingCommandRef | null {
  const resolved: Partial<Record<"start" | "stop" | "toggle", RecordingCommandRef>> = {};
  for (const command of commands) {
    const commandKind = recordingCommandKind(command.id, command.name);
    if (commandKind && !resolved[commandKind]) resolved[commandKind] = command;
  }

  if (kind === "toggle") return resolved.toggle ?? null;
  if (resolved.toggle) return null;
  return resolved[kind] ?? null;
}

export function recordingQuickActions(commands: RecordingCommandRef[]): RecordingQuickAction[] {
  const toggle = resolveRecordingCommand(commands, "toggle");
  if (toggle) {
    return [{ id: toggle.id, label: "Recording", icon: "mic" }];
  }

  const actions: RecordingQuickAction[] = [];
  const start = resolveRecordingCommand(commands, "start");
  const stop = resolveRecordingCommand(commands, "stop");
  if (start) actions.push({ id: start.id, label: "Start recording", icon: "mic" });
  if (stop) actions.push({ id: stop.id, label: "Stop recording", icon: "square" });
  return actions;
}

export function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Quick note";
}

function unquote(value: string): string {
  if (value.length >= 2 && (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  )) {
    return value.slice(1, -1);
  }
  return value;
}
