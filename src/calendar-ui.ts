import type { EventSource } from "./model";

const SOURCE_SET = new Set<EventSource>(["vault", "external", "linked"]);

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
