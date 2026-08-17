import type { CalendarEventRecord, ExternalCalendarDescriptor } from "./model";

export type LinkedChange = "clean" | "vault" | "external" | "conflict";
export type LinkedAvailability = "available" | "unavailable" | "error";

export interface CalendarWriteOverride {
  event: CalendarEventRecord;
  modifiedAt: number;
}

const SYNC_FIELDS = ["title", "start", "end", "allDay", "location", "appleCalendarId"] as const;

export function eventSyncHash(event: CalendarEventRecord): string {
  const normalized = JSON.stringify(SYNC_FIELDS.map((field) => event[field] ?? null));
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function classifyLinkedChange(
  vault: CalendarEventRecord,
  external: CalendarEventRecord,
): LinkedChange {
  const vaultHash = eventSyncHash(vault);
  const externalHash = eventSyncHash(external);
  if (vaultHash === externalHash) return "clean";
  const baseline = vault.syncHash;
  if (!baseline) return "conflict";
  const vaultChanged = vaultHash !== baseline;
  const externalChanged = externalHash !== baseline;
  if (vaultChanged && externalChanged) return "conflict";
  if (vaultChanged) return "vault";
  if (externalChanged) return "external";
  return "clean";
}

export function mergeExternalIntoLinked(
  vault: CalendarEventRecord,
  external: CalendarEventRecord,
  syncedAt = new Date().toISOString(),
): CalendarEventRecord {
  return {
    ...vault,
    title: external.title,
    start: external.start,
    end: external.end,
    allDay: external.allDay,
    calendar: external.calendar,
    location: external.location,
    appleCalendarId: external.appleCalendarId,
    appleItemId: external.appleItemId,
    appleExternalId: external.appleExternalId,
    occurrenceDate: external.occurrenceDate,
    externalModifiedAt: external.externalModifiedAt,
    source: "linked",
    syncState: "clean",
    pendingDirection: undefined,
    lastSyncedAt: syncedAt,
    syncHash: eventSyncHash(external),
    readOnly: external.readOnly,
  };
}

export function calendarIdentityKeys(event: CalendarEventRecord): string[] {
  const keys: string[] = [];
  if (event.appleItemId) keys.push(`item:${event.appleItemId}`);
  if (event.appleExternalId) {
    keys.push(`external:${event.appleExternalId}:${event.occurrenceDate ?? ""}:${event.appleCalendarId ?? ""}`);
  }
  return keys;
}

export function resolveCalendarWriteOverride(
  path: string,
  modifiedAt: number,
  cached: CalendarEventRecord | null,
  override?: CalendarWriteOverride,
): { event: CalendarEventRecord | null; retainOverride: boolean } {
  if (!override) return { event: cached, retainOverride: false };
  if (override.event.notePath !== path || override.modifiedAt !== modifiedAt) {
    return { event: cached, retainOverride: false };
  }
  if (cached && storedCalendarFields(cached) === storedCalendarFields(override.event)) {
    return { event: cached, retainOverride: false };
  }
  return { event: { ...override.event, notePath: path }, retainOverride: true };
}

export function findExternalMatch(
  linked: CalendarEventRecord,
  external: CalendarEventRecord[],
): CalendarEventRecord | undefined {
  const wanted = new Set(calendarIdentityKeys(linked));
  return external.find((event) => calendarIdentityKeys(event).some((key) => wanted.has(key)));
}

export function calendarFetchWindow(
  events: CalendarEventRecord[],
  now = new Date(),
): { start: string; end: string } {
  const start = new Date(now);
  start.setMonth(start.getMonth() - 3);
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 1);
  for (const event of events) {
    if (event.source !== "linked") continue;
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    if (Number.isFinite(eventStart.getTime()) && eventStart < start) start.setTime(eventStart.getTime() - 86_400_000);
    if (Number.isFinite(eventEnd.getTime()) && eventEnd > end) end.setTime(eventEnd.getTime() + 86_400_000);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

export function isSelectedWritableCalendar(
  id: string,
  selectedIds: string[],
  calendars: ExternalCalendarDescriptor[],
): boolean {
  return selectedIds.includes(id)
    && calendars.some((calendar) => calendar.id === id && calendar.allowsModifications);
}

export function classifyLinkedAvailability(
  calendarSelected: boolean,
  externalFetchFailed: boolean,
  matchFound: boolean,
): LinkedAvailability {
  if (!calendarSelected) return "unavailable";
  if (externalFetchFailed) return "error";
  return matchFound ? "available" : "unavailable";
}

export function linkedEventSaveBlockReason(event: CalendarEventRecord): string | undefined {
  if (event.source !== "linked") return undefined;
  if (event.syncState === "error") {
    return "Calendar access failed. Retry Sync before editing this linked event";
  }
  if (event.syncState === "unavailable") {
    return "This Calendar event is unavailable. Use Recreate or Detach instead of Save";
  }
  if (event.syncState === "conflict") {
    return "Resolve the Calendar conflict before editing this linked event";
  }
  if (event.syncState === "pending" && event.pendingDirection === "external") {
    return "Calendar has newer changes. Sync them into the note before editing";
  }
  return undefined;
}

export function detachLinkedEvent(event: CalendarEventRecord): CalendarEventRecord {
  return {
    ...event,
    source: "vault",
    calendar: "Vault",
    appleCalendarId: undefined,
    appleItemId: undefined,
    appleExternalId: undefined,
    occurrenceDate: undefined,
    externalModifiedAt: undefined,
    lastSyncedAt: undefined,
    syncHash: undefined,
    syncState: "clean",
    pendingDirection: undefined,
    conflictExternal: undefined,
    readOnly: undefined,
  };
}

const STORED_CALENDAR_FIELDS = [
  "id",
  "title",
  "start",
  "end",
  "allDay",
  "calendar",
  "source",
  "location",
  "appleCalendarId",
  "appleItemId",
  "appleExternalId",
  "occurrenceDate",
  "lastSyncedAt",
  "syncHash",
  "syncState",
  "pendingDirection",
  "readOnly",
] as const;

function storedCalendarFields(event: CalendarEventRecord): string {
  return JSON.stringify(STORED_CALENDAR_FIELDS.map((field) => event[field] ?? null));
}
