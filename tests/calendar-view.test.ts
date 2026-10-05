import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { calendarConflictVersionFields, calendarRecoveryPresentation } from "../src/calendar-ui.ts";
import { isCalendarNoteErrorRecord } from "../src/calendar-sync.ts";

const source = readFileSync(resolve("src/calendar-view.ts"), "utf8");
const styles = readFileSync(resolve("src/styles.css"), "utf8");
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

test("Calendar source filters use progressive disclosure without losing pressed state", () => {
  assert.match(source, /createEl\("details", \{ cls: "omd-calendar-source-filter" \}\)/u);
  assert.match(source, /text: eventSourceFilterSummary\(this\.enabledSources\)/u);
  assert.match(source, /aria-label": `\$\{eventSourceFilterSummary\(this\.enabledSources\)\}\. Filter events by source\.`/u);
  assert.match(source, /this\.sourceFilterSummaryEl\?\.setAttribute\("aria-label", `\$\{summary\}\. Filter events by source\.`\)/u);
  assert.match(source, /eventSourceFilterControlState\(enabledSources, source\)/u);
  assert.match(source, /button\.setAttribute\("aria-disabled", String\(state\.disabled\)\)/u);
  assert.match(source, /At least one event source must remain visible/u);
  assert.match(source, /button\.ariaPressed = String\(state\.enabled\)/u);
  assert.match(source, /omd-calendar-source-description/u);
});

test("Calendar view reports review states instead of declaring every Sync complete", () => {
  assert.match(source, /new Notice\(calendarSyncResultMessage\(summary\)\)/u);
  assert.match(source, /synchronizeCalendarEvents\?: \(\) => Promise<CalendarSyncSummary>/u);
});

test("event range errors stay inline and accessible until the range is corrected", () => {
  assert.match(source, /cls: "omd-event-validation is-error"/u);
  assert.match(source, /role: "alert"/u);
  assert.match(source, /const target = calendarRangeValidationTarget\(validationError\)/u);
  assert.match(source, /target === "start"[\s\S]*\[startInput\][\s\S]*\[endInput\]/u);
  assert.match(source, /input\.setAttribute\("aria-invalid", "true"\)/u);
  assert.match(source, /if \(focusEnd\) invalidInputs\[0\]\?\.focus\(\)/u);
  assert.match(source, /input\.removeAttribute\("aria-invalid"\)/u);
  const validationStart = source.indexOf("this.rangeValidationEl = this.contentEl.createDiv");
  const validationEnd = source.indexOf("this.rangeValidationEl.hidden = true", validationStart);
  assert.ok(validationStart >= 0 && validationEnd > validationStart);
  assert.doesNotMatch(source.slice(validationStart, validationEnd), /aria-live/u);
  assert.doesNotMatch(extractFunctionBody(source, "private async saveDraft"), /new Notice\(validationError\)/u);
});

test("event editor names the device timezone and compares both conflict versions", () => {
  assert.match(source, /text: deviceTimeZoneDescription\(\)/u);
  assert.match(source, /type: this\.draft\.allDay \? "date" : "datetime-local"/u);
  assert.match(source, /this\.renderVersion\(versions, "Note version", this\.event\)/u);
  assert.match(source, /this\.renderVersion\(versions, "Calendar version", this\.event\.conflictExternal \?\? this\.event\)/u);
  assert.match(source, /Nothing has been overwritten/u);
  const conflictBody = extractFunctionBody(source, "class EventConflictModal");
  assert.match(conflictBody, /Use note version/u);
  assert.match(conflictBody, /Use calendar version/u);
  assert.doesNotMatch(conflictBody, /setCta\(\)/u);
  assert.match(source, /text\.inputEl\.dir = "auto"/u);
  assert.match(source, /content\.setAttribute\("aria-label", accessibleLabel\)/u);
});

test("destructive Calendar confirmations identify the selected event and destination", () => {
  const selected = {
    title: "Quarterly review / 季度复盘",
    start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z",
    allDay: false,
    calendar: "Work",
    notePath: "Calendar/Events/Quarterly review.md",
  };
  const time = calendarConflictVersionFields(selected)[1].value;
  assert.deepEqual(
    helpers.calendarConfirmationIdentityFields(selected, { notePath: true }).map((field) => [field.label, field.value]),
    [["Title", selected.title], ["Time", time], ["Note path", selected.notePath]],
  );
  assert.deepEqual(
    helpers.calendarConfirmationIdentityFields(selected, { calendar: true }).map((field) => [field.label, field.value]),
    [["Title", selected.title], ["Time", time], ["Calendar", "Work"]],
  );
  assert.match(source, /renderCalendarConfirmationIdentity\(this\.contentEl, this\.event, \{ notePath: true \}\)/u);
  assert.match(source, /renderCalendarConfirmationIdentity\(this\.contentEl, this\.event, \{ calendar: true \}\)/u);
  assert.match(source, /attr: \{ dir: field\.dir \}/u);
});

test("switching All day restores keyboard focus after the editor redraw", () => {
  assert.match(source, /this\.allDayToggleEl = toggle\.toggleEl/u);
  assert.match(source, /this\.contentEl\.empty\(\);[\s\S]*this\.onOpen\(\);[\s\S]*this\.allDayToggleEl\?\.focus\(\)/u);
});

test("event cards repeat the source key glyph and expose their visible time to assistive technology", () => {
  assert.match(source, /const sourcePresentation = eventSourcePresentation\(source\)/u);
  assert.match(source, /const accessibleTime = info\.timeText \|\| "All day"/u);
  assert.match(
    source,
    /const accessibleLabel = \[info\.event\.title, accessibleTime, sourcePresentation\.label, statusLabel\]/u,
  );
  assert.match(
    source,
    /cls: `omd-calendar-event-source is-\$\{source\}`,[\s\S]*text: sourcePresentation\.glyph,[\s\S]*"aria-hidden": "true"/u,
  );
  assert.match(
    styles,
    /\.omd-calendar-event-source\s*\{[^}]*flex:\s*0 0 auto;[^}]*width:\s*1ch;[^}]*font:[^}]*var\(--font-monospace\);/su,
  );
  assert.match(
    source,
    /cls: "omd-calendar-event-status",[\s\S]*"aria-hidden": "true"[\s\S]*cls: "omd-calendar-event-status-label", text: statusLabel/u,
  );
  assert.doesNotMatch(source, /cls: "omd-calendar-event-status", text:/u);
  assert.match(
    styles,
    /\.omd-calendar-event-status-label\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/su,
  );
});

