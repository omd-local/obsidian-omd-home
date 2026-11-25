import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarSyncResultMessage,
  calendarFetchWindow,
  classifyLinkedAvailability,
  classifyLinkedChange,
  detachLinkedEvent,
  eventSyncHash,
  findExternalMatch,
  isSelectedWritableCalendar,
  linkedEventSaveBlockReason,
  mergeExternalIntoLinked,
  resolveCalendarWriteOverride,
  stableExternalCandidates,
  summarizeCalendarSync,
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

test("detects another simultaneous edit after a conflict resolution establishes a new baseline", () => {
  const keptNote = { ...linked, title: "Note 1" };
  const resolved = { ...keptNote, syncHash: eventSyncHash(keptNote), syncState: "clean" as const };
  assert.equal(classifyLinkedChange(resolved, { ...resolved, source: "external" }), "clean");
  assert.equal(classifyLinkedChange(
    { ...resolved, title: "Note 2" },
    { ...resolved, title: "Calendar 2", source: "external" },
  ), "conflict");
});

test("calendar sync summary distinguishes a clean completion from states that need review", () => {
  const clean = summarizeCalendarSync([
    linked,
    { ...linked, id: "vault", source: "vault", syncState: "conflict" },
  ]);
  assert.deepEqual(clean, { conflicts: 0, unavailable: 0, errors: 0, pending: 0 });
  assert.equal(calendarSyncResultMessage(clean), "Calendar sync complete");

  const needsReview = summarizeCalendarSync([
    { ...linked, id: "conflict", syncState: "conflict" },
    { ...linked, id: "unavailable", title: "Recovery fixture", syncState: "unavailable" },
    { ...linked, id: "error", syncState: "error" },
    { ...linked, id: "pending", syncState: "pending", pendingDirection: "vault" },
  ]);
  assert.deepEqual(needsReview, {
    conflicts: 1,
    unavailable: 1,
    errors: 1,
    pending: 1,
    recoveryTitles: ["Recovery fixture"],
  });
  assert.equal(
    calendarSyncResultMessage(needsReview),
    "Calendar sync needs review: 1 conflict, 1 linked note needs Calendar recovery, 1 error, and 1 pending event. Open the highlighted events to compare versions and choose one. Recovery: Recovery fixture.",
  );
});

