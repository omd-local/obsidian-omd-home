import { homedir } from "node:os";

export function looksCapturable(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("~/");
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
