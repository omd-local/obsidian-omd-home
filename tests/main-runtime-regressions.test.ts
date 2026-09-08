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
    && ["buildHostedState", "mapHostedErrorCode", "message", "isAbortError", "isModelReadinessCode", "remapLocalAiError", "waitForSharedPromise"].includes(node.name?.text ?? ""));
  const compiled = ts.transpileModule(
    `${helpers.map((node) => node.getText(source)).join("\n")}\nclass Harness { ${methods.join("\n")} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn new Harness();`)(...Object.values(dependencies)) as Harness;
}

function readMethod(file: string, name: string): string {
  const source = ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
  const member = source.statements
    .flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : [])
    .find((node) => node.name?.getText(source) === name);
  assert.ok(member, `Missing production member ${name}`);
  return member.getText(source);
}

function mainHarness(extraMethods: string[] = [], dependencies: Record<string, unknown> = {}): Harness {
  const notices: string[] = [];
  const plugin = loadMethods("src/main.ts", [
    "currentHostedProvider", "ensureHostedCredentialState", "loadHostedCredentialState", "syncHostedAiState",
    "beginHostedAiAction", "isCurrentHostedAiAction", "finishHostedAiAction", "checkHostedAiConnection",
    "hostedAiSignal", "cancelHostedAiAction", "invalidateCloudAnswerConsent", "saveHostedApiKey",
    "deleteHostedApiKey", "assertCloudConsentStillCurrent", "withLocalAiSignal", "aiSetupBusy", "canStartAiSetupAction",
    "beginHostedCredentialMutation", "finishHostedCredentialMutation", ...extraMethods,
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
    hostedAiController: null,
    hostedCredentialMutation: null,
    cloudAnswerConsentGeneration: 0,
    cloudAnswerConsentModals: new Set(),
    localAiState: { activeAction: "" },
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

test("an aborted OMD search forwards cancellation and stays silent", async () => {
  const plugin = mainHarness(["searchWithOmd"]);
  const entered = deferred<void>();
  const pending = deferred<void>();
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  plugin.vaultPath = () => "/vault";
  plugin.omdBridge = {
    async search(_vault: string, _query: string, signal?: AbortSignal) {
      receivedSignal = signal;
      entered.resolve();
      await pending.promise;
      signal?.throwIfAborted();
      return [];
    },
  };
  const output = { empty() {}, hidden: false, createDiv() {} };

  const searching = plugin.searchWithOmd("missing note", output, controller.signal);
  await entered.promise;
  controller.abort();
  pending.resolve();
  await searching;

  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(plugin.notices, []);
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

test("provider or model invalidation aborts a live hosted keychain mutation", async () => {
  const plugin = mainHarness(["invalidateLocalAiState", "cancelLocalAiRequests"]);
  plugin.currentLocalAiHost = () => null;
  plugin.syncLocalAiState = () => {};
  plugin.localAiSummaries = new Map();
  const entered = deferred<void>();
  let signal: AbortSignal | undefined;
  plugin.omdBridge = {
    storeHostedApiKey: async (_provider: string, _key: string, receivedSignal: AbortSignal) => {
      signal = receivedSignal;
      entered.resolve();
      await new Promise<void>((_resolve, reject) => receivedSignal.addEventListener(
        "abort",
        () => reject(new DOMException("Cancelled", "AbortError")),
        { once: true },
      ));
      return credential;
    },
  };
  const pending = plugin.saveHostedApiKey("typed-key");
  await entered.promise;
  plugin.invalidateLocalAiState("provider");
  assert.equal(signal?.aborted, true);
  assert.equal(await pending, false);
  assert.equal(plugin.hostedAiState.activeAction, "");
});

test("cancelled hosted credential mutation drains before another setup action starts", async () => {
  const plugin = mainHarness(["invalidateLocalAiState", "cancelLocalAiRequests"]);
  plugin.currentLocalAiHost = () => null;
  plugin.syncLocalAiState = () => {};
  plugin.localAiSummaries = new Map();
  const firstSave = deferred<typeof credential>();
  const saveEntered = deferred<void>();
  let saveCalls = 0;
  let deleteCalls = 0;
  let checkCalls = 0;
  let firstSignal: AbortSignal | undefined;
  plugin.omdBridge = {
    storeHostedApiKey: async (_provider: string, _key: string, signal: AbortSignal) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        firstSignal = signal;
        saveEntered.resolve();
        return await firstSave.promise;
      }
      return credential;
    },
    deleteHostedApiKey: async () => {
      deleteCalls += 1;
      return { ...credential, source: "missing" };
    },
    discoverProviderModels: async () => {
      checkCalls += 1;
      return { models: ["test-model"], credential, destinationDomain: "api.openai.com" };
    },
  };

  const pending = plugin.saveHostedApiKey("first-key");
  await saveEntered.promise;
  plugin.invalidateLocalAiState("answer-model");
  assert.equal(firstSignal?.aborted, true);

  await plugin.deleteHostedApiKey();
  assert.equal(await plugin.saveHostedApiKey("blocked-key"), false);
  assert.equal(await plugin.checkHostedAiConnection(), false);
  assert.equal(saveCalls, 1, "a second save must not enter the Keychain bridge while the cancelled save drains");
  assert.equal(deleteCalls, 0, "delete must not enter the Keychain bridge while the cancelled save drains");
  assert.equal(checkCalls, 0, "Check setup must not read stale credentials while the cancelled save drains");

  firstSave.resolve(credential);
  assert.equal(await pending, false);
  assert.equal(await plugin.saveHostedApiKey("after-drain"), true);
  await plugin.deleteHostedApiKey();
  assert.equal(saveCalls, 2);
  assert.equal(deleteCalls, 1);
  await plugin.checkHostedAiConnection();
  assert.equal(checkCalls, 1, "non-mutation setup resumes after the credential drain finishes");
});

test("hosted setup refreshes Home at action boundaries", () => {
  const plugin = mainHarness();
  let refreshes = 0;
  plugin.refreshHomeViews = () => { refreshes += 1; };
  const token = plugin.beginHostedAiAction("save-key");
  plugin.finishHostedAiAction(token, "openai");
  assert.equal(refreshes, 2);
});

test("hosted credential drain completion refreshes Home exactly once", () => {
  const plugin = mainHarness();
  let refreshes = 0;
  plugin.refreshHomeViews = () => { refreshes += 1; };
  const mutation = plugin.beginHostedCredentialMutation();
  assert.equal(plugin.aiSetupBusy(), true);

  plugin.finishHostedCredentialMutation(mutation);
  assert.equal(plugin.aiSetupBusy(), false);
  assert.equal(refreshes, 1);

  plugin.finishHostedCredentialMutation(mutation);
  assert.equal(refreshes, 1, "a stale owner must not publish another completion refresh");
});

test("a cloud-consent generation rejects an away-and-back route before any send", () => {
  const plugin = mainHarness([], {
    LocalAiError: class LocalAiError extends Error {
      constructor(_code: string, detail: string) { super(detail); }
    },
  });
  let previewChecks = 0;
  plugin.assertCloudPreviewStillCurrent = () => { previewChecks += 1; };
  const modal = { closed: 0, close() { this.closed += 1; } };
  plugin.cloudAnswerConsentModals.add(modal);
  const generation = plugin.cloudAnswerConsentGeneration;
  plugin.invalidateCloudAnswerConsent(); // provider changed away
  plugin.invalidateCloudAnswerConsent(); // and back to the same route
  assert.equal(modal.closed, 1);
  assert.throws(
    () => plugin.assertCloudConsentStillCurrent({ provider: "openai", model: "gpt-test", endpoint: "http://localhost:11434" }, generation),
    /settings changed after preview/u,
  );
  assert.equal(previewChecks, 0, "stale consent must be rejected before a cloud send can start");
  assert.match(readMethod("src/main.ts", "askOmd"), /assertCloudConsentStillCurrent\(preview, consentGeneration\)[\s\S]*executeCloudAnswer/u);
});

test("shared setup publishes the verified executable and capture probes it before other candidates", async () => {
  const verified = "/Applications/OMD/bin/omd";
  let checks = 0;
  const preferred: Array<string | undefined> = [];
  const plugin = loadMethods("src/main.ts", ["runOmdCapabilityCheck", "resolvedOmdExecutable", "requireCaptureOmdExecutable"], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
      _resolve: unknown,
      preferredExecutable?: string,
    ) => {
      preferred.push(preferredExecutable);
      const executable = preferredExecutable || verified;
      checks += 1;
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
  assert.equal(await plugin.requireCaptureOmdExecutable({}), verified);
  assert.deepEqual(preferred, [undefined, verified]);
  assert.equal(checks, 2);
  assert.equal(plugin.resolvedOmdExecutable(), verified, "capture discovery cannot replace the shared verified path");
});

test("capture retry keeps the last verified OMD ahead of a capture-compatible legacy PATH binary", async () => {
  const legacy = "/legacy/bin/omd";
  const verified = "/Applications/OMD/bin/omd";
  const retryEntered = deferred<void>();
  const releaseRetry = deferred<void>();
  const preferred: Array<string | undefined> = [];
  const captureProbes: string[] = [];
  let discovery = 0;
  const plugin = loadMethods("src/main.ts", [
    "runOmdCapabilityCheck",
    "resetEnrichmentCapability",
    "requireCaptureOmdExecutable",
  ], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
      _resolve: unknown,
      preferredExecutable?: string,
    ) => {
      discovery += 1;
      preferred.push(preferredExecutable);
      if (discovery === 2) {
        retryEntered.resolve();
        await releaseRetry.promise;
      }
      const candidates = [...new Set([preferredExecutable, legacy, verified].filter(Boolean) as string[])];
      let failure: unknown;
      for (const candidate of candidates) {
        try {
          await validate(candidate);
          return { executable: candidate, mode: "automatic" };
        } catch (error) {
          failure = error;
        }
      }
      throw failure;
    },
    process,
    omdReadyMessage: () => "Ready",
    hasCaptureLanguageOverrides: () => false,
    probeOmdCaptureExecutable: async (executable: string) => { captureProbes.push(executable); },
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd" },
    omdCapabilityGeneration: 1,
    omdCapabilityCheck: null,
    discoveredOmdExecutable: "",
    lastVerifiedOmdExecutable: "",
    usesAutomaticOmdDiscovery: () => true,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireEnrichNote: async (executable: string) => {
        if (executable === legacy) throw new Error("Legacy OMD has no enrich-note capability");
        return { protocol_version: 1 };
      },
      requireCaptureLanguages: async () => {},
      cancelActive() {},
      clear() {},
    },
  });

  assert.equal(await plugin.runOmdCapabilityCheck(1), true);
  plugin.resetEnrichmentCapability(true);
  assert.equal(plugin.discoveredOmdExecutable, "");
  assert.equal(plugin.lastVerifiedOmdExecutable, verified);

  const retry = plugin.requireCaptureOmdExecutable({});
  await retryEntered.promise;
  assert.equal(preferred[1], verified);
  releaseRetry.resolve();
  assert.equal(await retry, verified);
  assert.deepEqual(captureProbes, [verified], "retry must not accept the legacy PATH binary before the verified hint");
  plugin.resetEnrichmentCapability();
  assert.equal(plugin.lastVerifiedOmdExecutable, "", "an explicit executable-setting reset must discard the old hint");
});

test("cold-start capture shares pending automatic setup discovery before probing PATH", async () => {
  const legacy = "/legacy/bin/omd";
  const verified = "/Applications/OMD/bin/omd";
  const setupEntered = deferred<void>();
  const releaseSetup = deferred<void>();
  const preferred: Array<string | undefined> = [];
  const captureProbes: string[] = [];
  let discovery = 0;
  const plugin = loadMethods("src/main.ts", [
    "checkEnrichmentCapability",
    "runOmdCapabilityCheck",
    "requireCaptureOmdExecutable",
  ], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
      _resolve: unknown,
      preferredExecutable?: string,
    ) => {
      discovery += 1;
      preferred.push(preferredExecutable);
      if (discovery === 1) {
        setupEntered.resolve();
        await releaseSetup.promise;
      }
      const candidates = [...new Set([preferredExecutable, legacy, verified].filter(Boolean) as string[])];
      let failure: unknown;
      for (const candidate of candidates) {
        try {
          await validate(candidate);
          return { executable: candidate, mode: "automatic" };
        } catch (error) {
          failure = error;
        }
      }
      throw failure;
    },
    process,
    omdReadyMessage: () => "Ready",
    isEnrichmentError: () => false,
    hasCaptureLanguageOverrides: () => false,
    probeOmdCaptureExecutable: async (executable: string) => { captureProbes.push(executable); },
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd" },
    omdCapabilityGeneration: 0,
    omdCapabilityCheck: null,
    discoveredOmdExecutable: "",
    lastVerifiedOmdExecutable: "",
    enrichmentCapability: { status: "unchecked", message: "Unchecked" },
    usesAutomaticOmdDiscovery: () => true,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireEnrichNote: async (executable: string) => {
        if (executable === legacy) throw new Error("Legacy OMD has no enrich-note capability");
        return { protocol_version: 1 };
      },
      requireCaptureLanguages: async () => {},
      cancelActive() {},
      clear() {},
    },
  });

  const setup = plugin.checkEnrichmentCapability();
  await setupEntered.promise;
  const capture = plugin.requireCaptureOmdExecutable({});
  await Promise.resolve();
  assert.equal(discovery, 1, "capture should not launch competing discovery while setup is pending");
  assert.deepEqual(captureProbes, []);

  releaseSetup.resolve();
  assert.equal(await setup, true);
  assert.equal(await capture, verified);
  assert.deepEqual(preferred, ["", verified]);
  assert.deepEqual(captureProbes, [verified], "cold-start capture must not accept the legacy PATH binary");
});