test("calendar sync result names linked notes that need Calendar recovery", () => {
  assert.equal(calendarSyncResultMessage({ conflicts: 0, unavailable: 1, errors: 0, pending: 0 }),
    "Calendar sync needs review: 1 linked note needs Calendar recovery. Its Calendar copy may have been deleted, moved, or belong to a Calendar that is not selected. Open the highlighted linked note for safe recovery options.");
  assert.equal(calendarSyncResultMessage({
    conflicts: 0,
    unavailable: 2,
    errors: 0,
    pending: 0,
    recoveryTitles: ["Missing fixture", "Deselected fixture"],
  }), "Calendar sync needs review: 2 linked notes need Calendar recovery. Their Calendar copies may have been deleted, moved, or belong to Calendars that are not selected. Open the highlighted linked notes for safe recovery options. Recovery: Missing fixture; Deselected fixture.");
  assert.equal(calendarSyncResultMessage({ conflicts: 0, unavailable: 0, errors: 2, pending: 0 }),
    "Calendar sync needs review: 2 errors. Open the highlighted events for details, then retry Sync.");
  assert.equal(calendarSyncResultMessage({ conflicts: 0, unavailable: 0, errors: 0, pending: 1 }),
    "Calendar sync needs review: 1 pending event. Open the highlighted events to finish syncing them.");
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

test("stable external identity follows a unique event across Calendars but preserves ambiguity", () => {
  const stale = {
    ...linked,
    appleCalendarId: "old_calendar",
    appleExternalId: "stable",
    occurrenceDate: "2026-07-23T09:00:00Z",
  };
  const moved = {
    ...stale,
    source: "external" as const,
    appleCalendarId: "new_calendar",
    appleItemId: "new_item",
  };
  assert.deepEqual(stableExternalCandidates(stale, [moved]), [moved]);
  assert.equal(stableExternalCandidates(stale, [
    moved,
    { ...moved, appleCalendarId: "other_calendar", appleItemId: "other_item" },
  ]).length, 2);
  assert.deepEqual(stableExternalCandidates(stale, [
    { ...moved, occurrenceDate: "2026-07-30T09:00:00Z" },
  ]), []);
});

test("keeps a finalized Calendar write while Obsidian metadata is still staged", () => {
  const finalized = {
    ...linked,
    notePath: "Calendar/Events/review.md",
    appleCalendarId: "cal_1",
    appleExternalId: "external_1",
    occurrenceDate: linked.start,
    syncState: "clean" as const,
  };
  const staged = {
    ...finalized,
    appleItemId: undefined,
    appleExternalId: undefined,
    occurrenceDate: undefined,
    syncState: "pending" as const,
    pendingDirection: "vault" as const,
  };
  const resolved = resolveCalendarWriteOverride(finalized.notePath, 123, staged, {
    event: finalized,
    modifiedAt: 123,
  });
  assert.equal(resolved.event?.appleExternalId, "external_1");
  assert.equal(resolved.event?.syncState, "clean");
  assert.equal(resolved.retainOverride, true);
});

test("releases a Calendar write override after metadata catches up or the file changes", () => {
  const finalized = { ...linked, notePath: "Calendar/Events/review.md", syncState: "clean" as const };
  assert.deepEqual(resolveCalendarWriteOverride(finalized.notePath, 123, { ...finalized }, {
    event: finalized,
    modifiedAt: 123,
  }), { event: finalized, retainOverride: false });

  const edited = { ...finalized, title: "User edit" };
  assert.deepEqual(resolveCalendarWriteOverride(finalized.notePath, 124, edited, {
    event: finalized,
    modifiedAt: 123,
  }), { event: edited, retainOverride: false });
});

test("Calendar write overrides retain the helper's external version until Markdown catches up", () => {
  const finalized = {
    ...linked,
    notePath: "Calendar/Events/review.md",
    externalModifiedAt: "2026-07-23T08:15:00Z",
    syncState: "clean" as const,
  };
  const stale = { ...finalized, externalModifiedAt: "2026-07-23T08:00:00Z" };
  const resolved = resolveCalendarWriteOverride(finalized.notePath, 123, stale, {
    event: finalized,
    modifiedAt: 123,
  });
  assert.equal(resolved.event?.externalModifiedAt, "2026-07-23T08:15:00Z");
  assert.equal(resolved.retainOverride, true);
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
  assert.match(linkedEventSaveBlockReason({
    ...linked, syncState: "unavailable", unavailableReason: "confirmed-missing",
  }) ?? "", /Recreate or Detach/);
  assert.match(linkedEventSaveBlockReason({
    ...linked, syncState: "unavailable", unavailableReason: "calendar-deselected",
  }) ?? "", /Select this calendar/);
  assert.match(linkedEventSaveBlockReason({ ...linked, syncState: "unavailable" }) ?? "", /Retry Sync.*Recreate/);
  assert.match(linkedEventSaveBlockReason({ ...linked, syncState: "conflict" }) ?? "", /Resolve/);
  assert.match(linkedEventSaveBlockReason({
    ...linked,
    syncState: "pending",
    pendingDirection: "external",
  }) ?? "", /newer changes/);
  assert.equal(linkedEventSaveBlockReason({ ...linked, syncState: "pending", pendingDirection: "vault" }), undefined);
  const pendingCreate = {
    ...linked,
    appleItemId: undefined,
    clientRequestId: "request-1",
    syncState: "pending" as const,
    pendingDirection: "vault" as const,
    syncHash: eventSyncHash(linked),
  };
  assert.equal(linkedEventSaveBlockReason(pendingCreate), undefined);
  assert.match(
    linkedEventSaveBlockReason({ ...pendingCreate, start: "2026-07-25T12:00:00.000Z" }) ?? "",
    /changed after it was sent/,
  );
  assert.equal(linkedEventSaveBlockReason({ ...linked, syncState: "clean" }), undefined);
  assert.equal(linkedEventSaveBlockReason({ ...linked, source: "vault", syncState: "unavailable" }), undefined);
});
