import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarConflictVersionFields,
  calendarEditorInputValue,
  calendarEditorRangeForMode,
  calendarEditorStoredValue,
  calendarRangeValidationTarget,
  calendarRangeValidationMessage,
  calendarRecoveryPresentation,
  deviceTimeZoneName,
  deviceTimeZoneDescription,
  eventMatchesSourceFilter,
  eventSourceFilterControlState,
  eventSourceFilterSummary,
  eventSourcePresentation,
  replaceCalendarEvents,
  toggleSourceFilter,
} from "../src/calendar-ui.ts";

test("calendar source filters include only enabled sources", () => {
  const enabled = new Set(["vault", "linked"] as const);
  assert.equal(eventMatchesSourceFilter("vault", enabled), true);
  assert.equal(eventMatchesSourceFilter("external", enabled), false);
  assert.equal(eventMatchesSourceFilter("linked", enabled), true);
});

test("event editor converts timestamps to readable local input values and back", () => {
  const stored = "2026-08-17T10:30:00.000Z";
  const input = calendarEditorInputValue(stored, false);
  assert.match(input, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(calendarEditorStoredValue(input, false), stored);
});

test("all-day editor preserves ISO calendar dates", () => {
  assert.equal(calendarEditorInputValue("2026-08-17", true), "2026-08-17");
  assert.equal(calendarEditorStoredValue("2026-08-18", true), "2026-08-18");
  assert.equal(calendarEditorStoredValue("not-a-date", true), null);
});

test("source filters never disable every source at once", () => {
  const vaultOnly = new Set(["vault"] as const);
  assert.deepEqual([...toggleSourceFilter(vaultOnly, "vault")], ["vault"]);
  assert.deepEqual([...toggleSourceFilter(vaultOnly, "external")].sort(), ["external", "vault"]);
  assert.deepEqual(eventSourceFilterControlState(vaultOnly, "vault"), {
    enabled: true,
    disabled: true,
    ariaLabel: "Vault only events shown. At least one source must remain visible. Markdown event note.",
    title: "At least one event source must remain visible",
  });
  assert.equal(eventSourceFilterControlState(vaultOnly, "external").disabled, false);
});

test("calendar source presentation stays consistent across Calendar and Home", () => {
  assert.deepEqual(eventSourcePresentation("vault"), {
    label: "Vault only",
    description: "Markdown event note",
    glyph: "□",
  });
  assert.deepEqual(eventSourcePresentation("external"), {
    label: "Calendar only",
    description: "macOS Calendar event",
    glyph: "■",
  });
  assert.deepEqual(eventSourcePresentation("linked"), {
    label: "Linked",
    description: "Note synced with Calendar",
    glyph: "◧",
  });
  assert.equal(eventSourceFilterSummary(new Set(["vault", "external", "linked"])), "Sources · All");
  assert.equal(eventSourceFilterSummary(new Set(["vault", "linked"])), "Sources · 2 of 3");
});

test("event editor names the device timezone and explains range errors by mode", () => {
  assert.equal(
    deviceTimeZoneDescription("Pacific/Auckland"),
    "Times use this device's time zone: Pacific/Auckland.",
  );
  assert.equal(
    calendarRangeValidationMessage("End must be after start", false),
    "Choose an End time after Start.",
  );
  assert.equal(
    calendarRangeValidationMessage("End must be after start", true),
    "Choose an End date after Start. For a one-day event, choose the next date.",
  );
  assert.equal(calendarRangeValidationMessage(null, true), null);
  assert.equal(calendarRangeValidationTarget("Start must be an ISO date or timestamp"), "start");
  assert.equal(calendarRangeValidationTarget("End must be after start"), "end");
  assert.equal(calendarRangeValidationTarget("Start and end must both be ISO dates or both be timestamps"), "both");
});

test("Calendar recovery keeps Recreate behind an explicit duplicate-risk confirmation", () => {
  assert.deepEqual(calendarRecoveryPresentation({
    syncState: "unavailable",
    unavailableReason: "confirmed-missing",
  }), {
    label: "Calendar event not verified",
    description: "The saved Calendar identifier may have changed after a move or full sync. Retry Sync, or use Recreate… only after checking that the event is gone in Calendar.",
    showRecreate: true,
    showRetrySync: true,
  });
  for (const unavailableReason of ["outside-window", "unknown"] as const) {
    const presentation = calendarRecoveryPresentation({ syncState: "unavailable", unavailableReason });
    assert.equal(presentation?.showRecreate, true);
    assert.equal(presentation?.showRetrySync, true);
  }
  assert.equal(calendarRecoveryPresentation({
    syncState: "unavailable", unavailableReason: "calendar-deselected",
  })?.showRecreate, false);
  const readFailure = calendarRecoveryPresentation({
    syncState: "error",
    unavailableReason: "setup-or-read-failure",
  });
  assert.equal(readFailure?.label, "Calendar sync paused");
  assert.match(readFailure?.description ?? "", /Check Calendar setup/);
  assert.equal(calendarRecoveryPresentation({ syncState: "unavailable" })?.showRecreate, true);
  assert.equal(calendarRecoveryPresentation({ syncState: "clean" }), null);
});

test("calendar conflict comparison exposes the values needed for a safe choice", () => {
  assert.deepEqual(calendarConflictVersionFields({
    title: "CAL-03 – Note 1",
    start: "2026-10-08",
    end: "2026-10-09",
    allDay: true,
    location: "Vault room",
  }), [
    { label: "Title", value: "CAL-03 – Note 1" },
    { label: "Time", value: "2026-10-08 to 2026-10-09 · end date excluded" },
    { label: "Location", value: "Vault room" },
  ]);
  const timed = calendarConflictVersionFields({
    title: "CAL-03 timed",
    start: "2026-10-08T10:00:00Z",
    end: "2026-10-08T11:00:00Z",
    allDay: false,
  }, "en-NZ");
  assert.match(timed[1].value, new RegExp(` · ${deviceTimeZoneName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "u"));
});

test("all-day input can be derived from timestamps when toggling modes", () => {
  const allDayInput = calendarEditorInputValue("2026-08-17T10:30:00.000Z", true);
  assert.match(allDayInput, /^\d{4}-\d{2}-\d{2}$/);
});

test("switching a same-day timed event to all-day creates an exclusive next-day end", () => {
  const range = calendarEditorRangeForMode(
    "2026-08-17T08:00:00.000Z",
    "2026-08-17T09:00:00.000Z",
    true,
  );
  assert.ok(range);
  assert.match(range.start, /^\d{4}-\d{2}-\d{2}$/u);
  assert.match(range.end, /^\d{4}-\d{2}-\d{2}$/u);
  assert.ok(range.end > range.start);
});

test("calendar refresh replaces event sources without touching view state", () => {
  const calls: string[] = [];
  const calendar = {
    removeAllEventSources() {
      calls.push("remove");
    },
    addEventSource(source: Record<string, unknown>[]) {
      calls.push(`add:${source.length}`);
    },
  };
  const events = [
    { id: "one", title: "One" },
    { id: "two", title: "Two" },
  ];

  replaceCalendarEvents(calendar, events);

  assert.deepEqual(calls, ["remove", "add:2"]);
});