test("cancelled capture stops waiting without cancelling shared automatic discovery", async () => {
  const sharedDiscovery = deferred<boolean>();
  let captureDiscoveryCalls = 0;
  const plugin = loadMethods("src/main.ts", ["requireCaptureOmdExecutable"], {
    discoverOmdExecutable: async () => {
      captureDiscoveryCalls += 1;
      return { executable: "/Applications/OMD/bin/omd", mode: "automatic" };
    },
    process,
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd" },
    omdCapabilityCheck: sharedDiscovery.promise,
    discoveredOmdExecutable: "",
    lastVerifiedOmdExecutable: "",
    usesAutomaticOmdDiscovery: () => true,
  });

  const controller = new AbortController();
  const capture = plugin.requireCaptureOmdExecutable({}, controller.signal);
  const observed = capture.then(
    (value: string) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: "", error }),
  );
  let captureSettled = false;
  void observed.then(() => { captureSettled = true; });

  controller.abort();
  await new Promise<void>((resolveTick) => setImmediate(resolveTick));
  assert.equal(captureSettled, true, "the caller should not wait for shared discovery after cancellation");
  const result = await observed;
  assert.equal(result.value, "");
  assert.equal((result.error as Error).name, "AbortError");
  assert.equal(captureDiscoveryCalls, 0);

  sharedDiscovery.resolve(true);
  assert.equal(await sharedDiscovery.promise, true, "caller cancellation must not cancel shared discovery");
});

