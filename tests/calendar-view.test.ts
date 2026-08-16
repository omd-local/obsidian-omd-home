import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve("src/calendar-view.ts"), "utf8");
const helpers = loadCalendarViewHelpers(source);

test("external events keep a Calendar-only destination instead of defaulting to linked", () => {
  assert.deepEqual(helpers.destinationOptions("external", "Work").map((option) => option.value), ["external", "linked"]);
});

test("linked events no longer offer detach-through-save destination changes", () => {
  assert.deepEqual(helpers.destinationOptions("linked", "Work").map((option) => option.value), ["linked"]);
});

test("calendar editor validates ISO ranges and requires end after start", () => {
  assert.equal(helpers.validateCalendarEventRange("not-a-date", "2026-08-09"), "Start must be an ISO date or timestamp");
  assert.equal(
    helpers.validateCalendarEventRange("2026-08-09T10:00:00Z", "2026-08-09"),
    "Start and end must both be ISO dates or both be timestamps",
  );
  assert.equal(
    helpers.validateCalendarEventRange("2026-08-09T11:00:00Z", "2026-08-09T11:00:00Z"),
    "End must be after start",
  );
  assert.equal(helpers.validateCalendarEventRange("2026-08-09", "2026-08-10"), null);
});

test("calendar statuses are surfaced with user-facing labels", () => {
  assert.equal(helpers.calendarStatusLabel("pending"), "Pending sync");
  assert.equal(helpers.calendarStatusLabel("unavailable"), "Unavailable");
  assert.equal(helpers.calendarStatusLabel("error"), "Sync paused");
  assert.equal(helpers.calendarStatusLabel("clean"), null);
});

function loadCalendarViewHelpers(fileSource: string): {
  destinationOptions: (source: string, defaultCalendarTitle?: string) => Array<{ value: string; label: string }>;
  validateCalendarEventRange: (start: string, end: string) => string | null;
  calendarStatusLabel: (syncState?: string) => string | null;
  calendarEventEditable: (event: { source: string; syncState?: string; readOnly?: boolean }) => boolean;
  requiresSyncBeforeEdit: (event: { syncState?: string; pendingDirection?: string }) => boolean;
  calendarEditorCapabilities: (event: { source: string; syncState?: string; readOnly?: boolean; appleItemId?: string }) => {
    showSave: boolean; showDelete: boolean; showDestination: boolean; showCreateLinkedNote: boolean;
  };
  calendarEditorSaveBlockReason: (event: { source: string; syncState?: string; readOnly?: boolean }) => string | undefined;
} {
  const destinationOptionsBody = extractFunctionBody(fileSource, "export function destinationOptions");
  const validateRangeBody = extractFunctionBody(fileSource, "export function validateCalendarEventRange");
  const parseIsoBoundaryBody = extractFunctionBody(fileSource, "function parseIsoBoundary");
  const statusLabelBody = extractFunctionBody(fileSource, "export function calendarStatusLabel");
  const editableBody = extractFunctionBody(fileSource, "export function calendarEventEditable");
  const requiresSyncBody = extractFunctionBody(fileSource, "export function requiresSyncBeforeEdit");
  const capabilitiesBody = extractFunctionBody(fileSource, "export function calendarEditorCapabilities");
  const saveBlockBody = extractFunctionBody(fileSource, "export function calendarEditorSaveBlockReason");
  return Function(`
    function destinationOptions(source, defaultCalendarTitle) ${destinationOptionsBody}
    function validateCalendarEventRange(start, end) ${validateRangeBody}
    function parseIsoBoundary(value) ${parseIsoBoundaryBody}
    function calendarStatusLabel(syncState) ${statusLabelBody}
    function calendarEventEditable(event) ${editableBody}
    function requiresSyncBeforeEdit(event) ${requiresSyncBody}
    function calendarEditorCapabilities(event) ${capabilitiesBody}
    function calendarEditorSaveBlockReason(event) ${saveBlockBody}
    return { destinationOptions, validateCalendarEventRange, calendarStatusLabel, calendarEventEditable, requiresSyncBeforeEdit, calendarEditorCapabilities, calendarEditorSaveBlockReason };
  `)() as ReturnType<typeof loadCalendarViewHelpers>;
}

test("linked events with unresolved sync states cannot be dragged over another version", () => {
  assert.equal(helpers.calendarEventEditable({ source: "linked", syncState: "conflict" }), false);
  assert.equal(helpers.calendarEventEditable({ source: "linked", syncState: "unavailable" }), false);
  assert.equal(helpers.calendarEventEditable({ source: "linked", syncState: "clean" }), true);
  assert.equal(helpers.calendarEventEditable({ source: "external", syncState: "clean", readOnly: true }), false);
});

test("Calendar-origin pending changes and fetch errors require sync before editing", () => {
  assert.equal(helpers.requiresSyncBeforeEdit({ syncState: "pending", pendingDirection: "external" }), true);
  assert.equal(helpers.requiresSyncBeforeEdit({ syncState: "pending", pendingDirection: "vault" }), false);
  assert.equal(helpers.requiresSyncBeforeEdit({ syncState: "error" }), true);
});

test("unavailable linked events expose only recovery actions", () => {
  const capabilities = helpers.calendarEditorCapabilities({
    source: "linked", syncState: "unavailable", appleItemId: "stale",
  });
  assert.equal(capabilities.showSave, false);
  assert.equal(capabilities.showDelete, false);
  assert.equal(capabilities.showDestination, false);
  assert.match(helpers.calendarEditorSaveBlockReason({ source: "linked", syncState: "unavailable" }) ?? "", /Recreate or Detach/);
});

test("read-only Calendar events can create a linked note without exposing writes", () => {
  const capabilities = helpers.calendarEditorCapabilities({
    source: "external", syncState: "clean", readOnly: true, appleItemId: "readonly",
  });
  assert.equal(capabilities.showSave, false);
  assert.equal(capabilities.showDelete, false);
  assert.equal(capabilities.showDestination, false);
  assert.equal(capabilities.showCreateLinkedNote, true);
  assert.match(helpers.calendarEditorSaveBlockReason({ source: "external", readOnly: true }) ?? "", /read-only/);
});

function extractFunctionBody(fileSource: string, signature: string): string {
  const start = fileSource.indexOf(signature);
  if (start < 0) throw new Error(`Missing ${signature}`);
  const bodyStart = findBlockStart(fileSource, start);
  let depth = 0;
  for (let index = bodyStart; index < fileSource.length; index += 1) {
    const char = fileSource[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return fileSource.slice(bodyStart, index + 1);
  }
  throw new Error(`Unclosed body for ${signature}`);
}

function findBlockStart(fileSource: string, start: number): number {
  for (let index = start; index < fileSource.length - 1; index += 1) {
    if (fileSource[index] === "{" && fileSource[index + 1] === "\n") return index;
  }
  throw new Error(`Missing block start after ${start}`);
}
