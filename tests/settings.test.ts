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
    hybridRetrievalEnabled: false,
    embeddingModel: "  nomic-embed-text  ",
    semanticRerankEnabled: true,
    captureSuggestLinksAndTags: false,
    pinnedNotes: [" Note.md ", null, "Note.md"],
  });
  assert.equal(normalized.openOnLaunch, false);
  assert.equal(normalized.omdExecutable, "omd-local");
  assert.deepEqual(normalized.selectedCalendarIds, ["work"]);
  assert.equal(normalized.defaultExternalCalendarId, "work");
  assert.equal(normalized.aiProvider, "ollama");
  assert.equal(normalized.aiModel, "llama3");
  assert.equal(normalized.hybridRetrievalEnabled, false);
  assert.equal(normalized.embeddingModel, "nomic-embed-text");
  assert.equal(normalized.semanticRerankEnabled, true);
  assert.equal(normalized.captureSuggestLinksAndTags, false);
  assert.deepEqual(normalized.pinnedNotes, ["Note.md"]);
});

test("settings normalization preserves a saved hosted provider without enabling it", () => {
  const normalized = helpers.normalizeOmdHomeSettings({ aiProvider: "openai" });
  assert.equal(normalized.aiProvider, "openai");
  assert.equal(normalized.hybridRetrievalEnabled, true);
  assert.equal(normalized.embeddingModel, "bge-m3");
  assert.equal(normalized.semanticRerankEnabled, false);
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

test("Phase 1a settings hide hosted provider choices and preserve legacy values explicitly", () => {
  const providerStart = source.indexOf('.setName("Provider")');
  const providerEnd = source.indexOf('.setName("Local content boundary")', providerStart);
  const providerBlock = source.slice(providerStart, providerEnd);
  assert.match(providerBlock, /legacy-disabled|preserved (?:but )?disabled|preserved for Vault Q&A/u);
  assert.match(providerBlock, /Use Ollama/u);
  assert.doesNotMatch(providerBlock, /addDropdown|addOption\([^)]*(?:openai|anthropic|deepseek)/u);
});

test("model selectors expose every installed model plus Custom and stale values", () => {
  const optionsStart = source.indexOf("const options = this.plugin.localAiState.models");
  const optionsEnd = source.indexOf("options.__custom__", optionsStart);
  const optionsBlock = source.slice(optionsStart, optionsEnd);
  assert.ok(optionsStart >= 0 && optionsEnd > optionsStart);
  assert.doesNotMatch(optionsBlock, /\.filter\(/u);
  assert.match(source, /options\.__custom__ = "Custom…"/u);
  assert.match(source, /\(saved, not installed\)/u);
  assert.match(source, /\(not text-capable\)/u);
  assert.match(source, /\(remote blocked\)/u);
  assert.match(source, /omd-settings-model/u);
});

test("hybrid retrieval settings keep embedding choices local and expose an embedding smoke check", () => {
  assert.match(source, /hybridRetrievalEnabled:\s*true/u);
  assert.match(source, /embeddingModel:\s*"bge-m3"/u);
  assert.match(source, /semanticRerankEnabled:\s*false/u);
  assert.match(source, /setName\("Hybrid retrieval"\)/u);
  assert.match(source, /setName\("Embedding model"\)/u);
  assert.match(source, /modelSupportsEmbedding\(model\)\s*&&\s*!modelHasRemoteMetadata\(model\)/u);
  assert.match(source, /setButtonText\([^)]*"Test embeddings"/u);
  assert.match(source, /testLocalEmbeddings\(\)/u);
  assert.equal([...source.matchAll(/invalidateLocalAiState\("retrieval"\)/gu)].length, 3);
});

test("Local AI settings rerender only their section and expose durable action feedback", () => {
  assert.match(source, /omd-settings-local-ai/u);
  assert.match(source, /renderLocalAiSection\(localAiSection\)/u);
  assert.match(source, /localAiFeedback/u);
  assert.match(source, /omd-settings-feedback/u);
});

test("Calendar settings explain the installed EventKit helper and actionable empty states", () => {
  assert.match(source, /resolvedEventKitHelperPath/u);
  assert.match(source, /hasEventKitHelper/u);
  assert.match(source, /Using the installed helper automatically/u);
  assert.match(source, /not found or is not executable/u);
  assert.match(source, /macOS may ask for Calendar access/u);
});

test("Python bridge settings prefer the bundled bridge while retaining an explicit override", () => {
  assert.match(source, /Using the bridge bundled inside OMD Home automatically/u);
  assert.match(source, /When blank, read the interpreter from the OMD launcher's Python shebang/u);
  assert.match(source, /setButtonText\("Use bundled"\)/u);
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