test("AI setup actions refuse to overlap across local and hosted controls", () => {
  const notices: string[] = [];
  const plugin = loadMethods("src/main.ts", ["aiSetupBusy", "canStartAiSetupAction"], {
    Notice: class { constructor(value: string) { notices.push(value); } },
  });
  plugin.localAiState = { activeAction: "" };
  plugin.hostedAiState = null;
  assert.equal(plugin.canStartAiSetupAction(), true);

  plugin.localAiState.activeAction = "check-connection";
  assert.equal(plugin.canStartAiSetupAction(), false);
  plugin.localAiState.activeAction = "";
  plugin.hostedAiState = { activeAction: "save-key" };
  assert.equal(plugin.canStartAiSetupAction(false), false);
  assert.equal(notices.length, 1);

  plugin.hostedAiState = null;
  plugin.hostedCredentialMutation = Symbol("draining-keychain-child");
  assert.equal(plugin.aiSetupBusy(), true);
  assert.equal(plugin.canStartAiSetupAction(false), false);

  for (const method of [
    "checkHostedAiConnection",
    "checkOllamaCloudConnection",
    "saveHostedApiKey",
    "deleteHostedApiKey",
    "refreshLocalAiCatalog",
    "checkLocalAiConnection",
    "smokeLocalAiWorkflow",
    "testLocalEmbeddings",
  ]) {
    assert.match(readMethod("src/main.ts", method), /canStartAiSetupAction/u, method);
  }
});

