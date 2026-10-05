import type { CalendarEventRecord, ExternalCalendarDescriptor } from "./model.ts";
import { eventKitErrorMessage, eventKitProcessErrorMessage } from "./eventkit-errors.ts";

export const EXPECTED_EVENTKIT_HELPER_PROTOCOL_VERSION = 2;

export class EventKitHelperCompatibilityError extends Error {
  readonly code = "eventkit_helper_incompatible";
  readonly expectedVersion = EXPECTED_EVENTKIT_HELPER_PROTOCOL_VERSION;
  readonly actualVersion?: number;

  constructor(actualVersion?: number) {
    const detail = actualVersion === undefined
      ? "The installed Calendar helper returned an invalid protocol version."
      : `The installed Calendar helper uses protocol ${actualVersion}, but OMD Home requires protocol ${EXPECTED_EVENTKIT_HELPER_PROTOCOL_VERSION}.`;
    super(`${detail} Update or reinstall OMD Home, then check Calendar setup again.`);
    this.name = "EventKitHelperCompatibilityError";
    this.actualVersion = actualVersion;
  }
}

export class EventKitMutationError extends Error {
  readonly commitState: "not-committed" | "unknown";

  constructor(
    message: string,
    commitState: "not-committed" | "unknown",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EventKitMutationError";
    this.commitState = commitState;
  }
}

export function eventKitMutationDefinitelyDidNotCommit(error: unknown): boolean {
  return error instanceof EventKitHelperCompatibilityError
    || (error instanceof EventKitMutationError && error.commitState === "not-committed");
}

export function parseEventKitHelperProtocolVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new EventKitHelperCompatibilityError();
  }
  return value as number;
}

export function requireCompatibleEventKitHelperProtocol(actualVersion: number): number {
  if (actualVersion !== EXPECTED_EVENTKIT_HELPER_PROTOCOL_VERSION) {
    throw new EventKitHelperCompatibilityError(actualVersion);
  }
  return actualVersion;
}

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

interface EventKitFileSystem {
  constants: { X_OK: number };
  statSync: (path: string) => { isFile: () => boolean };
  accessSync: (path: string, mode: number) => void;
}

export function isEventKitHelperAvailable(
  helperPath: string,
  fileSystem?: EventKitFileSystem,
): boolean {
  const candidate = helperPath.trim();
  if (!candidate) return false;
  const fs = fileSystem ?? desktopFileSystem();
  if (!fs) return false;
  try {
    if (!fs.statSync(candidate).isFile()) return false;
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function desktopFileSystem(): EventKitFileSystem | null {
  if (typeof window === "undefined") return null;
  const runtimeWindow = window as Window & { require?: (id: string) => typeof import("node:fs") };
  return runtimeWindow.require?.("node:fs") ?? null;
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

  async protocolVersion(): Promise<number> {
    const response = await this.call(["version"], undefined, this.helperPath());
    return parseEventKitHelperProtocolVersion(response.version);
  }

  async requireCompatibleProtocol(): Promise<number> {
    return requireCompatibleEventKitHelperProtocol(await this.protocolVersion());
  }

  private async compatibleHelperPath(): Promise<string> {
    const helperPath = this.helperPath();
    const response = await this.call(["version"], undefined, helperPath);
    requireCompatibleEventKitHelperProtocol(parseEventKitHelperProtocolVersion(response.version));
    return helperPath;
  }

  async calendars(): Promise<ExternalCalendarDescriptor[]> {
    const helperPath = await this.compatibleHelperPath();
    const response = await this.call(["calendars"], undefined, helperPath);
    return Array.isArray(response.calendars)
      ? (response.calendars as ExternalCalendarDescriptor[]).map(normalizeEventKitCalendar)
      : [];
  }

  async events(calendarIds: string[], start: string, end: string): Promise<CalendarEventRecord[]> {
    if (!calendarIds.length) return [];
    const helperPath = await this.compatibleHelperPath();
    const response = await this.call(
      ["events", "--start", start, "--end", end, "--calendars", calendarIds.join(",")],
      undefined,
      helperPath,
    );
    return Array.isArray(response.events)
      ? (response.events as CalendarEventRecord[]).map(normalizeEventKitEvent)
      : [];
  }

  async lookup(
    eventId: string,
    occurrenceDate?: string,
    startHint?: string,
  ): Promise<CalendarEventRecord | null> {
    const helperPath = await this.compatibleHelperPath();
    const args = ["lookup", "--id", eventId];
    if (occurrenceDate) args.push("--occurrence-date", occurrenceDate);
    if (startHint) args.push("--start-hint", startHint);
    const response = await this.call(args, undefined, helperPath);
    return response.event
      ? normalizeEventKitEvent(response.event as CalendarEventRecord)
      : null;
  }

  async upsert(
    event: CalendarEventRecord,
    span: "this" | "future" = "this",
    startHint?: string,
  ): Promise<CalendarEventRecord> {
    let helperPath: string;
    try {
      helperPath = await this.compatibleHelperPath();
    } catch (error) {
      if (error instanceof EventKitHelperCompatibilityError) throw error;
      throw new EventKitMutationError(errorMessage(error), "not-committed", { cause: error });
    }
    const args = ["upsert", "--span", span];
    if (startHint) args.push("--start-hint", startHint);
    const response = await this.call(args, JSON.stringify(event), helperPath);
    if (!response.event) {
      throw new EventKitMutationError(
        "EventKit helper returned no event, so OMD Home cannot confirm whether the Calendar write completed.",
        "unknown",
      );
    }
    return normalizeEventKitEvent(response.event as CalendarEventRecord);
  }

  async remove(
    eventId: string,
    externalModifiedAt?: string,
    span: "this" | "future" = "this",
    occurrenceDate?: string,
    startHint?: string,
  ): Promise<void> {
    const helperPath = await this.compatibleHelperPath();
    const args = ["delete", "--id", eventId, "--span", span];
    if (externalModifiedAt) args.push("--modified-at", externalModifiedAt);
    if (occurrenceDate) args.push("--occurrence-date", occurrenceDate);
    if (startHint) args.push("--start-hint", startHint);
    await this.call(args, undefined, helperPath);
  }

  private async call(args: string[], stdin?: string, helperPath?: string): Promise<Record<string, unknown>> {
    if (process.platform !== "darwin") throw new Error("Live Calendar access is available on macOS only in v1");
    const command = helperPath ?? this.helperPath();
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
      const mutation = args[0] === "upsert" || args[0] === "delete";
      const mutationError = (detail: string, commitState: "not-committed" | "unknown", cause?: unknown): Error => (
        mutation
          ? new EventKitMutationError(detail, commitState, cause === undefined ? undefined : { cause })
          : new Error(detail, cause === undefined ? undefined : { cause })
      );
      const timeout = window.setTimeout(() => {
        child.kill();
        finish(mutationError("EventKit helper timed out after 30 seconds", "unknown"));
      }, 30_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout = appendBounded(stdout, chunk, child, () => finish(mutationError("EventKit helper output exceeded 2 MB", "unknown")));
      });
      child.stderr.on("data", (chunk: string) => {
        stderr = appendBounded(stderr, chunk, child, () => finish(mutationError("EventKit helper error output exceeded 2 MB", "unknown")));
      });
      child.on("error", (error) => finish(mutationError(eventKitProcessErrorMessage(error), "not-committed", error)));
      child.on("close", (code: number | null) => {
        if (code !== 0) {
          const commitState = eventKitMutationCommitState(stderr);
          return finish(mutationError(eventKitBridgeErrorMessage(stderr), commitState));
        }
        try { finish(undefined, JSON.parse(stdout.trim()) as Record<string, unknown>); }
        catch { finish(mutationError("EventKit helper returned invalid JSON", "unknown")); }
      });
      child.stdin.end(stdin ?? "");
    });
  }
}

