import type { CalendarEventRecord } from "./model";

const EVENT_VERSION_FIELDS = [
  "id",
  "title",
  "start",
  "end",
  "allDay",
  "calendar",
  "source",
  "notePath",
  "location",
  "appleCalendarId",
  "appleItemId",
  "appleExternalId",
  "occurrenceDate",
  "clientRequestId",
  "lastSyncedAt",
  "syncHash",
  "vaultModifiedAt",
  "externalModifiedAt",
  "readOnly",
] as const;

export function calendarEventVersion(event: CalendarEventRecord): string {
  return JSON.stringify(EVENT_VERSION_FIELDS.map((field) => event[field] ?? null));
}

export class CalendarSnapshotChangedError extends Error {
  constructor(message = "The calendar event changed while it was being synchronized") {
    super(message);
    this.name = "CalendarSnapshotChangedError";
  }
}