test("a deferred AI setup operation rejects a second public setup action", async () => {
  const plugin = mainHarness();
  const pendingSave = deferred<typeof credential>();
  const saveEntered = deferred<void>();
  let deleteCalls = 0;
  plugin.omdBridge = {
    storeHostedApiKey: async () => {
      saveEntered.resolve();
      return await pendingSave.promise;
    },
    deleteHostedApiKey: async () => {
      deleteCalls += 1;
      return { ...credential, source: "missing" };
    },
  };

  const saving = plugin.saveHostedApiKey("typed-key");
  await saveEntered.promise;
  assert.equal(plugin.hostedAiState.activeAction, "save-key");
  await plugin.deleteHostedApiKey();
  assert.equal(deleteCalls, 0, "the second action must not enter its bridge boundary");
  assert.match(plugin.notices.at(-1) ?? "", /Another AI setup action is already running/u);

  pendingSave.resolve(credential);
  assert.equal(await saving, true);
  assert.equal(plugin.hostedAiState.activeAction, "");
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
    setDisabled() { return this; }
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
  const tab = loadMethods("src/settings.ts", ["hostedCredentialSetting", "runAiSetupAction"], {
    Platform: { isMacOS: true }, Setting, TextComponent, aiProviderEnvVar,
  });
  tab.hostedCredentialDrafts = new Map();
  const container = { isConnected: true };
  tab.rerenderLocalAiSection = () => tab.hostedCredentialSetting(container, "openai");
  const saved: string[] = [];
  let confirmed = false;
  tab.plugin = {
    aiSetupBusy: () => false,
    hostedAiState: null,
    localAiState: { activeAction: "" },
    saveHostedApiKey: async (value: string) => { saved.push(value); return confirmed; },
    settings: {},
  };
  tab.hostedCredentialSetting(container, "openai");
  assert.equal(inputs[0].inputEl.type, "password");
  inputs[0].setValue("sk-actual-typed-secret").change("sk-actual-typed-secret");
  await buttons[0].click();
  assert.equal(inputs.at(-1)?.value, "sk-actual-typed-secret");
  confirmed = true;
  await buttons[0].click();
  assert.deepEqual(saved, ["sk-actual-typed-secret", "sk-actual-typed-secret"]);
  assert.equal(inputs.at(-1)?.value, "");
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
    assertCloudPreviewStillCurrent: () => {},
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

test("an obsolete local Ask preserves its abort through the safety gate without publishing stale AI state", async () => {
  const notices: string[] = [];
  const statusEntered = deferred<void>();
  const status = deferred<never>();
  const priorSummary = { host: "http://localhost:11434", daemonCode: "ready" };
  const priorFailure = { host: "http://localhost:11434", daemonCode: "daemon_unreachable" };
  const plugin = loadMethods("src/main.ts", [
    "askOmd",
    "runLocalAiGated",
    "withLocalAiSignal",
    "runLocalAiSafetyGate",
  ], {
    Notice: class { constructor(value: string) { notices.push(value); } },
    selectedAiModel: () => "local-model",
    executeWithLocalAiGate: async (
      snapshot: unknown,
      _getCurrentSnapshot: unknown,
      gate: (snapshot: unknown, signal?: AbortSignal) => Promise<void>,
      downstream: (snapshot: unknown, signal?: AbortSignal) => Promise<unknown>,
      signal: AbortSignal,
    ) => {
      await gate(snapshot, signal);
      return await downstream(snapshot, signal);
    },
  });
  Object.assign(plugin, {
    unloaded: false,
    settings: { aiProvider: "ollama", hybridRetrievalEnabled: false },
    localAiControllers: new Set<AbortController>(),
    localAiState: { activeAction: "" },
    localAiSummaries: new Map([["http://localhost:11434", priorSummary]]),
    localAiFailure: priorFailure,
    ollamaLocalClient: {
      status: async () => {
        statusEntered.resolve();
        return await status.promise;
      },
      tags: async () => assert.fail("Cancellation must stop before model-state updates"),
    },
    requireReadyOmdExecutable: async () => "/Applications/OMD/bin/omd",
    qaRetrievalOptions: () => ({}),
    previewLocalAnswer: async (_query: string, signal: AbortSignal) => ({
      preview: await plugin.runLocalAiGated(
        { enabled: true, host: "http://localhost:11434", model: "local-model" },
        () => ({ enabled: true, host: "http://localhost:11434", model: "local-model" }),
        async () => assert.fail("Cancellation must stop before the local Ask downstream request"),
        signal,
      ),
      retrieval: {},
    }),
    clearIssue() { assert.fail("An obsolete Ask must not clear global AI state"); },
    renderAiAnswer() { assert.fail("An obsolete Ask must not render a result"); },
    reportLocalAiWorkflowIssue() { assert.fail("An obsolete Ask must not report a global AI issue"); },
    syncLocalAiState() { assert.fail("An obsolete Ask must not refresh local AI readiness"); },
  });
  const output = { hidden: true, empty() {}, createDiv() {} };
  const controller = new AbortController();
  const asking = plugin.askOmd("obsolete question", output, controller.signal);
  await statusEntered.promise;
  const aborted = new DOMException("Cancelled", "AbortError");
  controller.abort();
  status.reject(aborted);
  await asking;

  assert.equal(plugin.localAiSummaries.get("http://localhost:11434"), priorSummary);
  assert.equal(plugin.localAiFailure, priorFailure);
  assert.deepEqual(notices, []);
});
