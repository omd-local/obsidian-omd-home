import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  buildModelEntry,
  localWritingModelIsSelectable,
  localWritingModelOptionLabel,
} from "../src/local-ai-readiness.ts";
import { OllamaLocalClient } from "../src/ollama-local-client.ts";

const source = readFileSync(resolve("src/settings.ts"), "utf8");
const captureRequestSource = readFileSync(resolve("src/capture-request.ts"), "utf8");
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
    captureOcrLanguage: "  chi_sim+eng  ",
    captureAsrLanguage: "auto-detect",
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
  assert.equal(normalized.captureOcrLanguage, "chi_sim+eng");
  assert.equal(normalized.captureAsrLanguage, "auto-detect");
  assert.deepEqual(normalized.pinnedNotes, ["Note.md"]);
});

test("legacy and invalid recognition settings migrate to safe defaults", () => {
  const legacy = helpers.normalizeOmdHomeSettings({ capturePolish: true });
  assert.equal(legacy.captureOcrLanguage, "");
  assert.equal(legacy.captureAsrLanguage, "inherit-adapter-default");

  const invalid = helpers.normalizeOmdHomeSettings({
    captureOcrLanguage: "eng --output /tmp/file",
    captureAsrLanguage: "automatic",
  });
  assert.equal(invalid.captureOcrLanguage, "");
  assert.equal(invalid.captureAsrLanguage, "inherit-adapter-default");

  const custom = helpers.normalizeOmdHomeSettings({
    captureOcrLanguage: "  deu+eng  ",
    captureAsrLanguage: "zh",
  });
  assert.equal(custom.captureOcrLanguage, "deu+eng");
  assert.equal(custom.captureAsrLanguage, "zh");

  const scriptPack = helpers.normalizeOmdHomeSettings({ captureOcrLanguage: " script/HanS + eng " });
  assert.equal(scriptPack.captureOcrLanguage, "script/HanS+eng");
});

