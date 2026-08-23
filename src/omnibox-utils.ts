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

export function recordingQuickActions(commands: RecordingCommandRef[]): RecordingQuickAction[] {
  const resolved: Partial<Record<"start" | "stop" | "toggle", RecordingCommandRef>> = {};
  for (const command of commands) {
    const kind = recordingCommandKind(command.id, command.name);
    if (kind && !resolved[kind]) resolved[kind] = command;
  }

  if (resolved.toggle) {
    return [{ id: resolved.toggle.id, label: "Recording", icon: "mic" }];
  }

  const actions: RecordingQuickAction[] = [];
  if (resolved.start) actions.push({ id: resolved.start.id, label: "Start recording", icon: "mic" });
  if (resolved.stop) actions.push({ id: resolved.stop.id, label: "Stop recording", icon: "square" });
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
