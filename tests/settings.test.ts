import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve("src/settings.ts"), "utf8");
const helpers = loadSettingsHelpers(source);

const calendars = [
  { id: "work", title: "Work", sourceTitle: "iCloud", allowsModifications: true },
  { id: "holidays", title: "Holidays", sourceTitle: "Subscriptions", allowsModifications: false },
];

test("settings normalization trims strings, filters arrays, and falls back invalid providers", () => {
  const normalized = helpers.normalizeOmdHomeSettings({
    openOnLaunch: false,
    omdExecutable: "  omd-local  ",
    selectedCalendarIds: ["work", "", "work", 42],
    defaultExternalCalendarId: "  work  ",
    aiProvider: "bogus",
    aiModel: "  llama3  ",
    pinnedNotes: [" Note.md ", null, "Note.md"],
  });
  assert.equal(normalized.openOnLaunch, false);
  assert.equal(normalized.omdExecutable, "omd-local");
  assert.deepEqual(normalized.selectedCalendarIds, ["work"]);
  assert.equal(normalized.defaultExternalCalendarId, "work");
  assert.equal(normalized.aiProvider, "ollama");
  assert.equal(normalized.aiModel, "llama3");
  assert.deepEqual(normalized.pinnedNotes, ["Note.md"]);
});

test("calendar selection reconciliation clears stale and read-only defaults", () => {
  const reconciled = helpers.reconcileCalendarSelection({
    ...helpers.DEFAULT_SETTINGS,
    selectedCalendarIds: ["work", "missing", "holidays"],
    defaultExternalCalendarId: "holidays",
  }, calendars);
  assert.deepEqual(reconciled.selectedCalendarIds, ["work", "holidays"]);
  assert.equal(reconciled.defaultExternalCalendarId, "");
});

test("default calendar normalization clears deselected defaults", () => {
  assert.equal(helpers.normalizeDefaultExternalCalendarId("work", calendars, []), "");
  assert.equal(helpers.normalizeDefaultExternalCalendarId("work", calendars, ["work"]), "work");
});

test("an unavailable calendar list does not erase persisted selections", () => {
  const settings = { ...helpers.DEFAULT_SETTINGS, selectedCalendarIds: ["work"], defaultExternalCalendarId: "work" };
  assert.deepEqual(helpers.reconcileCalendarSelection(settings, []), settings);
});

function loadSettingsHelpers(fileSource: string): {
  DEFAULT_SETTINGS: Record<string, unknown>;
  normalizeOmdHomeSettings: (raw: unknown) => Record<string, unknown>;
  reconcileCalendarSelection: (settings: Record<string, unknown>, calendars: Array<Record<string, unknown>>) => Record<string, unknown>;
  normalizeDefaultExternalCalendarId: (defaultCalendarId: string, calendars: Array<Record<string, unknown>>, selectedCalendarIds: string[]) => string;
} {
  const defaults = extractConstObject(fileSource, "export const DEFAULT_SETTINGS");
  const normalizeBody = extractFunctionBody(fileSource, "export function normalizeOmdHomeSettings")
    .replaceAll(" as Partial<OmdHomeSettings>", "")
    .replaceAll(" as OmdHomeSettings[\"aiProvider\"]", "");
  const reconcileBody = extractFunctionBody(fileSource, "export function reconcileCalendarSelection");
  const normalizeDefaultBody = extractFunctionBody(fileSource, "export function normalizeDefaultExternalCalendarId");
  const cleanStringBody = extractFunctionBody(fileSource, "function cleanString");
  const uniqueStringsBody = extractFunctionBody(fileSource, "function uniqueStrings")
    .replace(/\(entry\): entry is string =>/g, "(entry) =>");
  return Function(`
    const AI_PROVIDERS = new Set(["ollama", "openai", "anthropic", "deepseek"]);
    const DEFAULT_SETTINGS = ${defaults};
    function normalizeOmdHomeSettings(raw) ${normalizeBody}
    function reconcileCalendarSelection(settings, calendars) ${reconcileBody}
    function normalizeDefaultExternalCalendarId(defaultCalendarId, calendars, selectedCalendarIds) ${normalizeDefaultBody}
    function cleanString(value, fallback) ${cleanStringBody}
    function uniqueStrings(value) ${uniqueStringsBody}
    return { DEFAULT_SETTINGS, normalizeOmdHomeSettings, reconcileCalendarSelection, normalizeDefaultExternalCalendarId };
  `)() as ReturnType<typeof loadSettingsHelpers>;
}

function extractConstObject(fileSource: string, signature: string): string {
  const start = fileSource.indexOf(signature);
  if (start < 0) throw new Error(`Missing ${signature}`);
  const valueStart = findBlockStart(fileSource, start);
  let depth = 0;
  for (let index = valueStart; index < fileSource.length; index += 1) {
    const char = fileSource[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return fileSource.slice(valueStart, index + 1);
  }
  throw new Error(`Unclosed object for ${signature}`);
}

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
