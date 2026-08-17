import type { CalendarEventRecord } from "./model";

const EVENT_FOLDER = "Calendar/Events";

export function eventNotePath(event: CalendarEventRecord): string {
  const date = event.start.slice(0, 10);
  const slug = slugify(event.title) || "event";
  return `${EVENT_FOLDER}/${date}-${slug}-${event.id.slice(-6)}.md`;
}

export function serializeEventNote(event: CalendarEventRecord): string {
  return `${serializeEventFrontmatter(event)}\n\n# ${event.title}\n\n## Notes\n`;
}

export function updateEventNote(existing: string, event: CalendarEventRecord): string {
  const closing = /^---\s*$/gm;
  closing.exec(existing);
  const match = closing.exec(existing);
  if (!match) return serializeEventNote(event);
  const bodyStart = match.index + match[0].length;
  const body = existing.slice(bodyStart);
  const updatedBody = /^(\s*)# [^\r\n]*/.test(body)
    ? body.replace(/^(\s*)# [^\r\n]*/, `$1# ${event.title}`)
    : body;
  return `${serializeEventFrontmatter(event)}${updatedBody}`;
}

function serializeEventFrontmatter(event: CalendarEventRecord): string {
  const quoted = (value: string): string => JSON.stringify(value);
  const lines = [
    "---",
    "type: event",
    `event-id: ${quoted(event.id)}`,
    `title: ${quoted(event.title)}`,
    `start: ${quoted(event.start)}`,
    `end: ${quoted(event.end)}`,
    `all-day: ${event.allDay}`,
    `calendar: ${quoted(event.calendar.trim())}`,
    `event-source: ${event.source}`,
  ];
  if (event.location) lines.push(`location: ${quoted(event.location)}`);
  if (event.source !== "vault" && event.appleCalendarId) lines.push(`apple-calendar-id: ${quoted(event.appleCalendarId)}`);
  if (event.source !== "vault" && event.appleItemId) lines.push(`apple-item-id: ${quoted(event.appleItemId)}`);
  if (event.source !== "vault" && event.appleExternalId) lines.push(`apple-external-id: ${quoted(event.appleExternalId)}`);
  if (event.source !== "vault" && event.occurrenceDate) lines.push(`apple-occurrence-date: ${quoted(event.occurrenceDate)}`);
  if (event.source === "linked" && event.lastSyncedAt) lines.push(`last-synced-at: ${quoted(event.lastSyncedAt)}`);
  if (event.source === "linked" && event.syncHash) lines.push(`sync-hash: ${quoted(event.syncHash)}`);
  if (event.source === "linked" && event.pendingDirection) lines.push(`pending-direction: ${event.pendingDirection}`);
  if (event.source === "linked" && event.readOnly) lines.push("calendar-read-only: true");
  lines.push(`sync-state: ${event.syncState ?? "clean"}`, "---");
  return lines.join("\n");
}

export function recordFromFrontmatter(
  path: string,
  frontmatter: Record<string, unknown>,
): CalendarEventRecord | null {
  if (frontmatter.type !== "event") return null;
  const id = asString(frontmatter["event-id"]);
  const title = asString(frontmatter.title);
  const start = asString(frontmatter.start);
  const end = asString(frontmatter.end);
  if (!id || !title || !start || !end || !validEventRange(start, end)) return null;
  const source = frontmatter["event-source"];
  if (source !== "vault" && source !== "external" && source !== "linked") return null;
  return {
    id,
    title,
    start,
    end,
    allDay: frontmatter["all-day"] === true,
    calendar: asString(frontmatter.calendar) || "Vault",
    source,
    notePath: path,
    location: asString(frontmatter.location),
    appleCalendarId: asString(frontmatter["apple-calendar-id"]),
    appleItemId: asString(frontmatter["apple-item-id"]),
    appleExternalId: asString(frontmatter["apple-external-id"]),
    occurrenceDate: asString(frontmatter["apple-occurrence-date"]),
    lastSyncedAt: asString(frontmatter["last-synced-at"]),
    syncHash: asString(frontmatter["sync-hash"]),
    syncState: parseSyncState(frontmatter["sync-state"]),
    pendingDirection: frontmatter["pending-direction"] === "vault"
      ? "vault"
      : frontmatter["pending-direction"] === "external" ? "external" : undefined,
    readOnly: frontmatter["calendar-read-only"] === true || undefined,
  };
}

function parseSyncState(value: unknown): CalendarEventRecord["syncState"] {
  return value === "conflict" || value === "pending" || value === "unavailable" || value === "error"
    ? value
    : "clean";
}

export function validEventRange(start: string, end: string): boolean {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 48);
}
