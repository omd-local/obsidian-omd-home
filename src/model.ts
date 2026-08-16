export type WidgetId =
  | "omnibox"
  | "today"
  | "inbox"
  | "processing"
  | "recent"
  | "continue"
  | "upcoming"
  | "pinned"
  | "attention"
  | "tags"
  | "status";

export interface WidgetPlacement {
  id: WidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
}

export type EventSource = "vault" | "external" | "linked";

export interface CalendarEventRecord {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendar: string;
  source: EventSource;
  notePath?: string;
  location?: string;
  appleCalendarId?: string;
  appleItemId?: string;
  appleExternalId?: string;
  occurrenceDate?: string;
  lastSyncedAt?: string;
  syncHash?: string;
  vaultModifiedAt?: string;
  externalModifiedAt?: string;
  syncState?: "clean" | "conflict" | "pending" | "unavailable" | "error";
  pendingDirection?: "vault" | "external";
  readOnly?: boolean;
  conflictExternal?: CalendarEventRecord;
}

export interface OmdProgressEvent {
  v: number;
  event: string;
  ts: number;
  message?: string;
  kind?: string;
  output?: string | null;
  percent?: number;
  label?: string;
  name?: string;
}

export interface OmdSearchHit {
  path: string;
  title: string;
  score: number;
  evidence: string;
}

export interface ExternalCalendarDescriptor {
  id: string;
  title: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: "local" | "caldav" | "exchange" | "subscribed" | "birthdays" | "unknown";
  allowsModifications: boolean;
  color?: string;
}