test("OMD settings expose readable per-vault recognition defaults without inheritance jargon", () => {
  assert.match(source, /setName\("Image text language"\)/u);
  assert.match(source, /setName\("Speech language"\)/u);
  assert.match(source, /inherit-adapter-default/u);
  assert.match(source, /auto-detect/u);
  assert.match(source, /Recognition only; OMD does not translate the captured text/iu);
  assert.match(source, /A language selected while capturing applies only to that item; a retry repeats it/iu);
  assert.match(source, /this\.plugin\.captureLanguageAvailability\(\)/u);
  assert.match(source, /missingInstalledOcrPacks/u);
  assert.match(source, /Script packs such as script\/HanS are supported/u);
  assert.match(source, /languageAvailability\.status === "supported"/u);
  assert.match(source, /No language preference/u);
  assert.match(source, /Clear preference/u);
  assert.doesNotMatch(source, /leaves the converter(?:'s configured language)? unchanged/iu);
  assert.doesNotMatch(source, /Inherit OMD|Inherit adapter default|Use OMD default|Use adapter default/u);
});

test("common OMD readiness is independent of capture recognition defaults", () => {
  const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
  const setupBody = extractFunctionBody(mainSource, "private async runOmdCapabilityCheck(");
  assert.doesNotMatch(setupBody, /requireCaptureLanguages|captureRequestFromSettings/u);
  assert.match(mainSource, /requireCaptureLanguages\(executable, request, signal\)/u);
  assert.match(mainSource, /capabilities: detectedCapabilities/u);
});

test("settings normalization preserves a saved hosted provider and its model memory", () => {
  const normalized = helpers.normalizeOmdHomeSettings({ aiProvider: "openai" });
  assert.equal(normalized.aiProvider, "openai");
  assert.equal(normalized.aiModel, "");
  assert.deepEqual(normalized.allowedCloudAnswerProviders, []);
  assert.equal(normalized.hybridRetrievalEnabled, true);
  assert.equal(normalized.embeddingModel, "bge-m3");
  assert.equal(normalized.semanticRerankEnabled, false);
});

test("cloud answer permission migrates to the selected provider only and keeps explicit provider lists", () => {
  const migrated = helpers.normalizeOmdHomeSettings({
    aiProvider: "anthropic",
    allowCloudVaultAnswers: true,
  });
  assert.deepEqual(migrated.allowedCloudAnswerProviders, ["anthropic"]);

  const explicit = helpers.normalizeOmdHomeSettings({
    aiProvider: "openai",
    allowedCloudAnswerProviders: ["openai", "ollama", "deepseek", "openai", "bogus"],
  });
  assert.deepEqual(explicit.allowedCloudAnswerProviders, ["openai", "deepseek"]);
});

test("local writing model prefers legacy enrichment first, then capture polish, then the default", () => {
  const enrichmentFirst = helpers.normalizeOmdHomeSettings({
    enrichmentModel: "  llama3:instruct  ",
    capturePolishModel: "  mistral  ",
  });
  assert.equal(enrichmentFirst.localWritingModel, "llama3:instruct");

  const captureFallback = helpers.normalizeOmdHomeSettings({
    enrichmentModel: "   ",
    capturePolishModel: "  mistral  ",
  });
  assert.equal(captureFallback.localWritingModel, "mistral");
  assert.equal(helpers.DEFAULT_SETTINGS.localWritingModel, "qwen3:4b-instruct");
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

test("Phase 2 settings expose an explicit provider choice and inline provider boundary guidance", () => {
  assert.match(source, /setName\("Answer provider"\)/u);
  assert.match(source, /for \(const value of AI_PROVIDER_VALUES\) dropdown\.addOption\(value, aiProviderLabel\(value\)\)/u);
  assert.match(source, /setDesc\(`Choose where @ questions are answered\. \$\{providerSetupDescription\(provider\)\}`\)/u);
  assert.match(source, /providerSetupDescription\(provider\)/u);
  assert.match(source, /setName\(`Allow \$\{aiProviderLabel\(provider\)\} answers`\)/u);
  assert.match(source, /allowedCloudAnswerProviders/u);
  assert.match(source, /bounded evidence excerpts/u);
  assert.match(source, /macOS Keychain/u);
  assert.match(source, /aiProviderEnvVar\(provider\)/u);
  assert.match(source, /Consumer subscriptions do not include API usage/u);
  assert.doesNotMatch(source, /Smoke/u);
  assert.doesNotMatch(source, /setName\("Model catalog"\)/u);
  assert.doesNotMatch(source, /Refresh models/u);
  assert.doesNotMatch(source, /setName\("Provider boundary"\)/u);
});

test("answer model labels stay plain and move local readiness into a status rail", () => {
  const answerModelBlock = extractFunctionBody(source, "private answerModelSetting");
  assert.doesNotMatch(answerModelBlock, /use an instruct model/iu);
  assert.match(answerModelBlock, /qwen3:4b-instruct is the default/iu);
  assert.match(answerModelBlock, /describeLocalCompletionCatalog\(this\.plugin\.localAiState\.models, catalogChecked\)/u);
  assert.match(answerModelBlock, /modelReadinessRail\(container, "Text completion model", qaWorkflow, selector\.stale\)/u);
  assert.doesNotMatch(answerModelBlock, /describeReadinessCode\(/u);
  assert.match(answerModelBlock, /Custom model id saved\. Run Check setup to verify it is installed\./u);
});

test("local Vault Q&A reuses the local completion selector policy without changing hosted catalogs", () => {
  const answerModelBlock = extractFunctionBody(source, "private answerModelSetting");
  assert.match(answerModelBlock, /const localModels = this\.plugin\.localAiState\.models\.filter\(\(model\) => !modelIsCloudBacked\(model\)\)/u);
  assert.match(answerModelBlock, /provider === "ollama" \? localWritingModelOptionLabel\(model\) : model\.name/u);
  assert.match(answerModelBlock, /disableUnavailableLocalModelOptions\(dropdown\.selectEl, models\)/u);
  assert.match(answerModelBlock, /provider === "ollama-cloud"\s*\? this\.plugin\.localAiState\.models\.filter\(modelIsCloudBacked\)/u);
  assert.match(answerModelBlock, /this\.plugin\.hostedAiState\?\.provider === provider \? this\.plugin\.hostedAiState\.models : \[\]/u);
  assert.match(answerModelBlock, /options\.__custom__ = "Custom…"/u);
  assert.match(answerModelBlock, /\(saved, unavailable for local answers\)/u);
  assert.match(answerModelBlock, /\(saved, not installed\)/u);
  assert.match(answerModelBlock, /value === "__custom__" \|\| value === "__stale__"/u);
  assert.match(answerModelBlock, /buildModelSelectorState/u);
  assert.match(answerModelBlock, /const showCustom = custom \|\| \(!current && selector\.useCustom\)/u);
  assert.match(answerModelBlock, /omd-settings-model/u);
});

test("local writing model offers verified and unverified local text models and preserves an unavailable saved value", () => {
  const localWritingBlock = extractFunctionBody(source, "private modelSetting");
  assert.match(localWritingBlock, /this\.plugin\.localAiState\.models\s*\.filter\(\(model\) => !modelIsCloudBacked\(model\)\)/u);
  assert.match(localWritingBlock, /localWritingModelOptionLabel\(model\)/u);
  assert.match(localWritingBlock, /disableUnavailableLocalModelOptions\(dropdown\.selectEl, localModels\)/u);
  assert.match(localWritingBlock, /buildModelSelectorState\(this\.plugin\.settings\[key\], selectableModels\)/u);
  assert.match(localWritingBlock, /\(saved, unavailable for local writing\)/u);
  assert.match(localWritingBlock, /describeLocalCompletionCatalog\(this\.plugin\.localAiState\.models, catalogChecked\)/u);
});

test("a downloaded text model stays selectable when /api/tags omits capabilities", async () => {
  const client = new OllamaLocalClient({
    requestJson: async ({ path }) => {
      assert.equal(path, "/api/tags");
      return {
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ models: [{ name: "downloaded-text:latest", digest: "sha256:local" }] }),
      };
    },
  });
  const [model] = await client.tags("http://localhost:11434");
  assert.ok(model);
  assert.deepEqual(model.capabilities, []);

  assert.equal(localWritingModelIsSelectable(model), true);
  assert.equal(localWritingModelOptionLabel(model), "downloaded-text:latest (completion support unverified)");
  const unknownMetadata = buildModelEntry({ name: "future-text", capabilities: ["vision"] });
  assert.equal(localWritingModelIsSelectable(unknownMetadata), true);
  assert.equal(localWritingModelOptionLabel(unknownMetadata), "future-text (completion support unverified)");
  assert.equal(localWritingModelIsSelectable(buildModelEntry({ name: "nomic-embed", capabilities: ["embedding"] })), false);
  assert.equal(localWritingModelIsSelectable(buildModelEntry({ name: "reasoner", capabilities: ["thinking"] })), false);
  assert.equal(localWritingModelIsSelectable(buildModelEntry({
    name: "remote-text",
    capabilities: ["completion"],
    remoteHost: "https://ollama.com",
  })), false);
});

test("hybrid retrieval settings keep embedding choices local and expose an embedding smoke check", () => {
  assert.match(source, /hybridRetrievalEnabled:\s*true/u);
  assert.match(source, /embeddingModel:\s*"bge-m3"/u);
  assert.match(source, /semanticRerankEnabled:\s*false/u);
  assert.match(source, /setName\("Hybrid retrieval"\)/u);
  assert.match(source, /setName\("Embedding model"\)/u);
  assert.match(source, /modelSupportsEmbedding\(model\)\s*&&\s*!modelIsCloudBacked\(model\)/u);
  assert.match(source, /setButtonText\([^)]*"Test embeddings"/u);
  assert.match(source, /testLocalEmbeddings\(\)/u);
  assert.match(source, /The saved embedding model is unavailable locally/u);
  assert.match(source, /Copy download command/u);
  assert.match(source, /navigator\.clipboard\.writeText\("ollama pull bge-m3"\)/u);
  assert.match(source, /never installs models automatically/u);
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
  assert.match(source, /private localAiAdvancedExpanded = false/u);
  assert.match(source, /advanced\.open = this\.localAiAdvancedExpanded/u);
  assert.match(source, /advanced\.addEventListener\("toggle"/u);
  assert.match(source, /this\.localAiAdvancedExpanded = advanced\.open/u);
  assert.match(source, /The capture dialog turns optional writing actions on or off/iu);
  assert.match(source, /These actions never use the cloud answer provider/iu);
  assert.match(source, /Default: http:\/\/localhost:11434/u);
  assert.match(source, /http:\/\/127\.0\.0\.1:11434/u);
  assert.match(source, /normalizeLocalOllamaHost\(candidate\)/u);
  assert.match(source, /The last valid endpoint remains saved/u);
  assert.match(source, /omd-settings-endpoint/u);
  assert.match(source, /omd-settings-endpoint-validation/u);
  assert.doesNotMatch(source, /setButtonText\("Cancel"\)/u);
  assert.equal([...source.matchAll(/settingsDisclosure\(\s*container,\s*"(?:Search quality|Local capture and links|Ollama troubleshooting)"/gu)].length, 0);
});

test("local completion selectors show every downloaded local model while disabling unsafe choices", () => {
  assert.match(source, /disableUnavailableLocalModelOptions/u);
  assert.match(source, /option\.disabled = true/u);
  assert.match(source, /describeLocalCompletionCatalog/u);
  assert.match(source, /this\.modelReadinessRail\(container, name, workflowState, selector\.stale\)/u);
  assert.match(source, /omd-settings-model-status/u);
  assert.match(stylesSource, /\.omd-settings-model-status\.is-ready/u);
  assert.match(stylesSource, /\.omd-settings-model-status\.is-neutral/u);
  assert.match(stylesSource, /\.omd-settings-model-status\.is-unavailable/u);
});

test("unchecked catalogs remain neutral and only checked missing models become unavailable", () => {
  assert.match(source, /const catalogChecked = typeof this\.plugin\.localAiState\.catalogCheckedAt === "number"/u);
  assert.match(source, /const savedUnavailable = catalogChecked &&/u);
  assert.match(source, /state\.code === "unchecked"/u);
  assert.match(source, /is-neutral/u);
  assert.match(source, /Embedding model installed/u);
  assert.doesNotMatch(source, /Embedding model ready/u);
});

test("Advanced AI controls configure one local writing model without duplicating capture switches", () => {
  assert.match(source, /Configure vault retrieval, the local writing model, and Ollama troubleshooting\./u);
  assert.match(source, /Choose the loopback Ollama model they share here/iu);
  assert.doesNotMatch(source, /setName\("Polish captures by default"\)/u);
  assert.doesNotMatch(source, /setName\("Suggest links and tags by default"\)/u);
});

test("controls inside Advanced AI rerender the owning section without replacing the disclosure", () => {
  assert.match(source, /private rerenderLocalAiSection\(\): void/u);
  assert.match(source, /querySelector<HTMLElement>\("\.omd-settings-local-ai"\)/u);
  for (const method of ["hybridRetrievalSetting", "embeddingModelSetting", "modelSetting"]) {
    const body = extractFunctionBody(source, `private ${method}`);
    assert.match(body, /this\.rerenderLocalAiSection\(\)/u, method);
    assert.doesNotMatch(body, /this\.renderLocalAiSection\(container\)/u, method);
  }
});

test("changing answer provider clears feedback and issues from the previous provider", () => {
  const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
  assert.match(mainSource, /if \(reason === "provider" \|\| reason === "answer-model"\) \{\s*this\.localAiFeedback = null;\s*this\.clearIssue\("ai"\);\s*\}/u);
  assert.match(source, /invalidateLocalAiState\("answer-model"\)/u);
  assert.match(mainSource, /reason === "answer-model" && this\.hostedAiState\?\.provider === this\.currentHostedProvider\(\)/u);
});

test("hosted credential state is hydrated after provider switch or reload", () => {
  const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
  assert.match(source, /ensureHostedCredentialState\(provider\)/u);
  assert.match(source, /ensureHostedCredentialState\(provider\)\.finally/u);
  assert.match(mainSource, /if \(isHostedApiProvider\(this\.settings\.aiProvider\)\) \{\s*void this\.ensureHostedCredentialState\(this\.settings\.aiProvider\);\s*\}/u);
  assert.match(mainSource, /const credential = await this\.omdBridge\.hostedCredentialState\(provider\)/u);
  assert.match(mainSource, /credential\.source === "missing"\s*\?\s*"credentials_missing"\s*:\s*model \? "unchecked" : "selected_model_missing"/u);
  assert.match(mainSource, /const startedAt = Date\.now\(\);/u);
  assert.match(mainSource, /if \(existing\?\.activeAction\) return;/u);
  assert.match(mainSource, /if \(existing\?\.checkedAt && existing\.checkedAt > startedAt\) return;/u);
});

test("hosted setup disables route controls and rerenders at action boundaries", () => {
  const localAiSection = extractFunctionBody(source, "private renderLocalAiSection");
  const answerModel = extractFunctionBody(source, "private answerModelSetting");
  const credential = extractFunctionBody(source, "private hostedCredentialSetting");
  const answerStatus = extractFunctionBody(source, "private answerProviderStatusSetting");
  const embeddings = extractFunctionBody(source, "private embeddingModelSetting");
  const hybridRetrieval = extractFunctionBody(source, "private hybridRetrievalSetting");
  const writingModel = extractFunctionBody(source, "private modelSetting");
  assert.match(source, /const aiSetupBusy = this\.plugin\.aiSetupBusy\(\)/u);
  assert.match(localAiSection, /dropdown\.setValue\(provider\)\.setDisabled\(aiSetupBusy\)/u);
  assert.match(localAiSection, /\.setDisabled\(aiSetupBusy\)\s*\.onChange\(async \(enabled\)/u);
  assert.match(localAiSection, /\.setDisabled\(aiSetupBusy \|\| !this\.plugin\.settings\.hybridRetrievalEnabled\)/u);
  assert.match(localAiSection, /text\.setValue\(this\.plugin\.settings\.ollamaHost\)\.setDisabled\(aiSetupBusy\)/u);
  assert.match(answerModel, /dropdown\.setValue\(showCustom \? "__custom__" : selector\.optionValue\)\.setDisabled\(aiSetupBusy\)/u);
  assert.match(answerModel, /setButtonText\("Save model"\)\s*\.setDisabled\(aiSetupBusy\)/u);
  assert.match(credential, /runAiSetupAction\(\(\) => this\.plugin\.saveHostedApiKey/u);
  assert.match(credential, /runAiSetupAction\(\(\) => this\.plugin\.deleteHostedApiKey/u);
  assert.match(answerStatus, /const aiSetupBusy = this\.plugin\.aiSetupBusy\(\)/u);
  assert.match(answerStatus, /\.setDisabled\(aiSetupBusy\)/u);
  assert.match(answerStatus, /runAiSetupAction/u);
  assert.match(hybridRetrieval, /const aiSetupBusy = this\.plugin\.aiSetupBusy\(\)/u);
  assert.match(hybridRetrieval, /\.setDisabled\(aiSetupBusy\)/u);
  assert.match(writingModel, /const aiSetupBusy = this\.plugin\.aiSetupBusy\(\)/u);
  assert.match(writingModel, /dropdown\.setValue\(selector\.optionValue\)\.setDisabled\(aiSetupBusy\)/u);
  assert.match(writingModel, /text\.setValue\(selector\.customValue\)\.setDisabled\(aiSetupBusy\)/u);
  assert.match(writingModel, /setButtonText\("Save model"\)\s*\.setDisabled\(aiSetupBusy\)/u);
  assert.match(embeddings, /runAiSetupAction\(\(\) => this\.plugin\.testLocalEmbeddings/u);
});

test("hosted credential drafts survive provider and setup rerenders", async () => {
  const harness = createHostedCredentialHarness();
  const action = deferredResult<boolean>();
  let provider = "openai";
  harness.tab.plugin = {
    aiSetupBusy() { return Boolean(this.localAiState.activeAction || this.hostedAiState?.activeAction); },
    localAiState: { activeAction: "" },
    hostedAiState: null,
    settings: {},
    saveHostedApiKey: async () => false,
    deleteHostedApiKey: async () => {},
  };
  harness.tab.rerenderLocalAiSection = () => {
    harness.tab.hostedCredentialSetting(harness.container, provider);
  };

  harness.tab.hostedCredentialSetting(harness.container, "openai");
  harness.inputs.at(-1)?.change("sk-openai-draft");
  provider = "anthropic";
  harness.tab.hostedCredentialSetting(harness.container, "anthropic");
  harness.inputs.at(-1)?.change("sk-anthropic-draft");
  provider = "openai";
  harness.tab.hostedCredentialSetting(harness.container, "openai");
  assert.equal(harness.inputs.at(-1)?.value, "sk-openai-draft");

  const pending = harness.tab.runAiSetupAction(() => {
    harness.tab.plugin.hostedAiState = { provider: "openai", activeAction: "check-connection" };
    return action.promise.finally(() => {
      harness.tab.plugin.hostedAiState = { provider: "openai", activeAction: "" };
    });
  });
  assert.equal(harness.inputs.at(-1)?.value, "sk-openai-draft");
  assert.equal(harness.inputs.at(-1)?.disabled, true);
  action.resolve(true);
  await pending;
  assert.equal(harness.inputs.at(-1)?.value, "sk-openai-draft");
  assert.equal(harness.inputs.at(-1)?.disabled, false);

  provider = "anthropic";
  harness.tab.hostedCredentialSetting(harness.container, "anthropic");
  assert.equal(harness.inputs.at(-1)?.value, "sk-anthropic-draft");
});

test("a successful hosted key save clears only the exact submitted draft", async () => {
  const harness = createHostedCredentialHarness();
  const saves: Array<ReturnType<typeof deferredResult<boolean>>> = [];
  const submitted: string[] = [];
  harness.tab.plugin = {
    aiSetupBusy() { return Boolean(this.localAiState.activeAction || this.hostedAiState?.activeAction); },
    localAiState: { activeAction: "" },
    hostedAiState: null,
    settings: {},
    saveHostedApiKey(value: string) {
      submitted.push(value);
      harness.tab.plugin.hostedAiState = { provider: "openai", activeAction: "save-key" };
      const save = deferredResult<boolean>();
      saves.push(save);
      return save.promise.finally(() => {
        harness.tab.plugin.hostedAiState = { provider: "openai", activeAction: "" };
      });
    },
    deleteHostedApiKey: async () => {},
  };
  harness.tab.rerenderLocalAiSection = () => {
    harness.tab.hostedCredentialSetting(harness.container, "openai");
  };

  harness.tab.hostedCredentialSetting(harness.container, "openai");
  harness.inputs.at(-1)?.change("sk-first");
  const firstSave = harness.saveButtons.at(-1)?.click();
  assert.ok(firstSave);
  assert.equal(harness.inputs.at(-1)?.disabled, true);
  harness.inputs.at(-1)?.change("sk-replacement");
  saves[0]?.resolve(true);
  await firstSave;
  assert.deepEqual(submitted, ["sk-first"]);
  assert.equal(harness.inputs.at(-1)?.value, "sk-replacement");

  const secondSave = harness.saveButtons.at(-1)?.click();
  assert.ok(secondSave);
  saves[1]?.resolve(true);
  await secondSave;
  assert.deepEqual(submitted, ["sk-first", "sk-replacement"]);
  assert.equal(harness.inputs.at(-1)?.value, "");
});

test("hosted credential controls follow the platform-supported storage path", () => {
  const credentialBlock = extractFunctionBody(source, "private hostedCredentialSetting");
  assert.match(credentialBlock, /if \(!Platform\.isMacOS \|\| credential\?\.keychainSupported === false\)/u);
  assert.match(credentialBlock, /Set \$\{envVar\} before starting Obsidian/u);
  assert.match(credentialBlock, /In-app saving appears only when macOS Keychain is available/u);
  const platformGuard = credentialBlock.indexOf("if (!Platform.isMacOS");
  const earlyReturn = credentialBlock.indexOf("return;", platformGuard);
  const secretControl = credentialBlock.indexOf("new TextComponent", platformGuard);
  assert.ok(platformGuard >= 0 && earlyReturn > platformGuard && secretControl > earlyReturn);
  assert.match(credentialBlock, /secret\.inputEl\.type = "password"/u);
  assert.doesNotMatch(source, /SecretComponent/u);
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
  assert.match(source, /optional EventKit helper, which is not included in the standard Marketplace files/u);
  assert.match(source, /Leave this blank to use an optional helper installed beside the plugin/u);
  assert.match(source, /Google and Outlook accounts already added to macOS Calendar/u);
  assert.match(source, /Refresh calendars/u);
  assert.match(source, /allow Calendar access if macOS asks/u);
});

test("Python bridge settings prefer the bundled bridge while retaining an explicit override", () => {
  assert.match(source, /Using the bridge bundled inside OMD Home automatically/u);
  assert.match(source, /Leave blank for automatic detection from the OMD environment/u);
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
    .replaceAll(" as OmdHomeSettings[\"aiProvider\"]", "")
    .replaceAll(" as { allowCloudVaultAnswers?: unknown }", "")
    .replaceAll(" as { allowCloudVaultAnswers?: boolean }", "")
    .replaceAll(" as { allowedCloudAnswerProviders?: unknown }", "")
    .replaceAll(" as { enrichmentModel?: unknown }", "")
    .replaceAll(" as { capturePolishModel?: unknown }", "");
  const reconcileBody = extractFunctionBody(fileSource, "export function reconcileCalendarSelection");
  const normalizeDefaultBody = extractFunctionBody(fileSource, "export function normalizeDefaultExternalCalendarId");
  const cleanStringBody = extractFunctionBody(fileSource, "function cleanString");
  const uniqueStringsBody = extractFunctionBody(fileSource, "function uniqueStrings")
    .replace(/\(entry\): entry is string =>/g, "(entry) =>");
  const normalizeOcrBody = extractFunctionBody(fileSource, "function normalizeCaptureOcrLanguage");
  const normalizeOcrLanguageSetBody = extractFunctionBody(captureRequestSource, "export function normalizeOcrLanguageSet")
    .replaceAll(": string[]", "")
    .replaceAll("new Set<string>()", "new Set()");
  const normalizeAsrBody = extractFunctionBody(fileSource, "function normalizeCaptureAsrLanguage")
    .replaceAll(" as OmdHomeSettings[\"captureAsrLanguage\"]", "");
  return Function(`
    const AI_PROVIDER_VALUES = ["ollama", "ollama-cloud", "openai", "anthropic", "deepseek"];
    const DEFAULT_AI_MODELS = { ollama: "qwen3:4b-instruct", "ollama-cloud": "", openai: "", anthropic: "", deepseek: "" };
    function isStoredAiProvider(value) { return typeof value === "string" && AI_PROVIDER_VALUES.includes(value); }
    function isCloudAiProvider(provider) { return provider !== "ollama"; }
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
    function normalizeOcrLanguageSet(value) ${normalizeOcrLanguageSetBody}
    function normalizeCaptureOcrLanguage(value) ${normalizeOcrBody}
    function normalizeCaptureAsrLanguage(value) ${normalizeAsrBody}
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

type SettingsMethodHarness = Record<string, any>;

interface CredentialInputHarness {
  value: string;
  disabled: boolean;
  change(value: string): void;
}

interface CredentialButtonHarness {
  label: string;
  disabled: boolean;
  click(): Promise<void>;
}

function createHostedCredentialHarness(): {
  tab: SettingsMethodHarness;
  container: { isConnected: boolean };
  inputs: CredentialInputHarness[];
  saveButtons: CredentialButtonHarness[];
} {
  const inputs: CredentialInputHarness[] = [];
  const buttons: CredentialButtonHarness[] = [];
  class TextComponent {
    inputEl = { type: "text", autocomplete: "" };
    value = "";
    disabled = false;
    private onValueChange: (value: string) => void = () => {};

    constructor(_container: unknown) {
      inputs.push(this);
    }

    setValue(value: string): this {
      this.value = value;
      return this;
    }

    setPlaceholder(_value: string): this {
      return this;
    }

    setDisabled(value: boolean): this {
      this.disabled = value;
      return this;
    }

    onChange(callback: (value: string) => void): this {
      this.onValueChange = callback;
      return this;
    }

    change(value: string): void {
      this.value = value;
      this.onValueChange(value);
    }
  }
  class ButtonComponent {
    label = "";
    disabled = false;
    private onButtonClick: () => void | Promise<void> = () => {};

    setButtonText(value: string): this {
      this.label = value;
      return this;
    }

    setDisabled(value: boolean): this {
      this.disabled = value;
      return this;
    }

    setWarning(): this {
      return this;
    }

    onClick(callback: () => void | Promise<void>): this {
      this.onButtonClick = callback;
      return this;
    }

    async click(): Promise<void> {
      await this.onButtonClick();
    }
  }
  class Setting {
    controlEl = {};
    settingEl = { addClass: (..._classes: string[]) => {} };

    constructor(_container: unknown) {}

    setName(_value: string): this {
      return this;
    }

    setDesc(_value: string): this {
      return this;
    }

    addButton(callback: (button: ButtonComponent) => void): this {
      const button = new ButtonComponent();
      callback(button);
      buttons.push(button);
      return this;
    }
  }
  const tab = loadSettingTabMethods(["hostedCredentialSetting", "runAiSetupAction"], {
    Platform: { isMacOS: true },
    Setting,
    TextComponent,
    Notice: class {},
    aiProviderEnvVar: (provider: string) => `${provider.toUpperCase()}_API_KEY`,
  });
  tab.hostedCredentialDrafts = new Map<string, string>();
  return {
    tab,
    container: { isConnected: true },
    inputs,
    saveButtons: buttons,
  };
}

function loadSettingTabMethods(
  names: string[],
  dependencies: Record<string, unknown>,
): SettingsMethodHarness {
  const syntax = ts.createSourceFile("src/settings.ts", source, ts.ScriptTarget.Latest, true);
  const settingTab = syntax.statements.find(
    (node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === "OmdHomeSettingTab",
  );
  assert.ok(settingTab, "Missing OmdHomeSettingTab");
  const methods = names.map((name) => {
    const member = settingTab.members.find((candidate) => candidate.name?.getText(syntax) === name);
    assert.ok(member, `Missing OmdHomeSettingTab.${name}`);
    return member.getText(syntax);
  });
  const compiled = ts.transpileModule(`class Harness { ${methods.join("\n")} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(
    ...Object.keys(dependencies),
    `${compiled}\nreturn new Harness();`,
  )(...Object.values(dependencies)) as SettingsMethodHarness;
}

function deferredResult<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
