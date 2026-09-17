import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as providerHelpers from "../src/ai-provider.ts";
import * as readinessHelpers from "../src/local-ai-readiness.ts";
import * as captureHelpers from "../src/capture-request.ts";
import * as discoveryHelpers from "../src/omd-discovery.ts";

// Execute production settings callbacks against a minimal Obsidian component boundary.
// This deliberately exercises behavior, not source-text shape or desktop automation.
type Harness = Record<string, any>;

class Element {
  isConnected = true;
  open = false;
  id = "";
  children: Element[] = [];
  listeners = new Map<string, () => unknown>();
  attributes = new Map<string, string>();
  addClass(..._names: string[]) {}
  removeClass(..._names: string[]) {}
  createEl(_tag: string, _options?: unknown) { const child = new Element(); this.children.push(child); return child; }
  createDiv(options?: unknown) { return this.createEl("div", options); }
  createSpan(options?: unknown) { return this.createEl("span", options); }
  empty() { this.children = []; }
  setText(_text: string) {}
  toggleAttribute(name: string, value: boolean) { if (name === "open") this.open = value; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  addEventListener(name: string, callback: () => unknown) { this.listeners.set(name, callback); }
  querySelector() { return null; }
}

class Control {
  value: string | boolean = "";
  disabled = false;
  label = "";
  inputEl = new Element();
  selectEl = { options: [] as Array<{ value: string; label: string; disabled: boolean; title: string }> };
  callback: (value: any) => unknown = () => {};
  setValue(value: string | boolean) { this.value = value; return this; }
  getValue() { return this.value; }
  setDisabled(value: boolean) { this.disabled = value; return this; }
  setPlaceholder(_value: string) { return this; }
  setButtonText(value: string) { this.label = value; return this; }
  setCta() { return this; }
  setWarning() { return this; }
  addOption(value: string, label: string) { this.selectEl.options.push({ value, label, disabled: false, title: "" }); return this; }
  addOptions(options: Record<string, string>) { for (const [value, label] of Object.entries(options)) this.addOption(value, label); return this; }
  onChange(callback: (value: any) => unknown) { this.callback = callback; return this; }
  onClick(callback: () => unknown) { this.callback = callback; return this; }
  async change(value: string | boolean) { this.value = value; await this.callback(value); }
  async click() { await this.callback(undefined); }
}

function createHarness(methods: string[] = []) {
  const rows: Array<{ name: string; description: string; texts: Control[]; dropdowns: Control[]; toggles: Control[]; buttons: Control[] }> = [];
  const notices: string[] = [];
  class Setting {
    name = "";
    description = "";
    settingEl = new Element();
    controlEl = new Element();
    texts: Control[] = [];
    dropdowns: Control[] = [];
    toggles: Control[] = [];
    buttons: Control[] = [];
    constructor(_container: unknown) { rows.push(this); }
    setName(value: string) { this.name = value; return this; }
    setDesc(value: string) { this.description = value; return this; }
    setHeading() { return this; }
    addText(callback: (control: Control) => unknown) { const c = new Control(); this.texts.push(c); callback(c); return this; }
    addDropdown(callback: (control: Control) => unknown) { const c = new Control(); this.dropdowns.push(c); callback(c); return this; }
    addToggle(callback: (control: Control) => unknown) { const c = new Control(); this.toggles.push(c); callback(c); return this; }
    addButton(callback: (control: Control) => unknown) { const c = new Control(); this.buttons.push(c); callback(c); return this; }
  }
  const source = ts.createSourceFile("settings.ts", readFileSync("src/settings.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === "OmdHomeSettingTab")!;
  const names = new Set(["answerModelSetting", "modelSetting", "saveModelValue", "saveAnswerModel", "saveSettingsInOrder", "changeAnswerProvider", "runAiSetupAction", "modelReadinessRail", "settingsDisclosure", "renderOmdSetup", ...methods]);
  const members = declaration.members.filter((node) => ts.isPropertyDeclaration(node) || (node.name && names.has(node.name.getText(source))));
  const helpers = source.statements.filter((node) => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)).map((node) => node.getText(source).replace(/^export /u, ""));
  const code = ts.transpileModule(`${helpers.join("\n")}\nclass Harness { ${members.map((m) => m.getText(source)).join("\n")} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const dependencies = { ...providerHelpers, ...readinessHelpers, ...captureHelpers, ...discoveryHelpers, Setting,
    Platform: { isMacOS: true }, Notice: class { constructor(message: string) { notices.push(message); } } };
  const tab = new Function(...Object.keys(dependencies), `${code}\nreturn new Harness();`)(...Object.values(dependencies)) as Harness;
  let saveCalls = 0;
  tab.plugin = {
    settings: {
      aiProvider: "ollama", aiModel: "qwen3:4b-instruct", aiModels: { ...providerHelpers.DEFAULT_AI_MODELS },
      localWritingModel: "qwen3:4b-instruct", omdExecutable: "omd", pythonExecutable: "", pythonBridgePath: "",
      captureOcrLanguage: "", captureAsrLanguage: "inherit-adapter-default",
    },
    enrichmentCapability: { status: "ready", message: "OMD ready" },
    hostedAiState: null,
    localAiState: { models: [], workflows: { qa: { code: "unchecked", detail: "Check setup" }, enrichment: { code: "unchecked", detail: "Check setup" } } },
    aiSetupBusy: () => false,
    invalidateLocalAiState: () => {},
    saveSettings: async () => { saveCalls += 1; },
    usesAutomaticOmdDiscovery: () => true,
    captureLanguageAvailability: () => ({ status: "supported", message: "Ready", ocrPresets: [{ value: "eng", label: "English" }], customOcr: true, ocrBackendAvailable: true, ocrInstalledPacks: ["eng", "deu"], asrAutoDetect: true, asrExplicit: true }),
  };
  tab.display = () => {};
  tab.rerenderLocalAiSection = () => {};
  const row = (name: string) => { const value = rows.findLast((item) => item.name === name); assert.ok(value, `Missing setting ${name}`); return value; };
  return { tab, rows, row, notices, container: new Element(), saveCalls: () => saveCalls };
}

test("custom answer and writing model drafts survive setup rerenders", async () => {
  const h = createHarness();
  h.tab.customModelModes.add("qa");
  h.tab.customModelModes.add("enrichment");
  h.tab.answerModelSetting(h.container, "ollama");
  await h.row("Answer model").texts[0]!.change("中文模型-very-long-custom-model:latest");
  h.tab.answerModelSetting(h.container, "ollama");
  assert.equal(h.row("Answer model").texts[0]!.value, "中文模型-very-long-custom-model:latest");
  h.tab.modelSetting(h.container, "Local writing model", "Description", "localWritingModel", "enrichment");
  await h.row("Local writing model").texts[0]!.change("writer-custom:4b");
  h.tab.modelSetting(h.container, "Local writing model", "Description", "localWritingModel", "enrichment");
  assert.equal(h.row("Local writing model").texts[0]!.value, "writer-custom:4b");
  assert.equal(h.saveCalls(), 0, "draft changes must not persist before Save model");
});

test("hosted model drafts stay separate for each provider and save only on request", async () => {
  const h = createHarness();
  h.tab.customModelModes.add("qa");
  const render = (provider: string) => {
    h.tab.plugin.settings.aiProvider = provider;
    h.tab.plugin.settings.aiModel = "";
    h.tab.plugin.hostedAiState = { provider, models: [], credential: { source: "keychain" } };
    h.tab.answerModelSetting(h.container, provider);
    return h.row("Answer model");
  };
  await render("openai").texts[0]!.change("openai-custom-v1");
  const anthropic = render("anthropic");
  assert.equal(anthropic.texts[0]!.value, "");
  await anthropic.texts[0]!.change("anthropic-custom-v2");
  const openai = render("openai");
  assert.equal(openai.texts[0]!.value, "openai-custom-v1");
  assert.equal(h.saveCalls(), 0);
  await openai.buttons.find((button) => button.label === "Save model")!.click();
  assert.equal(h.tab.plugin.settings.aiModels.openai, "openai-custom-v1");
  assert.equal(h.tab.plugin.settings.aiModels.anthropic, "");
  assert.equal(h.saveCalls(), 1);
});

test("AI setup disables model controls during a pending check and restores drafts after failure", async () => {
  const h = createHarness();
  h.tab.customModelModes.add("qa");
  h.tab.answerModelSetting(h.container, "ollama");
  await h.row("Answer model").texts[0]!.change("unverified-model:latest");
  let busy = false;
  let reject!: (reason: Error) => void;
  const action = new Promise<void>((_resolve, fail) => { reject = fail; });
  h.tab.plugin.aiSetupBusy = () => busy;
  h.tab.rerenderLocalAiSection = () => h.tab.answerModelSetting(h.container, "ollama");
  const pending = h.tab.runAiSetupAction(() => {
    busy = true;
    return action.finally(() => { busy = false; });
  });
  assert.equal(h.row("Answer model").texts[0]!.disabled, true);
  assert.equal(h.row("Answer model").dropdowns[0]!.disabled, true);
  reject(new Error("setup unavailable"));
  await assert.rejects(pending, /setup unavailable/u);
  assert.equal(h.row("Answer model").texts[0]!.disabled, false);
  assert.equal(h.row("Answer model").texts[0]!.value, "unverified-model:latest");
});

test("local model controls retain long Unicode names and disable incompatible models", () => {
  const h = createHarness();
  const name = `多语言模型-${"long-name-".repeat(10)}:latest`;
  h.tab.plugin.settings.aiModel = name;
  h.tab.plugin.settings.localWritingModel = name;
  h.tab.plugin.localAiState.catalogCheckedAt = Date.now();
  h.tab.plugin.localAiState.models = [
    readinessHelpers.buildModelEntry({ name, capabilities: ["completion"] }),
    readinessHelpers.buildModelEntry({ name: "downloaded-unverified", capabilities: [] }),
    readinessHelpers.buildModelEntry({ name: "embedding-only", capabilities: ["embedding"] }),
    readinessHelpers.buildModelEntry({ name: "remote:cloud", capabilities: ["completion"], remoteHost: "https://ollama.com", remoteModel: "remote" }),
  ];
  h.tab.answerModelSetting(h.container, "ollama");
  h.tab.modelSetting(h.container, "Local writing model", "Description", "localWritingModel", "enrichment");
  for (const label of ["Answer model", "Local writing model"]) {
    const dropdown = h.row(label).dropdowns[0]!;
    assert.equal(dropdown.value, name);
    assert.equal(dropdown.selectEl.options.find((option) => option.value === name)?.label, name);
    assert.equal(dropdown.selectEl.options.find((option) => option.value === "embedding-only")?.disabled, true);
    assert.equal(dropdown.selectEl.options.find((option) => option.value === "downloaded-unverified")?.disabled, false);
    assert.equal(dropdown.selectEl.options.some((option) => option.value === "remote:cloud"), false);
  }
});

test("each hosted provider gates model controls on credentials and uses its own catalog", () => {
  const h = createHarness();
  for (const provider of ["openai", "anthropic", "deepseek"]) {
    h.tab.plugin.settings.aiProvider = provider;
    h.tab.plugin.settings.aiModel = `${provider}-model`;
    h.tab.plugin.hostedAiState = { provider, models: [{ name: `${provider}-model` }], credential: { source: "missing" } };
    h.tab.answerModelSetting(h.container, provider);
    assert.equal(h.row("Answer model").dropdowns[0]!.disabled, true);
    assert.equal(h.row("Answer model").dropdowns[0]!.value, "__credential__");
    h.tab.plugin.hostedAiState.credential.source = "env";
    h.tab.answerModelSetting(h.container, provider);
    assert.equal(h.row("Answer model").dropdowns[0]!.disabled, false);
    assert.equal(h.row("Answer model").dropdowns[0]!.value, `${provider}-model`);
  }
});

test("saved unsupported speech mode remains visible and can be cleared", async () => {
  const h = createHarness();
  h.tab.plugin.settings.captureAsrLanguage = "zh";
  const availability = h.tab.plugin.captureLanguageAvailability();
  h.tab.plugin.captureLanguageAvailability = () => ({ ...availability, asrExplicit: false });
  h.tab.renderOmdSetup(h.container);
  const row = h.row("Speech language");
  assert.ok(row.dropdowns[0]!.selectEl.options.some((option) => option.value === row.dropdowns[0]!.value), "selected value must exist in the rendered options");
  assert.match(row.description, /unavailable|not supported/iu);
  const clear = row.buttons.find((button) => button.label === "Clear preference");
  assert.ok(clear, "saved unsupported preference needs a recovery control");
  await clear.click();
  assert.equal(h.tab.plugin.settings.captureAsrLanguage, "inherit-adapter-default");
  assert.equal(h.saveCalls(), 1);
});

test("clearing the custom OCR field clears the saved preference", async () => {
  const h = createHarness();
  h.tab.plugin.settings.captureOcrLanguage = "deu+eng";
  h.tab.renderOmdSetup(h.container);
  const text = h.row("Custom image text language").texts[0]!;
  text.setValue("");
  await text.inputEl.listeners.get("change")!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.tab.plugin.settings.captureOcrLanguage, "");
  assert.equal(h.saveCalls(), 1);
  assert.equal(h.notices.length, 0);
});

test("unavailable saved OCR stays visible instead of claiming no preference", () => {
  const h = createHarness();
  h.tab.plugin.settings.captureOcrLanguage = "chi_sim+eng";
  h.tab.renderOmdSetup(h.container);
  const row = h.row("Image text language");
  assert.equal(row.dropdowns[0]!.value, "chi_sim+eng");
  assert.match(row.description, /unavailable|not supported/iu);
  assert.ok(row.dropdowns[0]!.selectEl.options.some((option) => option.value === "chi_sim+eng" && option.disabled));
  assert.ok(row.buttons.some((button) => button.label === "Clear preference"));
});

test("failed settings persistence reports a retryable error and does not poison later saves", async () => {
  const h = createHarness();
  let attempts = 0;
  h.tab.plugin.saveSettings = async () => { if (++attempts === 1) throw new Error("disk unavailable"); };
  await assert.rejects(h.tab.saveModelValue("localWritingModel", "writer:new"), /disk unavailable/u);
  assert.ok(h.notices.some((notice) => /could not save|saving.+failed/iu.test(notice)));
  await h.tab.saveModelValue("localWritingModel", "writer:newer");
  assert.equal(attempts, 2);
  assert.equal(h.tab.plugin.settings.localWritingModel, "writer:newer");
});

test("writing model and provider changes share one ordered persistence queue", async () => {
  const h = createHarness();
  let release!: () => void;
  const firstSave = new Promise<void>((resolve) => { release = resolve; });
  let saves = 0;
  let active = 0;
  let maximum = 0;
  h.tab.plugin.saveSettings = async () => { active += 1; maximum = Math.max(maximum, active); if (++saves === 1) await firstSave; active -= 1; };
  const writing = h.tab.saveModelValue("localWritingModel", "writer:new");
  const provider = h.tab.changeAnswerProvider("openai");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(maximum, 1);
  release();
  await Promise.all([writing, provider]);
  assert.equal(saves, 2);
});
