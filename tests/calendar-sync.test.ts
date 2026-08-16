import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarFetchWindow,
  classifyLinkedAvailability,
  classifyLinkedChange,
  detachLinkedEvent,
  eventSyncHash,
  findExternalMatch,
  isSelectedWritableCalendar,
  linkedEventSaveBlockReason,
  mergeExternalIntoLinked,
} from "../src/calendar-sync.ts";
import type { CalendarEventRecord } from "../src/model.ts";

const linked: CalendarEventRecord = {
  id: "evt_1", title: "Review", start: "2026-07-23T09:00:00Z", end: "2026-07-23T10:00:00Z",
  allDay: false, calendar: "Work", source: "linked", appleItemId: "apple_1",
  lastSyncedAt: "2026-07-23T08:00:00Z",
};

linked.syncHash = eventSyncHash(linked);

test("detects simultaneous linked edits as a conflict", () => {
  assert.equal(classifyLinkedChange({ ...linked, title: "Vault title" }, {
    ...linked, title: "Calendar title", source: "external",
  }), "conflict");
});

test("identical vault and Calendar fields recover a staged write even with an old baseline", () => {
  const staged = { ...linked, title: "Recovered title", syncState: "pending" as const, pendingDirection: "vault" as const };
  assert.equal(classifyLinkedChange(staged, { ...staged, source: "external" }), "clean");
});

test("detects a Calendar-only edit", () => {
  assert.equal(classifyLinkedChange(linked, {
    ...linked, title: "Calendar title", source: "external",
  }), "external");
});

test("ignores Markdown body mtimes when event fields are unchanged", () => {
  assert.equal(classifyLinkedChange({ ...linked, vaultModifiedAt: "2099-01-01T00:00:00Z" }, {
    ...linked, source: "external", externalModifiedAt: "2099-01-01T00:00:00Z",
  }), "clean");
});

test("migrates a missing sync hash safely only when both event versions agree", () => {
  const legacy = { ...linked, syncHash: undefined };
  assert.equal(classifyLinkedChange(legacy, { ...legacy, source: "external" }), "clean");
  assert.equal(classifyLinkedChange(legacy, { ...legacy, source: "external", title: "Different" }), "conflict");
});

test("merges Calendar fields without losing the note identity", () => {
  const merged = mergeExternalIntoLinked(linked, {
    ...linked, id: "apple:1", title: "Review moved", source: "external", start: "2026-07-23T11:00:00Z",
  }, "2026-07-23T08:05:00Z");
  assert.equal(merged.id, "evt_1");
  assert.equal(merged.title, "Review moved");
  assert.equal(merged.source, "linked");
  assert.equal(merged.lastSyncedAt, "2026-07-23T08:05:00Z");
});

test("finds a rotated EventKit item by stable external occurrence identity", () => {
  const rotated = { ...linked, source: "external" as const, appleItemId: "new_item", appleExternalId: "stable", occurrenceDate: "2026-07-23T09:00:00Z" };
  const stale = { ...linked, appleItemId: "old_item", appleExternalId: "stable", occurrenceDate: "2026-07-23T09:00:00Z" };
  assert.equal(findExternalMatch(stale, [rotated])?.appleItemId, "new_item");
});

test("fetch window expands to include every linked note", () => {
  const window = calendarFetchWindow([
    { ...linked, start: "2020-01-02T00:00:00Z", end: "2030-01-02T00:00:00Z" },
  ], new Date("2026-08-09T00:00:00Z"));
  assert.ok(Date.parse(window.start) < Date.parse("2020-01-02T00:00:00Z"));
  assert.ok(Date.parse(window.end) > Date.parse("2030-01-02T00:00:00Z"));
});

test("writable Calendar policy requires both explicit selection and write access", () => {
  const calendars = [{
    id: "cal_1", title: "Work", sourceId: "source", sourceTitle: "iCloud",
    sourceType: "caldav" as const, allowsModifications: true,
  }];
  assert.equal(isSelectedWritableCalendar("cal_1", ["cal_1"], calendars), true);
  assert.equal(isSelectedWritableCalendar("cal_1", [], calendars), false);
  assert.equal(isSelectedWritableCalendar("cal_1", ["cal_1"], [{ ...calendars[0], allowsModifications: false }]), false);
});

test("detaching strips every external identity and sync field", () => {
  const detached = detachLinkedEvent({
    ...linked, appleCalendarId: "cal_1", appleExternalId: "external", occurrenceDate: linked.start,
    syncHash: eventSyncHash(linked), conflictExternal: { ...linked, source: "external" },
  });
  assert.equal(detached.source, "vault");
  assert.equal(detached.appleItemId, undefined);
  assert.equal(detached.appleExternalId, undefined);
  assert.equal(detached.syncHash, undefined);
  assert.equal(detached.conflictExternal, undefined);
});

test("transient EventKit failures pause sync instead of claiming the event is missing", () => {
  assert.equal(classifyLinkedAvailability(true, true, false), "error");
  assert.equal(classifyLinkedAvailability(true, false, false), "unavailable");
  assert.equal(classifyLinkedAvailability(false, true, false), "unavailable");
});

test("unsafe linked states cannot be saved through the ordinary editor", () => {
  assert.match(linkedEventSaveBlockReason({ ...linked, syncState: "error" }) ?? "", /Retry Sync/);
  assert.match(linkedEventSaveBlockReason({ ...linked, syncState: "unavailable" }) ?? "", /Recreate or Detach/);
  assert.match(linkedEventSaveBlockReason({ ...linked, syncState: "conflict" }) ?? "", /Resolve/);
  assert.match(linkedEventSaveBlockReason({
    ...linked,
    syncState: "pending",
    pendingDirection: "external",
  }) ?? "", /newer changes/);
  assert.equal(linkedEventSaveBlockReason({ ...linked, syncState: "pending", pendingDirection: "vault" }), undefined);
  assert.equal(linkedEventSaveBlockReason({ ...linked, syncState: "clean" }), undefined);
  assert.equal(linkedEventSaveBlockReason({ ...linked, source: "vault", syncState: "unavailable" }), undefined);
});
