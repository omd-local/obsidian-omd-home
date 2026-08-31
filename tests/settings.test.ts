import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve("src/settings.ts"), "utf8");
const stylesSource = readFileSync(resolve("src/styles.css"), "utf8");
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

test("settings normalization preserves a saved hosted provider and its model memory", () => {
  const normalized = helpers.normalizeOmdHomeSettings({ aiProvider: "openai" });
  assert.equal(normalized.aiProvider, "openai");
  assert.equal(normalized.aiModel, "");
  assert.equal(normalized.hybridRetrievalEnabled, true);
  assert.equal(normalized.embeddingModel, "bge-m3");
  assert.equal(normalized.semanticRerankEnabled, false);
});

test("settings normalization does not persist hosted credentials in plugin data", () => {
  const normalized = helpers.normalizeOmdHomeSettings({
    aiProvider: "openai",
    apiKey: "should-not-persist",
    openaiApiKey: "should-not-persist",
    anthropicApiKey: "should-not-persist",
    deepseekApiKey: "should-not-persist",
  });
  assert.equal("apiKey" in normalized, false);
  assert.equal("openaiApiKey" in normalized, false);
  assert.equal("anthropicApiKey" in normalized, false);
  assert.equal("deepseekApiKey" in normalized, false);
  const settingsInterface = extractTypeBody(source, "export interface OmdHomeSettings");
  const defaultSettings = extractConstObject(source, "export const DEFAULT_SETTINGS");
  assert.doesNotMatch(settingsInterface, /ApiKey/iu);
  assert.doesNotMatch(defaultSettings, /ApiKey/iu);
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

test("Phase 2 settings expose an explicit provider choice and destination boundary", () => {
  assert.match(source, /setName\("Answer provider"\)/u);
  assert.match(source, /for \(const value of AI_PROVIDER_VALUES\) dropdown\.addOption\(value, aiProviderLabel\(value\)\)/u);
  assert.match(source, /setName\(isCloudAiProvider\(provider\) \? "Cloud boundary" : "Local-only boundary"\)/u);
  assert.match(source, /aiProviderDestination\(provider\)/u);
  assert.match(source, /macOS Keychain/u);
  assert.match(source, /aiProviderEnvVar\(provider\)/u);
  assert.match(source, /Consumer subscriptions do not include API usage/u);
  assert.doesNotMatch(source, /Smoke/u);
  assert.doesNotMatch(source, /setName\("Model catalog"\)/u);
  assert.doesNotMatch(source, /Refresh models/u);
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

test("AI answer settings rerender only their section and expose durable action feedback", () => {
  assert.match(source, /omd-settings-local-ai/u);
  assert.match(source, /renderLocalAiSection\(localAiSection\)/u);
  assert.match(source, /localAiFeedback/u);
  assert.match(source, /omd-settings-feedback/u);
  assert.match(source, /setName\("Answer setup"\)/u);
  assert.match(source, /canOpenOllamaDesktopApp\(\)/u);
  assert.match(source, /setButtonText\("Open Ollama app"\)/u);
  assert.match(source, /this\.plugin\.openOllamaApp\(\)/u);
  assert.match(source, /"Advanced AI controls"/u);
  assert.doesNotMatch(source, /setButtonText\("Cancel"\)/u);
  assert.equal([...source.matchAll(/settingsDisclosure\(\s*container,\s*"(?:Search quality|Local capture and links|Ollama troubleshooting)"/gu)].length, 0);
});

test("changing answer provider clears feedback and issues from the previous provider", () => {
  const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
  assert.match(mainSource, /if \(reason === "provider" \|\| reason === "answer-model"\) \{\s*this\.localAiFeedback = null;\s*this\.clearIssue\("ai"\);\s*\}/u);
  assert.match(source, /invalidateLocalAiState\("answer-model"\)/u);
  assert.match(mainSource, /reason === "answer-model" && this\.hostedAiState\?\.provider === this\.currentHostedProvider\(\)/u);
});

test("hosted credential state is hydrated after provider switch or reload", () => {
  const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
  assert.match(source, /ensureHostedCredentialState\(value\)/u);
  assert.match(source, /ensureHostedCredentialState\(provider\)/u);
  assert.match(mainSource, /if \(isHostedApiProvider\(this\.settings\.aiProvider\)\) \{\s*void this\.ensureHostedCredentialState\(this\.settings\.aiProvider\);\s*\}/u);
  assert.match(mainSource, /const credential = await this\.omdBridge\.hostedCredentialState\(provider\)/u);
  assert.match(mainSource, /credential\.source === "missing"\s*\?\s*"credentials_missing"\s*:\s*model \? "unchecked" : "selected_model_missing"/u);
  assert.match(mainSource, /const startedAt = Date\.now\(\);/u);
  assert.match(mainSource, /if \(existing\?\.activeAction\) return;/u);
  assert.match(mainSource, /if \(existing\?\.checkedAt && existing\.checkedAt > startedAt\) return;/u);
});

test("a failed hosted key save is handled without clearing the user's draft", () => {
  assert.match(source, /let saved = false;[\s\S]+await this\.plugin\.saveHostedApiKey\(draft\);[\s\S]+catch \{[\s\S]+if \(!saved\) \{[\s\S]+setButtonText\("Save key"\);[\s\S]+return;[\s\S]+secret\.setValue\(""\)/u);
});

test("hosted credential controls follow the platform-supported storage path", () => {
  const credentialBlock = extractFunctionBody(source, "private hostedCredentialSetting");
  assert.match(credentialBlock, /if \(!Platform\.isMacOS \|\| credential\?\.keychainSupported === false\)/u);
  assert.match(credentialBlock, /Set \$\{envVar\} before starting Obsidian/u);
  assert.match(credentialBlock, /In-app saving appears only when macOS Keychain is available/u);
  const platformGuard = credentialBlock.indexOf("if (!Platform.isMacOS");
  const earlyReturn = credentialBlock.indexOf("return;", platformGuard);
  const secretControl = credentialBlock.indexOf("new SecretComponent", platformGuard);
  assert.ok(platformGuard >= 0 && earlyReturn > platformGuard && secretControl > earlyReturn);
});

test("hosted key save feedback follows the returned credential source", () => {
  const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
  assert.match(mainSource, /credential\.source === "keychain"/u);
  assert.match(mainSource, /key saved to macOS Keychain/u);
  assert.match(mainSource, /key available from \$\{credential\.envVar\}/u);
  assert.doesNotMatch(mainSource, /key saved to Keychain/u);
});

test("Calendar settings keep the helper override advanced and expose one primary refresh action", () => {
  assert.match(source, /omd-settings-calendar/u);
  assert.match(source, /renderCalendarSection\(calendarSection\)/u);
  assert.match(source, /if \(container\.isConnected\) this\.renderCalendarSection\(container\)/u);
  assert.match(source, /resolvedEventKitHelperPath/u);
  assert.match(source, /hasEventKitHelper/u);
  assert.match(source, /Advanced Calendar helper/u);
  assert.match(source, /Leave this blank to use the helper bundled with the plugin/u);
  assert.match(source, /Google and Outlook accounts already added to macOS Calendar/u);
  assert.match(source, /Refresh calendars/u);
  assert.match(source, /allow Calendar access if macOS asks/u);
});

test("Python bridge settings prefer the bundled bridge while retaining an explicit override", () => {
  assert.match(source, /Using the bridge bundled inside OMD Home automatically/u);
  assert.match(source, /Leave blank to read the interpreter from the detected OMD launcher shebang/u);
  assert.match(source, /setButtonText\("Use bundled"\)/u);
});

test("OMD setup makes automatic discovery primary and keeps path overrides advanced", () => {
  assert.match(source, /renderOmdSetup\(containerEl\)/u);
  assert.doesNotMatch(source, /OMD Home finds compatible local tools automatically/u);
  assert.match(source, /OMD not installed/u);
  assert.match(source, /instructions\.buttonLabel/u);
  assert.match(source, /copyOmdInstallInstructions\(\)/u);
  assert.match(source, /Install guide/u);
  assert.match(source, /Advanced OMD paths/u);
  assert.match(source, /OMD executable override/u);
  assert.match(source, /Leave blank to scan the app path and common package manager, environment, and user install locations/u);
  assert.match(source, /isAutomaticOmdExecutable\(this\.plugin\.settings\.omdExecutable\) \? ""/u);
  assert.match(source, /OMD check needed/u);
  assert.match(source, /inputEl\.addEventListener\("blur"/u);
  assert.match(source, /checkEnrichmentCapability\(true\)/u);
  assert.match(stylesSource, /\.omd-settings-omd-status::before/u);
  assert.match(stylesSource, /--omd-status-accent/u);
  assert.doesNotMatch(stylesSource, /\.omd-settings-omd-status\s*\{[^}]*background:/su);
  assert.doesNotMatch(source, /this\.pathSetting\(containerEl, "OMD executable"/u);
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
    const AI_PROVIDER_VALUES = ["ollama", "ollama-cloud", "openai", "anthropic", "deepseek"];
    const DEFAULT_AI_MODELS = { ollama: "qwen3:4b-instruct", "ollama-cloud": "", openai: "", anthropic: "", deepseek: "" };
    function isStoredAiProvider(value) { return typeof value === "string" && AI_PROVIDER_VALUES.includes(value); }
    function normalizeAiModelMemory(raw, legacyProvider, legacyModel) {
      const input = raw && typeof raw === "object" ? raw : {};
      const memory = { ...DEFAULT_AI_MODELS };
      for (const provider of AI_PROVIDER_VALUES) {
        const value = input[provider];
        if (typeof value === "string") memory[provider] = value.trim();
      }
      const migrated = legacyModel.trim();
      if (migrated && typeof input[legacyProvider] !== "string") memory[legacyProvider] = migrated;
      return memory;
    }
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

function extractTypeBody(fileSource: string, signature: string): string {
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
  throw new Error(`Unclosed type body for ${signature}`);
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
