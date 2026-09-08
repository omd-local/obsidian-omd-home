import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { aiProviderDestination, aiProviderEnvVar, aiProviderLabel, isHostedApiProvider, selectedAiModel } from "../src/ai-provider.ts";

// Execute the production methods with injected Obsidian/bridge boundaries. This
// keeps async race regressions runnable without loading the desktop application.
type Harness = Record<string, any>;

function loadMethods(file: string, names: string[], dependencies: Record<string, unknown> = {}): Harness {
  const source = ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
  const members = source.statements.flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : []);
  const methods = names.map((name) => {
    const member = members.find((node) => node.name?.getText(source) === name);
    assert.ok(member, `Missing production member ${name}`);
    return member.getText(source);
  });
  const helpers = source.statements.filter((node) => ts.isFunctionDeclaration(node)
    && ["buildHostedState", "mapHostedErrorCode", "message", "isAbortError"].includes(node.name?.text ?? ""));
  const compiled = ts.transpileModule(
    `${helpers.map((node) => node.getText(source)).join("\n")}\nclass Harness { ${methods.join("\n")} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn new Harness();`)(...Object.values(dependencies)) as Harness;
}

function mainHarness(extraMethods: string[] = [], dependencies: Record<string, unknown> = {}): Harness {
  const notices: string[] = [];
  const plugin = loadMethods("src/main.ts", [
    "currentHostedProvider", "ensureHostedCredentialState", "loadHostedCredentialState", "syncHostedAiState",
    "beginHostedAiAction", "isCurrentHostedAiAction", "finishHostedAiAction", "checkHostedAiConnection",
    "saveHostedApiKey", "deleteHostedApiKey", "withLocalAiSignal", ...extraMethods,
  ], {
    Notice: class { constructor(value: string) { notices.push(value); } },
    providerLabel: aiProviderLabel,
    providerDomain: aiProviderDestination,
    aiProviderLabel,
    aiProviderDestination,
    isHostedApiProvider,
    selectedAiModel,
    ...dependencies,
  });
  Object.assign(plugin, {
    settings: { aiProvider: "openai", aiModel: "", aiModels: { openai: "" }, omdExecutable: "omd" },
    unloaded: false,
    localAiActionToken: 0,
    localAiControllers: new Set<AbortController>(),
    hostedCredentialHydration: null,
    hostedCredentialHydrationProvider: null,
    hostedAiState: null,
    notices,
    feedback: [] as string[],
    issues: [] as unknown[],
    refreshHomeViews() {},
    clearIssue() {},
    recordIssue(_context: string, error: unknown) { plugin.issues.push(error); },
    setLocalAiFeedback(_tone: string, detail: string) { plugin.feedback.push(detail); },
    requireReadyOmdExecutable: async () => "/Applications/OMD/bin/omd",
  });
  plugin.syncHostedAiState("");
  return plugin;
}

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, rejectPromise) => { resolveValue = resolve; reject = rejectPromise; });
  return { promise, resolve: resolveValue, reject };
}

const credential = { provider: "openai", source: "keychain", keychainSupported: true, envVar: "OPENAI_API_KEY" };

test("failed OMD hydration records one attempt and Check setup explicitly retries", async () => {
  const plugin = mainHarness();
  let attempts = 0;
  plugin.requireReadyOmdExecutable = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("OMD executable not found");
    return "/Applications/OMD/bin/omd";
  };
  plugin.omdBridge = {
    discoverProviderModels: async () => ({ models: ["test-model"], credential, destinationDomain: "api.openai.com" }),
  };
  await plugin.ensureHostedCredentialState("openai");
  assert.equal(plugin.hostedAiState.provider, "openai");
  assert.equal(typeof plugin.hostedAiState.checkedAt, "number");
  assert.match(plugin.hostedAiState.detail, /OMD executable not found.+Check setup to retry/u);
  await plugin.ensureHostedCredentialState("openai");
  assert.equal(attempts, 1, "a re-render must not retry failed automatic hydration");
  await plugin.checkHostedAiConnection();
  assert.equal(attempts, 2);
  assert.equal(plugin.hostedAiState.credential, credential);
  assert.equal(plugin.hostedAiState.code, "selected_model_missing");
  assert.equal(plugin.hostedAiState.activeAction, "");
});