function loadCalendarViewHelpers(fileSource: string): {
  destinationOptions: (source: string, defaultCalendarTitle?: string) => Array<{ value: string; label: string }>;
  validateCalendarEventRange: (start: string, end: string) => string | null;
  calendarStatusLabel: (syncState?: string) => string | null;
  calendarEventEditable: (event: { source: string; syncState?: string; readOnly?: boolean }) => boolean;
  requiresSyncBeforeEdit: (event: { syncState?: string; pendingDirection?: string }) => boolean;
  calendarEditorCapabilities: (event: { id?: string; source: string; syncState?: string; unavailableReason?: string; readOnly?: boolean; appleItemId?: string; notePath?: string }) => {
    showSave: boolean; showDelete: boolean; showDestination: boolean; showCreateLinkedNote: boolean;
    showDeleteNote: boolean; showDetach: boolean; showRecreate: boolean; showRetrySync: boolean;
  };
  calendarEditorSaveBlockReason: (event: { id?: string; source: string; syncState?: string; unavailableReason?: string; readOnly?: boolean; notePath?: string }) => string | undefined;
  calendarConfirmationIdentityFields: (
    event: { title: string; start: string; end: string; allDay: boolean; calendar?: string; notePath?: string },
    details: { notePath?: boolean; calendar?: boolean },
  ) => Array<{ label: string; value: string; dir: string }>;
} {
  const destinationOptionsBody = extractFunctionBody(fileSource, "export function destinationOptions");
  const validateRangeBody = extractFunctionBody(fileSource, "export function validateCalendarEventRange");
  const parseIsoBoundaryBody = extractFunctionBody(fileSource, "function parseIsoBoundary");
  const statusLabelBody = extractFunctionBody(fileSource, "export function calendarStatusLabel");
  const editableBody = extractFunctionBody(fileSource, "export function calendarEventEditable");
  const requiresSyncBody = extractFunctionBody(fileSource, "export function requiresSyncBeforeEdit");
  const capabilitiesBody = extractFunctionBody(fileSource, "export function calendarEditorCapabilities");
  const saveBlockBody = extractFunctionBody(fileSource, "export function calendarEditorSaveBlockReason");
  const confirmationIdentityBody = extractFunctionBody(fileSource, "export function calendarConfirmationIdentityFields");
  return Function("calendarRecoveryPresentation", "isCalendarNoteErrorRecord", "calendarConflictVersionFields", `
    function destinationOptions(source, defaultCalendarTitle) ${destinationOptionsBody}
    function validateCalendarEventRange(start, end) ${validateRangeBody}
    function parseIsoBoundary(value) ${parseIsoBoundaryBody}
    function calendarStatusLabel(syncState) ${statusLabelBody}
    function calendarEventEditable(event) ${editableBody}
    function requiresSyncBeforeEdit(event) ${requiresSyncBody}
    function calendarEditorCapabilities(event) ${capabilitiesBody}
    function calendarEditorSaveBlockReason(event) ${saveBlockBody}
    function calendarConfirmationIdentityFields(event, details) ${confirmationIdentityBody}
    return { destinationOptions, validateCalendarEventRange, calendarStatusLabel, calendarEventEditable, requiresSyncBeforeEdit, calendarEditorCapabilities, calendarEditorSaveBlockReason, calendarConfirmationIdentityFields };
  `)(calendarRecoveryPresentation, isCalendarNoteErrorRecord, calendarConflictVersionFields) as ReturnType<typeof loadCalendarViewHelpers>;
}

