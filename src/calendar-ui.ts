import type { CalendarEventRecord, CalendarUnavailableReason, EventSource } from "./model";
import { isCalendarNoteErrorRecord } from "./calendar-sync.ts";

export const EVENT_SOURCE_ORDER = ["vault", "external", "linked"] as const satisfies readonly EventSource[];

const SOURCE_SET = new Set<EventSource>(EVENT_SOURCE_ORDER);

export interface EventSourcePresentation {
  label: string;
  description: string;
  glyph: string;
}

const EVENT_SOURCE_PRESENTATIONS: Record<EventSource, EventSourcePresentation> = {
  vault: {
    label: "Vault only",
    description: "Markdown event note",
    glyph: "□",
  },
  external: {
    label: "Calendar only",
    description: "macOS Calendar event",
    glyph: "■",
  },
  linked: {
    label: "Linked",
    description: "Note synced with Calendar",
    glyph: "◧",
  },
};

export function eventSourcePresentation(source: EventSource): EventSourcePresentation {
  return EVENT_SOURCE_PRESENTATIONS[source];
}

export function eventSourceFilterSummary(enabledSources: ReadonlySet<EventSource>): string {
  const count = normalizeSourceFilters(enabledSources).size;
  return `Sources · ${count === EVENT_SOURCE_ORDER.length ? "All" : `${count} of ${EVENT_SOURCE_ORDER.length}`}`;
}

export interface EventSourceFilterControlState {
  enabled: boolean;
  disabled: boolean;
  ariaLabel: string;
  title: string;
}

export function eventSourceFilterControlState(
  enabledSources: ReadonlySet<EventSource>,
  source: EventSource,
): EventSourceFilterControlState {
  const presentation = eventSourcePresentation(source);
  const enabled = enabledSources.has(source);
  const lastVisible = enabled && enabledSources.size === 1;
  return {
    enabled,
    disabled: lastVisible,
    ariaLabel: lastVisible
      ? `${presentation.label} events shown. At least one source must remain visible. ${presentation.description}.`
      : `${enabled ? "Hide" : "Show"} ${presentation.label} events. ${presentation.description}.`,
    title: lastVisible
      ? "At least one event source must remain visible"
      : `${enabled ? "Hide" : "Show"} ${presentation.label.toLowerCase()} events`,
  };
}

export function deviceTimeZoneName(
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  return timeZone?.trim() || "Local time";
}

export function deviceTimeZoneDescription(timeZone?: string): string {
  return `Times use this device's time zone: ${deviceTimeZoneName(timeZone)}.`;
}

export function calendarRangeValidationMessage(
  validationError: string | null,
  allDay: boolean,
): string | null {
  if (!validationError) return null;
  if (validationError === "End must be after start") {
    return allDay
      ? "Choose an End date after Start. For a one-day event, choose the next date."
      : "Choose an End time after Start.";
  }
  if (validationError.startsWith("Start must")) {
    return allDay ? "Choose a valid Start date." : "Choose a valid Start date and time.";
  }
  if (validationError.startsWith("End must")) {
    return allDay ? "Choose a valid End date." : "Choose a valid End date and time.";
  }
  if (validationError.startsWith("Start and end must")) {
    return allDay
      ? "Choose dates for both Start and End."
      : "Choose a date and time for both Start and End.";
  }
  return validationError;
}

export type CalendarRangeValidationTarget = "start" | "end" | "both";

export function calendarRangeValidationTarget(validationError: string): CalendarRangeValidationTarget {
  if (validationError.startsWith("Start and end")) return "both";
  if (validationError.startsWith("Start must")) return "start";
  return "end";
}

export interface CalendarRecoveryPresentation {
  label: string;
  description: string;
  showRecreate: boolean;
  showRetrySync: boolean;
}

const UNAVAILABLE_PRESENTATIONS: Record<CalendarUnavailableReason, CalendarRecoveryPresentation> = {
  "confirmed-missing": {
    label: "Calendar event not verified",
    description: "The saved Calendar identifier may have changed after a move or full sync. Retry Sync, or use Recreate… only after checking that the event is gone in Calendar.",
    showRecreate: true,
    showRetrySync: true,
  },
  "calendar-deselected": {
    label: "Calendar not selected",
    description: "Select this calendar in OMD Home settings and retry Sync, or detach the note.",
    showRecreate: false,
    showRetrySync: true,
  },
  "setup-or-read-failure": {
    label: "Calendar sync paused",
    description: "OMD Home could not safely read Calendar. Check Calendar setup, then retry Sync. The event has not been treated as missing.",
    showRecreate: false,
    showRetrySync: true,
  },
  "outside-window": {
    label: "Calendar event not verified",
    description: "The event was outside the range Calendar returned. Retry Sync, or use Recreate… only after checking that the event is gone in Calendar.",
    showRecreate: true,
    showRetrySync: true,
  },
  unknown: {
    label: "Calendar event not verified",
    description: "OMD Home could not confirm whether the event still exists. Retry Sync, or use Recreate… only after checking that it is gone in Calendar.",
    showRecreate: true,
    showRetrySync: true,
  },
};