test("failed credential bridge hydration remains attempted until explicitly forced", async () => {
  const plugin = mainHarness();
  let attempts = 0;
  plugin.omdBridge = { hostedCredentialState: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Keychain lookup failed");
    return credential;
  } };
  await plugin.ensureHostedCredentialState("openai");
  await plugin.ensureHostedCredentialState("openai");
  assert.equal(attempts, 1);
  assert.equal(plugin.hostedAiState.code, "credentials_missing");
  await plugin.ensureHostedCredentialState("openai", true);
  assert.equal(attempts, 2);
  assert.equal(plugin.hostedAiState.credential, credential);
});

for (const action of ["checkHostedAiConnection", "saveHostedApiKey", "deleteHostedApiKey"]) {
  for (const staleBy of ["provider", "token", "unload"]) {
    for (const fails of [false, true]) {
      test(`${action} ignores ${fails ? "failure" : "success"} after ${staleBy} changes`, async () => {
        const plugin = mainHarness();
        const pendingBridge = deferred<unknown>();
        const enteredBridge = deferred<void>();
        const bridgeCall = () => { enteredBridge.resolve(); return pendingBridge.promise; };
        plugin.omdBridge = {
          discoverProviderModels: bridgeCall,
          storeHostedApiKey: bridgeCall,
          deleteHostedApiKey: bridgeCall,
        };
        const pending = plugin[action]("typed-key");
        await enteredBridge.promise;
        if (staleBy === "provider") plugin.settings.aiProvider = "anthropic";
        if (staleBy === "token") plugin.localAiActionToken += 1;
        if (staleBy === "unload") plugin.unloaded = true;
        plugin.syncHostedAiState("");
        const state = plugin.hostedAiState;
        const feedback = [...plugin.feedback];
        if (fails) pendingBridge.reject(new Error("Late provider failure"));
        else pendingBridge.resolve(action === "checkHostedAiConnection"
          ? { models: ["late-model"], credential, destinationDomain: "api.openai.com" }
          : credential);
        await pending;
        assert.equal(plugin.hostedAiState, state);
        assert.deepEqual(plugin.feedback, feedback);
        assert.deepEqual(plugin.issues, []);
        assert.deepEqual(plugin.notices, []);
      });
    }
  }

  test(`${action} ignores an aborted bridge result`, async () => {
    const plugin = mainHarness();
    const abort = () => { throw new DOMException("Cancelled", "AbortError"); };
    plugin.omdBridge = { discoverProviderModels: abort, storeHostedApiKey: abort, deleteHostedApiKey: abort };
    await plugin[action]("typed-key");
    assert.equal(plugin.hostedAiState.code, "unchecked");
    assert.equal(plugin.hostedAiState.activeAction, "");
    assert.deepEqual(plugin.issues, []);
    assert.deepEqual(plugin.notices, []);
    assert.equal(plugin.feedback.length, 1, "aborted results must not publish failure feedback");
  });
}

test("credential hydration cannot overwrite a newer save action", async () => {
  const plugin = mainHarness();
  const pendingCredential = deferred<unknown>();
  const entered = deferred<void>();
  plugin.omdBridge = {
    hostedCredentialState: () => { entered.resolve(); return pendingCredential.promise; },
    storeHostedApiKey: async (_provider: string, key: string) => { assert.equal(key, "typed-key"); return credential; },
  };
  const hydration = plugin.ensureHostedCredentialState("openai");
  await entered.promise;
  assert.equal(await plugin.saveHostedApiKey("typed-key"), true);
  const saved = plugin.hostedAiState;
  pendingCredential.resolve({ ...credential, source: "missing" });
  await hydration;
  assert.equal(plugin.hostedAiState, saved);
});

test("shared setup publishes the verified executable without validating saved recognition choices", async () => {
  const verified = "/Applications/OMD/bin/omd";
  let checks = 0;
  const plugin = loadMethods("src/main.ts", ["runOmdCapabilityCheck", "resolvedOmdExecutable", "requireCaptureOmdExecutable"], {
    discoverOmdExecutable: async (_saved: string, _options: unknown, validate: (path: string) => Promise<unknown>) => {
      const executable = checks++ ? "/legacy/bin/omd" : verified;
      await validate(executable);
      return { executable, mode: "automatic" };
    },
    process,
    omdReadyMessage: () => "Ready",
    hasCaptureLanguageOverrides: () => false,
    probeOmdCaptureExecutable: async () => {},
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd", captureOcrLanguage: "unsupported-pack", captureAsrLanguage: "zh" },
    omdCapabilityGeneration: 1,
    usesAutomaticOmdDiscovery: () => true,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireEnrichNote: async () => ({ protocol_version: 1 }),
      requireCaptureLanguages: async () => { assert.fail("Capture recognition cannot block shared setup"); },
    },
  });
  assert.equal(await plugin.runOmdCapabilityCheck(1), true);
  assert.equal(plugin.resolvedOmdExecutable(), verified);
  assert.equal(plugin.enrichmentCapability.resolvedExecutable, verified);
  assert.equal(await plugin.requireCaptureOmdExecutable({}), "/legacy/bin/omd");
  assert.equal(plugin.resolvedOmdExecutable(), verified, "capture discovery cannot replace the shared verified path");
});

