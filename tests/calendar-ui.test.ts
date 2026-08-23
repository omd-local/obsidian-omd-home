import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarEditorInputValue,
  calendarEditorRangeForMode,
  calendarEditorStoredValue,
  eventMatchesSourceFilter,
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