export function calendarRecoveryPresentation(
  event: Pick<CalendarEventRecord, "syncState" | "unavailableReason"> & {
    id?: string;
    notePath?: string;
  },
): CalendarRecoveryPresentation | null {
  if (event.syncState === "error") {
    if (event.unavailableReason === "setup-or-read-failure") {
      return UNAVAILABLE_PRESENTATIONS["setup-or-read-failure"];
    }
    const invalidNote = isCalendarNoteErrorRecord({
      id: event.id ?? "",
      notePath: event.notePath,
      syncState: event.syncState,
    });
    return {
      label: "Calendar link needs review",
      description: invalidNote
        ? "OMD Home could not read this event note. Fix the note and retry Sync, or delete the note."
        : "OMD Home could not safely match this event note to Calendar. Review the note and retry Sync, or detach it.",
      showRecreate: false,
      showRetrySync: true,
    };
  }
  if (event.syncState !== "unavailable") return null;
  return UNAVAILABLE_PRESENTATIONS[event.unavailableReason ?? "unknown"];
}

export interface CalendarConflictVersionField {
  label: "Title" | "Time" | "Calendar" | "Location";
  value: string;
}

export function calendarConflictVersionFields(
  event: {
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    calendar?: string;
    location?: string;
  },
  locale?: string,
): CalendarConflictVersionField[] {
  return [
    { label: "Title", value: event.title },
    { label: "Time", value: formatConflictRange(event, locale) },
    { label: "Calendar", value: event.calendar?.trim() || "Vault" },
    { label: "Location", value: event.location?.trim() || "No location" },
  ];
}

export function eventMatchesSourceFilter(
  source: EventSource,
  enabledSources: ReadonlySet<EventSource>,
): boolean {
  return enabledSources.size === 0 || enabledSources.has(source);
}

export function normalizeSourceFilters(
  enabledSources?: Iterable<EventSource>,
): Set<EventSource> {
  const normalized = new Set<EventSource>();
  if (!enabledSources) return new Set(SOURCE_SET);
  for (const source of enabledSources) {
    if (SOURCE_SET.has(source)) normalized.add(source);
  }
  return normalized.size > 0 ? normalized : new Set(SOURCE_SET);
}

export function toggleSourceFilter(
  enabledSources: ReadonlySet<EventSource>,
  source: EventSource,
): Set<EventSource> {
  const next = new Set(normalizeSourceFilters(enabledSources));
  if (next.has(source)) {
    if (next.size === 1) return next;
    next.delete(source);
    return next;
  }
  next.add(source);
  return next;
}

export function calendarEditorInputValue(stored: string, allDay: boolean): string {
  if (allDay) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return stored;
    const parsed = Date.parse(stored);
    if (Number.isNaN(parsed)) return "";
    return formatLocalDate(new Date(parsed));
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return `${stored}T00:00`;
  const parsed = Date.parse(stored);
  if (Number.isNaN(parsed)) return "";
  return formatLocalDateTime(new Date(parsed));
}

export function calendarEditorStoredValue(input: string, allDay: boolean): string | null {
  const trimmed = input.trim();
  if (allDay) return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    local.getFullYear() !== year
    || local.getMonth() !== month - 1
    || local.getDate() !== day
    || local.getHours() !== hour
    || local.getMinutes() !== minute
  ) {
    return null;
  }
  return local.toISOString();
}

export function calendarEditorRangeForMode(
  start: string,
  end: string,
  allDay: boolean,
): { start: string; end: string } | null {
  const nextStart = calendarEditorStoredValue(calendarEditorInputValue(start, allDay), allDay);
  let nextEnd = calendarEditorStoredValue(calendarEditorInputValue(end, allDay), allDay);
  if (!nextStart || !nextEnd) return null;
  if (allDay && nextEnd <= nextStart) nextEnd = addCalendarDays(nextStart, 1);
  return { start: nextStart, end: nextEnd };
}

export interface CalendarEventSourceHost {
  removeAllEventSources(): void;
  addEventSource(source: Record<string, unknown>[]): void;
}

export function replaceCalendarEvents(
  calendar: CalendarEventSourceHost,
  events: Record<string, unknown>[],
): void {
  calendar.removeAllEventSources();
  calendar.addEventSource(events);
}

function formatLocalDateTime(date: Date): string {
  return `${formatLocalDate(date)}T`
    + `${date.getHours()}`.padStart(2, "0")
    + ":"
    + `${date.getMinutes()}`.padStart(2, "0");
}

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    `${date.getMonth() + 1}`.padStart(2, "0"),
    `${date.getDate()}`.padStart(2, "0"),
  ].join("-");
}

function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day + days, 12, 0, 0, 0);
  return formatLocalDate(date);
}

function formatConflictRange(
  event: { start: string; end: string; allDay: boolean },
  locale?: string,
): string {
  if (event.allDay) return `${event.start} to ${event.end} · end date excluded`;
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${event.start} to ${event.end}`;
  }
  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${formatter.format(start)} to ${formatter.format(end)} · ${deviceTimeZoneName()}`;
}
