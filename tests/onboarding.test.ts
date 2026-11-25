import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  FIRST_USE_GUIDE_PATH,
  FIRST_USE_GUIDE_TEXT,
  shouldShowFirstUseGuide,
} from "../src/onboarding.ts";

class TestFile {
  readonly path: string;
  readonly content: string;
  constructor(path: string, content = "") {
    this.path = path;
    this.content = content;
  }
}

function onboardingHarness(): Record<string, any> {
  const source = ts.createSourceFile(
    "src/main.ts",
    readFileSync(resolve("src/main.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const method = source.statements
    .flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : [])
    .find((node) => node.name?.getText(source) === "openFirstUseGuide");
  assert.ok(method, "Missing production openFirstUseGuide method");
  const compiled = ts.transpileModule(
    `class Harness { ${method.getText(source)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return new Function(
    "FIRST_USE_GUIDE_PATH",
    "FIRST_USE_GUIDE_TEXT",
    "TFile",
    "Notice",
    `${compiled}\nreturn new Harness();`,
  )(FIRST_USE_GUIDE_PATH, FIRST_USE_GUIDE_TEXT, TestFile, class {}) as Record<string, any>;
}

function initialWorkspaceHarness(notices: string[]): Record<string, any> {
  const source = ts.createSourceFile(
    "src/main.ts",
    readFileSync(resolve("src/main.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const method = source.statements
    .flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : [])
    .find((node) => node.name?.getText(source) === "openInitialWorkspace");
  assert.ok(method, "Missing production openInitialWorkspace method");
  const compiled = ts.transpileModule(
    `class Harness { ${method.getText(source)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const HarnessNotice = class {
    constructor(message: string) { notices.push(message); }
  };
  return new Function(
    "Notice",
    `${compiled}\nreturn new Harness();`,
  )(HarnessNotice) as Record<string, any>;
}

function loadSettingsHarness(): Record<string, any> {
  const source = ts.createSourceFile(
    "src/main.ts",
    readFileSync(resolve("src/main.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const method = source.statements
    .flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : [])
    .find((node) => node.name?.getText(source) === "loadSettings");
  assert.ok(method, "Missing production loadSettings method");
  const compiled = ts.transpileModule(
    `class Harness { ${method.getText(source)} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const normalize = (stored: Record<string, unknown> | null) => ({
    ...(stored ?? {}),
    welcomeGuideShown: typeof stored?.welcomeGuideShown === "boolean" ? stored.welcomeGuideShown : false,
  });
  return new Function(
    "normalizeOmdHomeSettings",
    "shouldShowFirstUseGuide",
    `${compiled}\nreturn new Harness();`,
  )(normalize, shouldShowFirstUseGuide) as Record<string, any>;
}

test("only a genuinely fresh vault receives the first-use guide", () => {
  assert.equal(shouldShowFirstUseGuide(null), true);
  assert.equal(shouldShowFirstUseGuide({}), true);
  assert.equal(shouldShowFirstUseGuide({ welcomeGuideShown: false }), true);
  assert.equal(shouldShowFirstUseGuide({ welcomeGuideShown: true }), false);
  assert.equal(shouldShowFirstUseGuide({ omdExecutable: "omd" }), false);
});

test("an upgrade keeps existing recognition choices and records that onboarding is complete", async () => {
  const stored = {
    captureOcrLanguage: "chi_sim+eng",
    captureAsrLanguage: "zh",
  };
  const plugin = loadSettingsHarness();
  const saved: unknown[] = [];
  Object.assign(plugin, {
    loadData: async () => stored,
    saveData: async (value: unknown) => { saved.push(value); },
    syncLocalAiState: () => {},
    syncHostedAiState: () => {},
  });

  await plugin.loadSettings();

  assert.equal(plugin.settings.captureOcrLanguage, "chi_sim+eng");
  assert.equal(plugin.settings.captureAsrLanguage, "zh");
  assert.equal(plugin.settings.welcomeGuideShown, true);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], plugin.settings);
});

test("initial workspace failures stay bounded and do not prevent the guide attempt", async () => {
  const notices: string[] = [];
  const plugin = initialWorkspaceHarness(notices);
  let guideAttempts = 0;
  Object.assign(plugin, {
    unloaded: false,
    settings: { openOnLaunch: true },
    openHome: async () => { throw new Error("home failed"); },
    openFirstUseGuide: async () => { guideAttempts += 1; throw new Error("guide failed"); },
  });

  await plugin.openInitialWorkspace();

  assert.equal(guideAttempts, 1);
  assert.equal(notices.length, 2);
  assert.match(notices[0]!, /could not open automatically/u);
  assert.match(notices[1]!, /could not open its first-use guide/u);
});

test("the guide explains defaults and exposes the language-settings action", () => {
  assert.equal(FIRST_USE_GUIDE_PATH, "OMD Home/Welcome to OMD Home.md");
  assert.match(FIRST_USE_GUIDE_TEXT, /Image text recognition defaults to English/u);
  assert.match(FIRST_USE_GUIDE_TEXT, /audio transcription detects the spoken language automatically/u);
  assert.match(FIRST_USE_GUIDE_TEXT, /\[Open language settings\]\(obsidian:\/\/omd-home-language-settings\)/u);
  assert.match(FIRST_USE_GUIDE_TEXT, /OMD converter/u);
  assert.match(FIRST_USE_GUIDE_TEXT, /Local AI/u);
  assert.match(FIRST_USE_GUIDE_TEXT, /Cloud answers/u);
});

test("the first-use guide creates and opens once without overwriting an existing note", async () => {
  const plugin = onboardingHarness();
  const files = new Map<string, TestFile>();
  const created: Array<{ path: string; content: string }> = [];
  const viewStates: unknown[] = [];
  let saved = 0;
  Object.assign(plugin, {
    unloaded: false,
    settings: { welcomeGuideShown: false },
    ensureFolder: async () => {},
    saveSettings: async () => { saved += 1; },
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        create: async (path: string, content: string) => {
          const file = new TestFile(path, content);
          files.set(path, file);
          created.push({ path, content });
          return file;
        },
      },
      workspace: {
        getLeaf: () => ({ setViewState: async (state: unknown) => { viewStates.push(state); } }),
        revealLeaf: async () => {},
      },
    },
  });

  await Promise.all([plugin.openFirstUseGuide(), plugin.openFirstUseGuide()]);
  await plugin.openFirstUseGuide();

  assert.equal(created.length, 1);
  assert.equal(created[0]?.path, FIRST_USE_GUIDE_PATH);
  assert.equal(created[0]?.content, FIRST_USE_GUIDE_TEXT);
  assert.deepEqual(viewStates, [{
    type: "markdown",
    state: { file: FIRST_USE_GUIDE_PATH, mode: "preview" },
    active: true,
  }]);
  assert.equal(plugin.settings.welcomeGuideShown, true);
  assert.equal(saved, 1);

  const existing = onboardingHarness();
  const edited = new TestFile(FIRST_USE_GUIDE_PATH, "user edited content");
  let createCalls = 0;
  Object.assign(existing, {
    unloaded: false,
    settings: { welcomeGuideShown: false },
    ensureFolder: async () => {},
    saveSettings: async () => {},
    app: {
      vault: {
        getAbstractFileByPath: () => edited,
        create: async () => { createCalls += 1; return edited; },
      },
      workspace: {
        getLeaf: () => ({ setViewState: async () => {} }),
        revealLeaf: async () => {},
      },
    },
  });
  await existing.openFirstUseGuide();
  assert.equal(createCalls, 0);
  assert.equal(edited.content, "user edited content");
});

test("a guide leaf established during unload still persists the one-time marker", async () => {
  const plugin = onboardingHarness();
  const guide = new TestFile(FIRST_USE_GUIDE_PATH, FIRST_USE_GUIDE_TEXT);
  let saved = 0;
  let revealed = 0;
  Object.assign(plugin, {
    unloaded: false,
    firstUseGuideOpening: false,
    settings: { welcomeGuideShown: false },
    ensureFolder: async () => {},
    saveSettings: async () => { saved += 1; },
    app: {
      vault: {
        getAbstractFileByPath: () => guide,
        create: async () => guide,
      },
      workspace: {
        getLeaf: () => ({
          setViewState: async () => { plugin.unloaded = true; },
        }),
        revealLeaf: async () => { revealed += 1; },
      },
    },
  });

  await plugin.openFirstUseGuide();

  assert.equal(plugin.settings.welcomeGuideShown, true);
  assert.equal(saved, 1);
  assert.equal(revealed, 0);
});

test("the settings deep link expands and focuses recognition defaults", () => {
  const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
  const settingsSource = readFileSync(resolve("src/settings.ts"), "utf8");
  assert.match(mainSource, /registerObsidianProtocolHandler\("omd-home-language-settings"/u);
  assert.match(mainSource, /showRecognitionSettings\(\)/u);
  assert.match(settingsSource, /recognition\.open = this\.recognitionDefaultsExpanded/u);
  assert.match(settingsSource, /querySelector<HTMLSelectElement>\("select"\)\?\.focus\(\)/u);
});
