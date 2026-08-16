import { Platform } from "obsidian";
import type { CalendarEventRecord, ExternalCalendarDescriptor } from "./model";

export class EventKitBridge {
  private readonly activeChildren = new Set<ReturnType<typeof import("node:child_process")["spawn"]>>();

  constructor(private readonly helperPath: () => string) {}

  dispose(): void {
    for (const child of this.activeChildren) child.kill();
    this.activeChildren.clear();
  }

  async calendars(): Promise<ExternalCalendarDescriptor[]> {
    const response = await this.call(["calendars"]);
    return Array.isArray(response.calendars) ? response.calendars as ExternalCalendarDescriptor[] : [];
  }

  async events(calendarIds: string[], start: string, end: string): Promise<CalendarEventRecord[]> {
    if (!calendarIds.length) return [];
    const response = await this.call(["events", "--start", start, "--end", end, "--calendars", calendarIds.join(",")]);
    return Array.isArray(response.events) ? response.events as CalendarEventRecord[] : [];
  }

  async upsert(event: CalendarEventRecord, span: "this" | "future" = "this"): Promise<CalendarEventRecord> {
    const response = await this.call(["upsert", "--span", span], JSON.stringify(event));
    if (!response.event) throw new Error("EventKit helper returned no event");
    return response.event as CalendarEventRecord;
  }

  async remove(eventId: string, span: "this" | "future" = "this"): Promise<void> {
    await this.call(["delete", "--id", eventId, "--span", span]);
  }

  private async call(args: string[], stdin?: string): Promise<Record<string, unknown>> {
    if (!Platform.isDesktopApp) throw new Error("Live Calendar access is available on Mac only in v1");
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
      child.on("error", (error) => finish(error));
      child.on("close", (code: number | null) => {
        if (code !== 0) return finish(new Error(stderr.trim() || "EventKit helper failed"));
        try { finish(undefined, JSON.parse(stdout.trim()) as Record<string, unknown>); }
        catch { finish(new Error("EventKit helper returned invalid JSON")); }
      });
      child.stdin.end(stdin ?? "");
    });
  }
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