test("password input forwards the typed API key to Keychain and clears only confirmed saves", async () => {
  const inputs: Harness[] = [];
  const buttons: Harness[] = [];
  class TextComponent {
    inputEl = { type: "text", autocomplete: "" };
    value = "";
    change!: (value: string) => void;
    constructor() { inputs.push(this); }
    setValue(value: string) { this.value = value; return this; }
    setPlaceholder() { return this; }
    onChange(change: (value: string) => void) { this.change = change; return this; }
  }
  class Setting {
    controlEl = {};
    settingEl = { addClass() {} };
    setName() { return this; }
    setDesc() { return this; }
    addButton(callback: (button: Harness) => void) {
      const button: Harness = {
        setButtonText() { return button; },
        setDisabled() { return button; },
        onClick(click: () => Promise<void>) { button.click = click; return button; },
      };
      buttons.push(button);
      callback(button);
      return this;
    }
  }
  const tab = loadMethods("src/settings.ts", ["hostedCredentialSetting"], {
    Platform: { isMacOS: true }, Setting, TextComponent, aiProviderEnvVar,
  });
  const saved: string[] = [];
  let confirmed = false;
  tab.plugin = {
    hostedAiState: null,
    saveHostedApiKey: async (value: string) => { saved.push(value); return confirmed; },
    settings: {},
  };
  tab.hostedCredentialSetting({ isConnected: false }, "openai");
  assert.equal(inputs[0].inputEl.type, "password");
  inputs[0].setValue("sk-actual-typed-secret").change("sk-actual-typed-secret");
  await buttons[0].click();
  assert.equal(inputs[0].value, "sk-actual-typed-secret");
  confirmed = true;
  await buttons[0].click();
  assert.deepEqual(saved, ["sk-actual-typed-secret", "sk-actual-typed-secret"]);
  assert.equal(inputs[0].value, "");
  assert.deepEqual(tab.plugin.settings, {});
});

test("unload closes cloud consent and blocks even an approval queued just before unload", async () => {
  const decision = deferred<boolean>();
  const opened = deferred<void>();
  let closed = 0;
  const plugin = mainHarness(["askOmd", "onunload"], {
    cloudAnswerPermissionEnabled: () => true,
    CloudAnswerConsentModal: class {
      openAndWait() { opened.resolve(); return decision.promise; }
      close() { closed += 1; decision.resolve(false); }
    },
  });
  Object.assign(plugin, {
    cloudAnswerConsentModals: new Set(),
    calendarRefreshTimer: null,
    calendarWriteOverrides: new Map(),
    localAiSummaries: new Map(),
    omdCapabilityService: { dispose() {} },
    omdEnrichmentRunner: { dispose() {} },
    qaRetrievalOptions: () => ({}),
    previewCloudAnswer: async () => ({ provider: "openai", retrieval: {}, preview: { preview: {}, evidence: [] } }),
    executeCloudAnswer: async () => { assert.fail("No evidence may be sent after unload"); },
    assertCloudPreviewStillCurrent: () => { assert.fail("Unloaded consent must stop before cloud execution"); },
  });
  const output = { hidden: false, empty() {}, createDiv() {} };
  const answer = plugin.askOmd("Question", output);
  await opened.promise;
  assert.equal(plugin.cloudAnswerConsentModals.size, 1);
  decision.resolve(true);
  plugin.onunload();
  await answer;
  assert.equal(closed, 1);
  assert.equal(plugin.cloudAnswerConsentModals.size, 0);
  assert.deepEqual(plugin.issues, []);
});

test("unloaded lifecycle refuses new local-AI signal work", async () => {
  const plugin = mainHarness();
  plugin.unloaded = true;
  await assert.rejects(plugin.withLocalAiSignal(async () => assert.fail("Work cannot start after unload")), { name: "AbortError" });
});