export function eventKitMutationCommitState(stderr: string): "not-committed" | "unknown" {
  const tokens = stderr.trim().toLowerCase().replace(/\s+/gu, " ");
  const rejectedBeforeMutation = tokens.includes("calendar access was not granted")
    || tokens.includes("selected calendar is unavailable")
    || tokens.includes("no longer writable")
    || tokens.includes("calendar event no longer exists")
    || tokens.includes("calendar event changed since it was last read")
    || tokens.includes("calendar event lookup was ambiguous")
    || tokens.includes("calendar occurrence could not be located safely")
    || tokens.includes("calendar create request conflicts with an existing event")
    || tokens.includes("recurring calendar operations require the current occurrence start")
    || tokens.includes("missing --")
    || tokens.includes("new calendar events require a valid client request id")
    || tokens.includes("all-day events require yyyy-mm-dd dates")
    || tokens.includes("timed events require an iso-8601 date-time")
    || tokens.includes("invalid all-day calendar date")
    || tokens.includes("invalid iso-8601 date-time")
    || tokens.includes("event end must be after start");
  return rejectedBeforeMutation ? "not-committed" : "unknown";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function eventKitBridgeErrorMessage(stderr: string): string {
  const tokens = stderr.trim().toLowerCase().replace(/\s+/gu, " ");
  if (tokens.includes("calendar event changed since it was last read")) {
    return "The Calendar event changed after it was last read. Run Sync, review the latest version, then try again.";
  }
  if (tokens.includes("calendar event no longer exists")) {
    return "The Calendar event no longer exists. Run Sync to refresh Calendar; linked notes can then use Recreate or Detach.";
  }
  if (tokens.includes("calendar event lookup was ambiguous")) {
    return "Calendar returned more than one matching occurrence. Nothing was changed; refresh Calendar and review the series.";
  }
  if (tokens.includes("calendar occurrence could not be located safely")) {
    return "Calendar could not confirm this recurring occurrence. Nothing was changed; run Sync and review the series before trying again.";
  }
  if (tokens.includes("calendar create request conflicts with an existing event")) {
    return "Calendar already contains an event for this pending request, but its details do not match. Nothing was changed; run Sync and review the event.";
  }
  if (tokens.includes("recurring calendar operations require the current occurrence start")) {
    return "Calendar could not safely locate this recurring occurrence. Nothing was changed; run Sync and try again.";
  }
  return eventKitErrorMessage(stderr);
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
    clientRequestId: trimOptional(event.clientRequestId),
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
