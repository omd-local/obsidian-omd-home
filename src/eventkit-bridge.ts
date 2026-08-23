import type { CalendarEventRecord, ExternalCalendarDescriptor } from "./model.ts";
import { eventKitErrorMessage, eventKitProcessErrorMessage } from "./eventkit-errors.ts";

export function resolveEventKitHelperPath(
  configuredPath: string,
  vaultBasePath: string,
  manifestDirectory: string,
): string {
  const configured = configuredPath.trim();
  if (configured) return configured;
  const base = vaultBasePath.trim().replace(/\/+$/u, "");
  const directory = manifestDirectory.trim().replace(/^\/+|\/+$/gu, "");
  if (!base || !directory) return "";
  return `${base}/${directory}/omd-eventkit`;
}

export class EventKitBridge {
  private readonly activeChildren = new Set<ReturnType<typeof import("node:child_process")["spawn"]>>();
  private readonly helperPath: () => string;

  constructor(helperPath: () => string) {
    this.helperPath = helperPath;
  }

  dispose(): void {
    for (const child of this.activeChildren) child.kill();
    this.activeChildren.clear();
  }

  async calendars(): Promise<ExternalCalendarDescriptor[]> {
    const response = await this.call(["calendars"]);
    return Array.isArray(response.calendars)
      ? (response.calendars as ExternalCalendarDescriptor[]).map(normalizeEventKitCalendar)
      : [];
  }

  async events(calendarIds: string[], start: string, end: string): Promise<CalendarEventRecord[]> {
    if (!calendarIds.length) return [];
    const response = await this.call(["events", "--start", start, "--end", end, "--calendars", calendarIds.join(",")]);
    return Array.isArray(response.events)
      ? (response.events as CalendarEventRecord[]).map(normalizeEventKitEvent)
      : [];
  }

  async upsert(event: CalendarEventRecord, span: "this" | "future" = "this"): Promise<CalendarEventRecord> {
    const response = await this.call(["upsert", "--span", span], JSON.stringify(event));
    if (!response.event) throw new Error("EventKit helper returned no event");
    return normalizeEventKitEvent(response.event as CalendarEventRecord);
  }

  async remove(eventId: string, span: "this" | "future" = "this"): Promise<void> {
    await this.call(["delete", "--id", eventId, "--span", span]);
  }

  private async call(args: string[], stdin?: string): Promise<Record<string, unknown>> {
    if (process.platform !== "darwin") throw new Error("Live Calendar access is available on macOS only in v1");
    const command = this.helperPath();
    if (!command) throw new Error("Configure the EventKit helper path in settings");
    const runtimeWindow = window as Window & { require?: (id: string) => typeof import("node:child_process") };
    if (!runtimeWindow.require) throw new Error("Desktop process APIs are unavailable");
    const { spawn } = runtimeWindow.require("node:child_process");
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      this.activeChildren.add(child);
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (error?: Error, value?: Record<string, unknown>): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        this.activeChildren.delete(child);
        error ? reject(error) : resolve(value ?? {});
      };
      const timeout = window.setTimeout(() => {
        child.kill();
        finish(new Error("EventKit helper timed out after 30 seconds"));
      }, 30_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout = appendBounded(stdout, chunk, child, () => finish(new Error("EventKit helper output exceeded 2 MB")));
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = appendBounded(stderr, chunk, child, () => finish(new Error("EventKit helper error output exceeded 2 MB")));
      });
      child.on("error", (error) => finish(new Error(eventKitProcessErrorMessage(error), { cause: error })));
      child.on("close", (code: number | null) => {
        if (code !== 0) return finish(new Error(eventKitErrorMessage(stderr)));
        try { finish(undefined, JSON.parse(stdout.trim()) as Record<string, unknown>); }
        catch { finish(new Error("EventKit helper returned invalid JSON")); }
      });
      child.stdin.end(stdin ?? "");
    });
  }
}

export function normalizeEventKitCalendar(calendar: ExternalCalendarDescriptor): ExternalCalendarDescriptor {
  return {
    ...calendar,
    id: calendar.id.trim(),
    title: calendar.title.trim(),
    sourceId: calendar.sourceId.trim(),
    sourceTitle: calendar.sourceTitle.trim(),
  };
}

export function normalizeEventKitEvent(event: CalendarEventRecord): CalendarEventRecord {
  return {
    ...event,
    id: event.id.trim(),
    title: event.title.trim(),
    start: event.start.trim(),
    end: event.end.trim(),
    calendar: event.calendar.trim(),
    location: trimOptional(event.location),
    appleCalendarId: trimOptional(event.appleCalendarId),
    appleItemId: trimOptional(event.appleItemId),
    appleExternalId: trimOptional(event.appleExternalId),
    occurrenceDate: trimOptional(event.occurrenceDate),
    externalModifiedAt: trimOptional(event.externalModifiedAt),
  };
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

const MAX_PROCESS_OUTPUT = 2 * 1024 * 1024;

function appendBounded(
  current: string,
  chunk: string,
  child: ReturnType<typeof import("node:child_process")["spawn"]>,
  overflow: () => void,
): string {
  if (current.length + chunk.length <= MAX_PROCESS_OUTPUT) return current + chunk;
  child.kill();
  overflow();
  return current;
}
