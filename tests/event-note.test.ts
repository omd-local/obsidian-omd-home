import assert from "node:assert/strict";
import test from "node:test";
import { eventNotePath, recordFromFrontmatter, serializeEventNote, updateEventNote } from "../src/event-note.ts";
import type { CalendarEventRecord } from "../src/model.ts";

const event: CalendarEventRecord = {
  id: "evt_1234567890",
  title: "Design review",
  start: "2026-07-23T09:30:00+12:00",
  end: "2026-07-23T10:15:00+12:00",
  allDay: false,
  calendar: "Personal",
  source: "linked",
  appleCalendarId: "cal_1",
  appleItemId: "item_1",
  syncState: "clean",
};

test("event note path is deterministic and contained", () => {
  assert.equal(eventNotePath(event), "Calendar/Events/2026-07-23-design-review-567890.md");
});

test("serialized event keeps linked identifiers", () => {
  const markdown = serializeEventNote(event);
  assert.match(markdown, /event-source: linked/);
  assert.match(markdown, /apple-item-id: "item_1"/);
  assert.match(markdown, /# Design review/);
});

test("pending linked writes survive an Obsidian reload for recovery", () => {
  const markdown = serializeEventNote({
    ...event,
    source: "linked",
    syncState: "pending",
    pendingDirection: "vault",
    readOnly: true,
  });
  assert.match(markdown, /sync-state: pending/);
  assert.match(markdown, /pending-direction: vault/);
  assert.match(markdown, /calendar-read-only: true/);
  const frontmatter = Object.fromEntries(
    markdown.split("\n").slice(1, markdown.split("\n").indexOf("---", 1)).map((line) => {
      const split = line.indexOf(":");
      const key = line.slice(0, split);
      const raw = line.slice(split + 1).trim();
      if (raw === "true") return [key, true];
      if (raw === "false") return [key, false];
      try { return [key, JSON.parse(raw)]; } catch { return [key, raw]; }
    }),
  );
  const parsed = recordFromFrontmatter("Calendar/Events/recovery.md", frontmatter);
  assert.equal(parsed?.syncState, "pending");
  assert.equal(parsed?.pendingDirection, "vault");
  assert.equal(parsed?.readOnly, true);
});

test("frontmatter parser fails closed for non-events", () => {
  assert.equal(recordFromFrontmatter("Notes/a.md", { type: "note" }), null);
});

test("updating event metadata preserves user notes", () => {
  const existing = `${serializeEventNote(event)}\nDo not erase this paragraph.\n`;
  const updated = updateEventNote(existing, { ...event, title: "Moved review" });
  assert.match(updated, /title: "Moved review"/);
  assert.match(updated, /# Moved review/);
  assert.doesNotMatch(updated, /# Design review/);
  assert.match(updated, /Do not erase this paragraph\./);
});

test("vault-only serialization strips stale Calendar linkage", () => {
  const markdown = serializeEventNote({ ...event, source: "vault", syncHash: "v1:abc" });
  assert.doesNotMatch(markdown, /apple-/);
  assert.doesNotMatch(markdown, /sync-hash/);
});

test("frontmatter parser rejects invalid or reversed event ranges", () => {
  const base = {
    type: "event", "event-id": "evt_1", title: "Bad", "event-source": "vault",
  };
  assert.equal(recordFromFrontmatter("bad.md", { ...base, start: "tomorrow", end: "later" }), null);
  assert.equal(recordFromFrontmatter("bad.md", {
    ...base, start: "2026-08-09T11:00:00Z", end: "2026-08-09T10:00:00Z",
  }), null);
});