test("linked events with unresolved sync states cannot be dragged over another version", () => {
  assert.equal(helpers.calendarEventEditable({ source: "linked", syncState: "conflict" }), false);
  assert.equal(helpers.calendarEventEditable({ source: "linked", syncState: "unavailable" }), false);
  assert.equal(helpers.calendarEventEditable({ source: "linked", syncState: "clean" }), true);
  assert.equal(helpers.calendarEventEditable({ source: "external", syncState: "clean", readOnly: true }), false);
});

test("Calendar-origin pending changes require sync while read failures open local recovery actions", () => {
  assert.equal(helpers.requiresSyncBeforeEdit({ syncState: "pending", pendingDirection: "external" }), true);
  assert.equal(helpers.requiresSyncBeforeEdit({ syncState: "pending", pendingDirection: "vault" }), false);
  assert.equal(helpers.requiresSyncBeforeEdit({ syncState: "error" }), false);
});

test("unavailable linked events expose only recovery actions", () => {
  const unverified = helpers.calendarEditorCapabilities({
    source: "linked", syncState: "unavailable", unavailableReason: "unknown", appleItemId: "stale",
  });
  assert.equal(unverified.showSave, false);
  assert.equal(unverified.showDelete, false);
  assert.equal(unverified.showDeleteNote, false);
  assert.equal(unverified.showDestination, false);
  assert.equal(unverified.showRecreate, true);
  assert.equal(unverified.showRetrySync, true);
  assert.match(helpers.calendarEditorSaveBlockReason({ source: "linked", syncState: "unavailable" }) ?? "", /Recreate or Detach/);

  const missing = helpers.calendarEditorCapabilities({
    source: "linked", syncState: "unavailable", unavailableReason: "confirmed-missing", appleItemId: "stale",
  });
  assert.equal(missing.showRecreate, true);
  assert.equal(missing.showRetrySync, true);
  assert.match(helpers.calendarEditorSaveBlockReason({
    source: "linked", syncState: "unavailable", unavailableReason: "confirmed-missing",
  }) ?? "", /Recreate or Detach/);
});

test("vault notes and paused linked notes retain explicit local cleanup actions", () => {
  const vault = helpers.calendarEditorCapabilities({
    source: "vault", syncState: "clean", notePath: "Calendar/Events/Vault.md",
  });
  assert.equal(vault.showDeleteNote, true);
  assert.equal(vault.showDetach, false);

  const paused = helpers.calendarEditorCapabilities({
    source: "linked",
    syncState: "error",
    unavailableReason: "setup-or-read-failure",
    appleItemId: "stale",
    notePath: "Calendar/Events/Linked.md",
  });
  assert.equal(paused.showSave, false);
  assert.equal(paused.showDestination, false);
  assert.equal(paused.showDelete, false);
  assert.equal(paused.showDeleteNote, true);
  assert.equal(paused.showDetach, true);
  assert.equal(paused.showRetrySync, true);
  assert.match(helpers.calendarEditorSaveBlockReason({
    source: "linked", syncState: "error", unavailableReason: "setup-or-read-failure",
  }) ?? "", /Retry Sync.*Detach/);
});

test("an invalid event note can be removed without offering a detach action that cannot parse it", () => {
  const capabilities = helpers.calendarEditorCapabilities({
    id: "calendar-note-error:Calendar/Events/Broken.md",
    source: "linked",
    syncState: "error",
    notePath: "Calendar/Events/Broken.md",
  });
  assert.equal(capabilities.showSave, false);
  assert.equal(capabilities.showDeleteNote, true);
  assert.equal(capabilities.showDetach, false);
  assert.equal(capabilities.showRetrySync, true);
  const guidance = helpers.calendarEditorSaveBlockReason({
    id: "calendar-note-error:Calendar/Events/Broken.md",
    source: "linked",
    syncState: "error",
    notePath: "Calendar/Events/Broken.md",
  }) ?? "";
  assert.match(guidance, /Fix the event note.*Delete event note/);
  assert.doesNotMatch(guidance, /Detach/);

  const prefixCollision = helpers.calendarEditorCapabilities({
    id: "calendar-note-error:user-authored-id",
    source: "linked",
    syncState: "error",
    notePath: "Calendar/Events/Valid.md",
  });
  assert.equal(prefixCollision.showDetach, true, "a user-authored ID prefix is not the internal error sentinel");
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

test("read-only linked events can detach or remove their note without offering an impossible Save", () => {
  const capabilities = helpers.calendarEditorCapabilities({
    source: "linked",
    syncState: "clean",
    readOnly: true,
    appleItemId: "readonly-linked",
    notePath: "Calendar/Events/Read-only linked.md",
  });
  assert.equal(capabilities.showSave, false);
  assert.equal(capabilities.showDelete, false);
  assert.equal(capabilities.showDestination, false);
  assert.equal(capabilities.showCreateLinkedNote, false);
  assert.equal(capabilities.showDeleteNote, true);
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
