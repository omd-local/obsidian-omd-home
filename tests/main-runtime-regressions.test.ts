import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  aiProviderDestination,
  aiProviderEnvVar,
  aiProviderLabel,
  isHostedApiProvider,
  modelIsCloudBacked,
  modelIsVerifiedOllamaCloud,
  selectedAiModel,
} from "../src/ai-provider.ts";
import {
  aggregateLocalAiState,
  buildConnectionSummary,
  buildModelEntry,
  deriveLocalAiDaemonCode,
  deriveLocalAiModelCode,
  describeDaemonReadiness,
  describeLocalCompletionCatalog,
  describeModelReadiness,
  localModelNamesMatch,
  mergeInspectedModelEntry,
  modelSupportsEmbedding,
  normalizeLocalOllamaHost,
  oneClickInstallableEmbeddingModel,
} from "../src/local-ai-readiness.ts";
import { LocalAiError, type LocalAiModelInfo, type LocalAiRuntimeState } from "../src/ollama-local-types.ts";

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
    && ["buildHostedState", "humanizeRetrievalWarning", "isEmbeddingRetrievalWarning", "mapHostedErrorCode", "message", "isAbortError", "isModelReadinessCode", "remapLocalAiError", "retrievalWarningForError", "waitForSharedPromise"].includes(node.name?.text ?? ""));
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
    "beginHostedCredentialMutation", "finishHostedCredentialMutation", "assertProviderDestination", "renderRetrievalDiagnostics",
    "withCloudAnswerSignal", "cancelCloudAnswerRequests", ...extraMethods,
  ], {
    Notice: class { constructor(value: string) { notices.push(value); } },
    providerLabel: aiProviderLabel,
    providerDomain: aiProviderDestination,
    aiProviderLabel,
    aiProviderDestination,
    isHostedApiProvider,
    LocalAiError,
    oneClickInstallableEmbeddingModel,
    selectedAiModel,
    ...dependencies,
  });
  Object.assign(plugin, {
    settings: { aiProvider: "openai", aiModel: "", aiModels: { openai: "" }, omdExecutable: "omd" },
    unloaded: false,
    localAiActionToken: 0,
    localAiControllers: new Set<AbortController>(),
    cloudAnswerControllers: new Set<AbortController>(),
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

function localSetupHarness(model: LocalAiModelInfo, remote = false): { plugin: Harness; calls: string[]; vaultCalls: string[] } {
  const calls: string[] = [];
  const vaultCalls: string[] = [];
  const host = "http://localhost:11434";
  const plugin = mainHarness([
    "checkLocalAiConnection",
    "activeLocalAiModels",
    "safeShowModel",
    "beginLocalAiAction",
    "finishLocalAiAction",
  ], {
    LocalAiError,
    aggregateLocalAiState,
    buildConnectionSummary,
    buildModelEntry,
    deriveLocalAiDaemonCode,
    deriveLocalAiModelCode,
    describeDaemonReadiness,
    describeLocalCompletionCatalog,
    describeModelReadiness,
    getActiveWorkflowModels: (settings: Harness) => [{ model: settings.aiModel }],
    localModelNamesMatch,
    mergeInspectedModelEntry,
    normalizeLocalOllamaHost,
  });
  const catalogEntry = buildModelEntry({
    ...model,
    remoteModel: remote ? model.name : undefined,
    remoteHost: remote ? "https://ollama.com" : undefined,
  });
  Object.assign(plugin, {
    settings: {
      aiProvider: "ollama",
      aiModel: model.name,
      localWritingModel: model.name,
      embeddingModel: "bge-m3",
      ollamaHost: host,
      capturePolish: false,
    },
    localAiActionToken: 0,
    localAiControllers: new Set<AbortController>(),
    localAiSummaries: new Map(),
    localAiFailure: null,
    ollamaLocalClient: {
      version: async (receivedHost: string) => { calls.push(`version:${receivedHost}`); return { version: "0.33.3" }; },
      status: async (receivedHost: string) => { calls.push(`status:${receivedHost}`); return { cloud: { disabled: false } }; },
      tags: async (receivedHost: string) => { calls.push(`tags:${receivedHost}`); return [catalogEntry]; },
      show: async (receivedHost: string, receivedModel: string) => {
        calls.push(`show:${receivedHost}:${receivedModel}`);
        if (!localModelNamesMatch(receivedModel, model.name)) {
          throw new LocalAiError("selected_model_missing", `${receivedModel} is not installed.`);
        }
        return { ...model, remoteModel: catalogEntry.remoteModel, remoteHost: catalogEntry.remoteHost };
      },
      smoke: async () => assert.fail("Check setup must not generate model output"),
      embed: async () => assert.fail("Check setup must not generate embeddings"),
      pull: async () => assert.fail("Check setup must not download models"),
    },
    omdBridge: {
      search: async () => { vaultCalls.push("search"); },
      answer: async () => { vaultCalls.push("answer"); },
    },
  });
  plugin.syncLocalAiState = (activeAction: LocalAiRuntimeState["activeAction"]) => {
    const summary = plugin.localAiSummaries.get(host) ?? null;
    plugin.localAiState = aggregateLocalAiState(plugin.settings, summary, summary?.models ?? [], activeAction);
  };
  plugin.syncLocalAiState("");
  return { plugin, calls, vaultCalls };
}

function embeddingInstallHarness(savedModel: string, catalog: LocalAiModelInfo[] = []): { plugin: Harness; calls: string[] } {
  const calls: string[] = [];
  const plugin = mainHarness(["installEmbeddingModel"], {
    buildModelEntry,
    localModelNamesMatch,
    mergeInspectedModelEntry,
    modelIsCloudBacked,
    modelSupportsEmbedding,
    normalizeLocalOllamaHost,
    oneClickInstallableEmbeddingModel,
  });
  Object.assign(plugin.settings, {
    embeddingModel: savedModel,
    ollamaHost: "http://localhost:11434",
  });
  plugin.canStartAiSetupAction = () => true;
  plugin.beginLocalAiAction = (action: string) => {
    calls.push(`begin:${action}`);
    return 1;
  };
  plugin.finishLocalAiAction = (token: number) => { calls.push(`finish:${token}`); };
  plugin.withLocalAiSignal = async (task: (signal: AbortSignal) => Promise<unknown>) => await task(new AbortController().signal);
  plugin.reportLocalAiWorkflowIssue = (error: unknown) => { plugin.issues.push(error); };
  plugin.safeShowModel = async (_host: string, model: string) => {
    calls.push(`show:${model}`);
    return { name: model, capabilities: ["embedding"] };
  };
  plugin.ollamaLocalClient = {
    tags: async () => {
      calls.push("tags");
      return catalog.map((entry) => buildModelEntry(entry));
    },
    pull: async (_host: string, model: string) => { calls.push(`pull:${model}`); },
  };
  plugin.refreshLocalAiCatalog = async (force: boolean) => { calls.push(`refresh:${String(force)}`); };
  return { plugin, calls };
}

const credential = {
  provider: "openai",
  source: "keychain",
  keychainSupported: true,
  envVar: "OPENAI_API_KEY",
  envPresent: false,
  keychainPresent: true,
};

test("local setup accepts a model that advertises both thinking and completion", async () => {
  const { plugin, calls, vaultCalls } = localSetupHarness({
    name: "qwen3:4b-instruct",
    capabilities: ["completion", "thinking", "tools"],
  });

  assert.equal(await plugin.checkLocalAiConnection(), true);
  const checked = plugin.localAiSummaries.get("http://localhost:11434").modelChecks["qwen3:4b-instruct"];
  assert.equal(checked.code, "ready");
  assert.equal(checked.supportsCompletion, true);
  assert.deepEqual(calls, [
    "version:http://localhost:11434",
    "status:http://localhost:11434",
    "tags:http://localhost:11434",
    "show:http://localhost:11434:qwen3:4b-instruct",
    "show:http://localhost:11434:bge-m3",
  ]);
  assert.deepEqual(vaultCalls, []);
});

test("local setup blocks an exposed cloud-backed custom model without touching the vault", async () => {
  const { plugin, calls, vaultCalls } = localSetupHarness({
    name: "gpt-oss:20b-cloud",
    capabilities: ["completion"],
  }, true);

  assert.equal(await plugin.checkLocalAiConnection(), false);
  const checked = plugin.localAiSummaries.get("http://localhost:11434").modelChecks["gpt-oss:20b-cloud"];
  assert.equal(checked.code, "selected_model_remote_blocked");
  assert.equal(checked.supportsCompletion, true);
  assert.deepEqual(calls, [
    "version:http://localhost:11434",
    "status:http://localhost:11434",
    "tags:http://localhost:11434",
    "show:http://localhost:11434:gpt-oss:20b-cloud",
    "show:http://localhost:11434:bge-m3",
  ]);
  assert.deepEqual(vaultCalls, []);
});

test("one-click embedding installation enforces its allowlist and stale-action snapshot before network access", async () => {
  const unsupported = embeddingInstallHarness("nomic-embed-text");
  assert.equal(await unsupported.plugin.installEmbeddingModel("nomic-embed-text"), false);
  assert.deepEqual(unsupported.calls, ["begin:install-embedding", "finish:1"]);

  const stale = embeddingInstallHarness("other-model");
  assert.equal(await stale.plugin.installEmbeddingModel("bge-m3"), false);
  assert.deepEqual(stale.calls, ["begin:install-embedding", "finish:1"]);
});

test("one-click embedding installation canonicalizes aliases and downloads only when explicitly requested", async () => {
  const installed = embeddingInstallHarness("BGE-M3", [{
    name: "bge-m3:latest",
    capabilities: ["embedding"],
  }]);
  assert.equal(await installed.plugin.installEmbeddingModel("BGE-M3:latest"), true);
  assert.deepEqual(installed.calls, [
    "begin:install-embedding",
    "tags",
    "show:bge-m3",
    "finish:1",
    "refresh:false",
  ]);

  const missing = embeddingInstallHarness("bge-m3");
  assert.equal(await missing.plugin.installEmbeddingModel("bge-m3"), true);
  assert.deepEqual(missing.calls, [
    "begin:install-embedding",
    "tags",
    "pull:bge-m3",
    "show:bge-m3",
    "finish:1",
    "refresh:false",
  ]);
});

test("Switch to keyword search persists the retrieval choice once and leaves an already-keyword setup unchanged", async () => {
  const plugin = mainHarness(["useSparseRetrieval"]);
  const calls: string[] = [];
  plugin.settings.hybridRetrievalEnabled = true;
  plugin.invalidateLocalAiState = (reason: string) => { calls.push(`invalidate:${reason}`); };
  plugin.saveSettings = async () => { calls.push("save"); };
  plugin.refreshHomeViews = () => { calls.push("refresh"); };

  assert.equal(await plugin.useSparseRetrieval(), true);
  assert.equal(plugin.settings.hybridRetrievalEnabled, false);
  assert.deepEqual(calls, ["invalidate:retrieval", "save", "refresh"]);
  assert.match(plugin.feedback.at(-1) ?? "", /Keyword search selected/u);

  assert.equal(await plugin.useSparseRetrieval(), false);
  assert.deepEqual(calls, ["invalidate:retrieval", "save", "refresh"]);
  assert.equal(plugin.notices.at(-1), "Keyword search is already selected.");
});

test("Switch to keyword search cannot invalidate an in-flight AI setup action", async () => {
  const plugin = mainHarness(["useSparseRetrieval"]);
  const calls: string[] = [];
  plugin.settings.hybridRetrievalEnabled = true;
  plugin.hostedCredentialMutation = Symbol("saving-key");
  plugin.invalidateLocalAiState = (reason: string) => { calls.push(`invalidate:${reason}`); };
  plugin.saveSettings = async () => { calls.push("save"); };
  plugin.refreshHomeViews = () => { calls.push("refresh"); };

  assert.equal(await plugin.useSparseRetrieval(), false);

  assert.equal(plugin.settings.hybridRetrievalEnabled, true);
  assert.deepEqual(calls, []);
  assert.match(plugin.notices.at(-1) ?? "", /Another AI setup action is already running/u);
  assert.match(
    readMethod("src/main.ts", "renderRetrievalDiagnostics"),
    /useSparseRetrieval\(\)\.then\(\(selected\)\s*=>\s*\{\s*if \(selected && sparse\.isConnected\)/su,
    "the warning button must claim success only when the persisted action returns true",
  );
});

test("invalid hosted credentials retain an actionable runtime state", async () => {
  const plugin = mainHarness();
  plugin.omdBridge = {
    hostedCredentialState: async () => {
      throw new Error("OpenAI rejected the developer API key. Replace it in Settings → OMD Home → AI answers, then check setup again.");
    },
  };

  await plugin.ensureHostedCredentialState("openai");

  assert.equal(plugin.hostedAiState.code, "credentials_invalid");
  assert.match(plugin.hostedAiState.detail, /rejected the developer API key/iu);
});

test("Open retrieval settings uses feature-detected navigation and falls back to manual guidance", async () => {
  const runtime = globalThis as typeof globalThis & { window?: unknown };
  const previousWindow = runtime.window;
  Object.defineProperty(runtime, "window", {
    value: { setTimeout },
    configurable: true,
    writable: true,
  });
  try {
    const plugin = mainHarness(["openRetrievalSettings"]);
    const calls: string[] = [];
    plugin.manifest = { id: "omd-home" };
    plugin.settingTab = { showRetrievalSettings: () => { calls.push("show-retrieval"); } };
    plugin.app = { setting: {
      open: () => { calls.push("open"); },
      openTabById: (id: string) => { calls.push(`tab:${id}`); },
    } };
    plugin.openRetrievalSettings();
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
    assert.deepEqual(calls, ["open", "tab:omd-home", "show-retrieval"]);

    const unavailable = mainHarness(["openRetrievalSettings"]);
    unavailable.app = { setting: { open: () => {} } };
    unavailable.settingTab = {};
    unavailable.openRetrievalSettings();
    assert.equal(unavailable.notices.at(-1), "Open settings → OMD Home → advanced AI controls → vault retrieval.");

    const failed = mainHarness(["openRetrievalSettings"]);
    failed.manifest = { id: "omd-home" };
    failed.settingTab = { showRetrievalSettings() {} };
    failed.app = { setting: {
      open: () => { throw new Error("Settings unavailable"); },
      openTabById() {},
    } };
    failed.openRetrievalSettings();
    assert.equal(failed.notices.at(-1), "Open settings → OMD Home → advanced AI controls → vault retrieval.");
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(runtime, "window");
    else Object.defineProperty(runtime, "window", { value: previousWindow, configurable: true, writable: true });
  }
});

test("hosted preview checks credentials before model selection or vault retrieval", async () => {
  const plugin = mainHarness(["previewCloudAnswer"], {
    DEFAULT_SETTINGS: { ollamaHost: "http://localhost:11434" },
    LocalAiError,
    normalizeLocalOllamaHost,
  });
  const calls: string[] = [];
  Object.assign(plugin.settings, { aiProvider: "openai", aiModel: "", ollamaHost: "http://localhost:11434" });
  plugin.currentLocalAiHost = () => null;
  plugin.qaRetrievalOptions = () => ({
    hybridRetrievalEnabled: true,
    embeddingModel: "bge-m3",
    semanticRerankEnabled: false,
  });
  plugin.prepareQaRetrieval = async () => {
    calls.push("retrieval");
    return { options: plugin.qaRetrievalOptions(), warning: null };
  };
  plugin.omdBridge = {
    hostedCredentialState: async () => {
      calls.push("credential");
      return { ...credential, source: "missing" };
    },
    previewAi: async () => {
      calls.push("preview");
      return {};
    },
  };

  await assert.rejects(
    plugin.previewCloudAnswer("What is in my vault?", "openai", ""),
    (error: unknown) => error instanceof LocalAiError && error.code === "credentials_missing",
  );
  assert.deepEqual(calls, ["credential"]);
});

test("hosted preview checks model selection only after credentials are available", async () => {
  const plugin = mainHarness(["previewCloudAnswer"], {
    DEFAULT_SETTINGS: { ollamaHost: "http://localhost:11434" },
    LocalAiError,
    normalizeLocalOllamaHost,
  });
  const calls: string[] = [];
  Object.assign(plugin.settings, { aiProvider: "openai", aiModel: "", ollamaHost: "http://localhost:11434" });
  plugin.currentLocalAiHost = () => null;
  plugin.qaRetrievalOptions = () => ({
    hybridRetrievalEnabled: true,
    embeddingModel: "bge-m3",
    semanticRerankEnabled: false,
  });
  plugin.prepareQaRetrieval = async () => {
    calls.push("retrieval");
    return { options: plugin.qaRetrievalOptions(), warning: null };
  };
  plugin.omdBridge = {
    hostedCredentialState: async () => {
      calls.push("credential");
      return credential;
    },
    previewAi: async () => {
      calls.push("preview");
      return {};
    },
  };

  await assert.rejects(
    plugin.previewCloudAnswer("What is in my vault?", "openai", ""),
    (error: unknown) => error instanceof LocalAiError && error.code === "selected_model_missing",
  );
  assert.deepEqual(calls, ["credential"]);
});

for (const provider of ["ollama", "openai"] as const) {
  test(`${provider} answer stops before consent or generation when local retrieval finds no evidence`, async () => {
    let consentOpened = false;
    let executed = false;
    const plugin = mainHarness(["askOmd"], {
      cloudAnswerPermissionEnabled: () => true,
      CloudAnswerConsentModal: class {
        constructor() { consentOpened = true; }
      },
    });
    Object.assign(plugin.settings, {
      aiProvider: provider,
      aiModel: provider === "ollama" ? "qwen3:4b-instruct" : "o3-mini",
      hybridRetrievalEnabled: false,
    });
    plugin.previewLocalAnswer = async () => ({ preview: { evidence: [] }, retrieval: {} });
    plugin.previewCloudAnswer = async () => ({
      provider: "openai",
      model: "o3-mini",
      endpoint: "http://localhost:11434",
      preview: { evidence: [] },
      retrieval: {},
    });
    plugin.executeLocalAnswer = async () => { executed = true; return {}; };
    plugin.executeCloudAnswer = async () => { executed = true; return {}; };
    const messages: string[] = [];
    const output = {
      hidden: true,
      empty() { messages.length = 0; },
      createDiv(options: { text?: string }) { messages.push(options.text ?? ""); return {}; },
    };

    await plugin.askOmd("Question without matching notes", output);

    assert.equal(consentOpened, false);
    assert.equal(executed, false);
    assert.deepEqual(messages, ["No relevant vault evidence was found. No model request was sent."]);
  });
}

for (const [warning, model, expectedButtons] of [
  ["hybrid_retrieval_model_not_installed", "bge-m3", ["Install model", "Switch to keyword search", "Open retrieval settings"]],
  ["hybrid_retrieval_daemon_unreachable", null, ["Switch to keyword search", "Open retrieval settings"]],
  ["hybrid_retrieval_model_unsupported", null, ["Switch to keyword search", "Open retrieval settings"]],
] as const) {
  test(`zero-evidence Ask preserves ${warning} recovery actions`, async () => {
    const plugin = mainHarness(["askOmd"]);
    Object.assign(plugin.settings, {
      aiProvider: "ollama",
      aiModel: "qwen3:4b-instruct",
      hybridRetrievalEnabled: true,
    });
    plugin.previewLocalAnswer = async () => ({
      preview: { evidence: [], warnings: [warning] },
      retrieval: { hybridRetrievalEnabled: false },
      embeddingFallbackModel: model,
    });
    plugin.executeLocalAnswer = async () => assert.fail("No model request may run without evidence");

    const texts: string[] = [];
    const buttons: string[] = [];
    const element = (): Record<string, any> => ({
      isConnected: true,
      createDiv(options: { text?: string } = {}) {
        if (options.text) texts.push(options.text);
        return element();
      },
      createSpan(options: { text?: string } = {}) {
        if (options.text) texts.push(options.text);
        return element();
      },
      createEl(_tag: string, options: { text?: string } = {}) {
        if (options.text) buttons.push(options.text);
        return { isConnected: true, disabled: false, addEventListener() {} };
      },
    });
    const output = Object.assign(element(), {
      hidden: true,
      empty() {
        texts.length = 0;
        buttons.length = 0;
      },
    });

    await plugin.askOmd("Question without matching notes", output);

    assert.match(texts.join(" "), /No relevant vault evidence was found/u);
    assert.match(texts.join(" "), warning === "hybrid_retrieval_model_not_installed"
      ? /not installed in Ollama/u
      : warning === "hybrid_retrieval_daemon_unreachable"
        ? /could not be reached/u
        : /does not support embeddings/u);
    assert.deepEqual(buttons, expectedButtons);
  });
}

for (const [code, warning] of [
  ["selected_model_missing", "hybrid_retrieval_model_not_installed"],
  ["daemon_unreachable", "hybrid_retrieval_daemon_unreachable"],
  ["selected_model_incompatible", "hybrid_retrieval_model_unsupported"],
] as const) {
  test(`hybrid retrieval classifies ${code} before falling back to sparse`, async () => {
    const plugin = loadMethods("src/main.ts", ["prepareQaRetrieval"], {
      LocalAiError,
      normalizeLocalOllamaHost,
    });
    plugin.settings = { ollamaHost: "http://localhost:11434" };
    plugin.qaRetrievalOptions = () => ({
      hybridRetrievalEnabled: true,
      embeddingModel: "bge-m3",
      embeddingModelRevision: "sha256:saved",
      semanticRerankEnabled: true,
    });
    plugin.ollamaLocalClient = {
      status: async () => { throw new LocalAiError(code, `Injected ${code}`); },
    };

    const prepared = await plugin.prepareQaRetrieval();
    assert.equal(prepared.warning, warning);
    assert.deepEqual(prepared.options, {
      hybridRetrievalEnabled: false,
      embeddingModel: "bge-m3",
      embeddingModelRevision: undefined,
      semanticRerankEnabled: false,
    });
  });
}

for (const [stage, injectedCode] of [
  ["catalog", "provider_catalog_unavailable"],
  ["model inspection", "model_unavailable"],
] as const) {
  test(`hybrid retrieval reports a setup-check failure when reachable Ollama ${stage} fails`, async () => {
    const plugin = loadMethods("src/main.ts", ["prepareQaRetrieval"], {
      LocalAiError,
      buildModelEntry,
      deriveLocalAiDaemonCode,
      describeDaemonReadiness,
      localModelNamesMatch,
      mergeInspectedModelEntry,
      modelIsCloudBacked,
      modelSupportsEmbedding,
      normalizeLocalOllamaHost,
    });
    plugin.settings = { ollamaHost: "http://localhost:11434" };
    plugin.qaRetrievalOptions = () => ({
      hybridRetrievalEnabled: true,
      embeddingModel: "bge-m3",
      embeddingModelRevision: "sha256:saved",
      semanticRerankEnabled: true,
    });
    plugin.ollamaLocalClient = {
      status: async () => ({ cloud: { disabled: true } }),
      tags: async () => {
        if (stage === "catalog") throw new LocalAiError(injectedCode, `Injected ${injectedCode}`);
        return [buildModelEntry({ name: "bge-m3", capabilities: ["embedding"] })];
      },
    };
    plugin.safeShowModel = async () => {
      throw new LocalAiError(injectedCode, `Injected ${injectedCode}`);
    };

    const prepared = await plugin.prepareQaRetrieval();
    assert.equal(prepared.warning, "hybrid_retrieval_check_failed");
    assert.equal(prepared.options.hybridRetrievalEnabled, false);
    assert.equal(prepared.options.semanticRerankEnabled, false);
  });
}

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

test("hosted setup rejects an unexpected provider destination before checking a model", async () => {
  const plugin = mainHarness([], { LocalAiError });
  let modelChecks = 0;
  Object.assign(plugin.settings, {
    aiProvider: "openai",
    aiModel: "test-model",
    aiModels: { openai: "test-model" },
  });
  plugin.omdBridge = {
    discoverProviderModels: async () => ({
      models: ["test-model"],
      credential,
      destinationDomain: "unexpected.example",
    }),
    checkProviderModel: async () => {
      modelChecks += 1;
      throw new Error("The model check must not run after a destination mismatch");
    },
  };

  assert.equal(await plugin.checkHostedAiConnection(), false);
  assert.equal(modelChecks, 0);
  assert.equal(plugin.hostedAiState.code, "provider_destination_mismatch");
  assert.match(plugin.hostedAiState.detail, /unexpected request destination/iu);
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

test("starting a hosted credential mutation aborts an active cloud preview before consent or provider execution", async () => {
  const previewEntered = deferred<void>();
  let consentOpened = false;
  let executeCalls = 0;
  const plugin = mainHarness(["askOmd", "previewCloudAnswer", "executeCloudAnswer"], {
    DEFAULT_SETTINGS: { ollamaHost: "http://localhost:11434" },
    cloudAnswerPermissionEnabled: () => true,
    normalizeLocalOllamaHost,
    CloudAnswerConsentModal: class {
      constructor() { consentOpened = true; }
    },
  });
  Object.assign(plugin.settings, {
    aiProvider: "openai",
    aiModel: "o3-mini",
    aiModels: { openai: "o3-mini" },
    hybridRetrievalEnabled: false,
    ollamaHost: "http://localhost:11434",
  });
  plugin.currentLocalAiHost = () => null;
  plugin.qaRetrievalOptions = () => ({ hybridRetrievalEnabled: false });
  plugin.prepareQaRetrieval = async () => ({
    options: { hybridRetrievalEnabled: false },
    warning: null,
    warningModel: null,
  });
  plugin.omdBridge = {
    hostedCredentialState: async () => credential,
    previewAi: async (
      _vault: string,
      _query: string,
      _provider: string,
      _model: string,
      _endpoint: string,
      _retrieval: unknown,
      signal: AbortSignal,
    ) => {
      previewEntered.resolve();
      return await new Promise((_resolve, reject) => signal.addEventListener(
        "abort",
        () => reject(new DOMException("Credential changed", "AbortError")),
        { once: true },
      ));
    },
    executeAi: async () => {
      executeCalls += 1;
      return {};
    },
  };
  plugin.vaultPath = () => "/test-vault";
  const output = { hidden: false, empty() {}, createDiv() { return {}; } };

  const asking = plugin.askOmd("Summarise the note", output);
  await previewEntered.promise;
  plugin.beginHostedCredentialMutation();
  await asking;

  assert.equal(consentOpened, false);
  assert.equal(executeCalls, 0);
  assert.deepEqual(plugin.issues, []);
});

test("cloud provider execution cannot start while a hosted credential mutation is pending", async () => {
  let executeCalls = 0;
  const plugin = mainHarness(["executeCloudAnswer"]);
  plugin.hostedCredentialMutation = Symbol("replacing-key");
  plugin.omdBridge = {
    executeAi: async () => {
      executeCalls += 1;
      return {};
    },
  };
  plugin.vaultPath = () => "/test-vault";

  await assert.rejects(
    plugin.executeCloudAnswer("Question", {
      provider: "openai",
      model: "o3-mini",
      endpoint: "http://localhost:11434",
      preview: { consent_grant: "grant", warnings: [] },
      retrieval: { hybridRetrievalEnabled: false },
      embeddingFallbackModel: null,
    }),
    { name: "AbortError" },
  );
  assert.equal(executeCalls, 0);
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
      requireRecognitionCapability: async () => ({ protocol_version: 1 }),
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

test("automatic setup falls back to an enrich-only OMD when no recognition-capable candidate exists", async () => {
  const legacy = "/legacy/bin/omd";
  let discoveryCalls = 0;
  const plugin = loadMethods("src/main.ts", ["runOmdCapabilityCheck"], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
    ) => {
      discoveryCalls += 1;
      await validate(legacy);
      return { executable: legacy, mode: "automatic" };
    },
    process,
    omdReadyMessage: () => "Ready",
    isEnrichmentError: () => false,
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd" },
    omdCapabilityGeneration: 1,
    usesAutomaticOmdDiscovery: () => true,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireRecognitionCapability: async () => { throw new Error("Recognition options unavailable"); },
      requireEnrichNote: async () => ({ enrich_note: { supported: true, schema_versions: [1] } }),
    },
  });

  assert.equal(await plugin.runOmdCapabilityCheck(1), true);
  assert.equal(discoveryCalls, 2);
  assert.equal(plugin.enrichmentCapability.resolvedExecutable, legacy);
});

test("custom setup accepts an enrich-only OMD without applying automatic discovery preferences", async () => {
  const custom = "/custom/bin/omd";
  let recognitionProbeCalls = 0;
  const plugin = loadMethods("src/main.ts", ["runOmdCapabilityCheck"], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
    ) => {
      await validate(custom);
      return { executable: custom, mode: "custom" };
    },
    process,
    omdReadyMessage: () => "Ready",
  });
  Object.assign(plugin, {
    settings: { omdExecutable: custom },
    omdCapabilityGeneration: 1,
    usesAutomaticOmdDiscovery: () => false,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireRecognitionCapability: async () => {
        recognitionProbeCalls += 1;
        throw new Error("Recognition options unavailable");
      },
      requireEnrichNote: async () => ({ enrich_note: { supported: true, schema_versions: [1] } }),
    },
  });

  assert.equal(await plugin.runOmdCapabilityCheck(1), true);
  assert.equal(recognitionProbeCalls, 0);
  assert.equal(plugin.enrichmentCapability.resolvedExecutable, custom);
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
      requireRecognitionCapability: async (executable: string) => {
        if (executable === legacy) throw new Error("Legacy OMD has no enrich-note capability");
        return { protocol_version: 1 };
      },
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
      requireRecognitionCapability: async (executable: string) => {
        if (executable === legacy) throw new Error("Legacy OMD has no enrich-note capability");
        return { protocol_version: 1 };
      },
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

test("Ollama Cloud setup canonicalizes a saved alias to the catalog model", async () => {
  const host = "http://localhost:11434";
  const catalogModel = buildModelEntry({
    name: "cloud-alias:latest",
    capabilities: ["completion"],
    remoteModel: "gpt-oss:20b",
    remoteHost: "https://ollama.com",
  });
  const plugin = mainHarness(["checkOllamaCloudConnection"], {
    buildConnectionSummary,
    buildModelEntry,
    localModelNamesMatch,
    mergeInspectedModelEntry,
    modelIsVerifiedOllamaCloud,
    normalizeLocalOllamaHost,
  });
  Object.assign(plugin, {
    settings: {
      aiProvider: "ollama-cloud",
      aiModel: "cloud-alias",
      aiModels: { "ollama-cloud": "cloud-alias" },
      ollamaHost: host,
    },
    localAiSummaries: new Map(),
    localAiFailure: null,
    localAiActionToken: 1,
    canStartAiSetupAction: () => true,
    beginLocalAiAction: () => 1,
    finishLocalAiAction() {},
    syncLocalAiState() {},
    ollamaLocalClient: {
      version: async () => ({ version: "0.33.3" }),
      status: async () => ({ cloud: { disabled: false } }),
      tags: async () => [catalogModel],
      show: async (_receivedHost: string, receivedModel: string) => {
        assert.equal(receivedModel, "cloud-alias");
        return {
          name: receivedModel,
          capabilities: ["completion"],
          remoteModel: "gpt-oss:20b",
          remoteHost: "https://ollama.com",
        };
      },
    },
  });

  assert.equal(await plugin.checkOllamaCloudConnection(), true);
  const models = plugin.localAiSummaries.get(host).models;
  assert.deepEqual(models.map((model: LocalAiModelInfo) => model.name), ["cloud-alias:latest"]);
  assert.equal(models[0].remoteModel, "gpt-oss:20b");
});

test("Ollama Cloud setup publishes a fresh catalog when the saved model was removed", async () => {
  const host = "http://localhost:11434";
  const replacement = buildModelEntry({
    name: "cloud-b:latest",
    capabilities: ["completion"],
    remoteModel: "gpt-oss:120b",
    remoteHost: "https://ollama.com",
  });
  const plugin = mainHarness(["checkOllamaCloudConnection"], {
    buildConnectionSummary,
    buildModelEntry,
    localModelNamesMatch,
    mergeInspectedModelEntry,
    modelIsVerifiedOllamaCloud,
    normalizeLocalOllamaHost,
  });
  Object.assign(plugin, {
    settings: {
      aiProvider: "ollama-cloud",
      aiModel: "cloud-a:latest",
      aiModels: { "ollama-cloud": "cloud-a:latest" },
      ollamaHost: host,
    },
    localAiSummaries: new Map(),
    localAiFailure: null,
    localAiActionToken: 1,
    localAiState: { activeAction: "check-connection" },
    canStartAiSetupAction: () => true,
    beginLocalAiAction: () => 1,
    finishLocalAiAction() {},
    syncLocalAiState() {},
    setLocalAiFailure() {},
    ollamaLocalClient: {
      version: async () => ({ version: "0.33.3" }),
      status: async () => ({ cloud: { disabled: false } }),
      tags: async () => [replacement],
      show: async () => {
        throw new LocalAiError("selected_model_missing", "cloud-a:latest is no longer installed.");
      },
    },
  });

  assert.equal(await plugin.checkOllamaCloudConnection(), false);
  assert.deepEqual(
    plugin.localAiSummaries.get(host).models.map((model: LocalAiModelInfo) => model.name),
    ["cloud-b:latest"],
  );
  assert.match(plugin.feedback.at(-1) ?? "", /cloud-a:latest is no longer installed/u);
});

for (const failure of ["no-cloud-model", "incompatible-cloud-model", "cloud-model-inspection-unavailable"] as const) {
  test(`Ollama Cloud ${failure} feedback does not overwrite healthy local daemon readiness`, async () => {
    const host = "http://localhost:11434";
    const healthy = buildConnectionSummary({
      host,
      checkedAt: 1,
      version: "0.33.3",
      daemonCode: "ready",
      daemonDetail: "Ollama is reachable.",
      models: [buildModelEntry({ name: "qwen3:4b", capabilities: ["completion"] })],
      modelChecks: {},
    });
    const verifiedCloudModel = buildModelEntry({
      name: "gpt-oss:20b-cloud",
      capabilities: ["completion"],
      remoteModel: "gpt-oss:20b",
      remoteHost: "https://ollama.com",
    });
    const plugin = mainHarness(["checkOllamaCloudConnection"], {
      buildConnectionSummary,
      buildModelEntry,
      localModelNamesMatch,
      mergeInspectedModelEntry,
      modelIsVerifiedOllamaCloud,
      normalizeLocalOllamaHost,
    });
    Object.assign(plugin, {
      settings: {
        aiProvider: "ollama-cloud",
        aiModel: failure === "no-cloud-model"
          ? ""
          : failure === "cloud-model-inspection-unavailable" ? "gpt-oss:20b-cloud" : "local-not-cloud:latest",
        aiModels: {
          "ollama-cloud": failure === "no-cloud-model"
            ? ""
            : failure === "cloud-model-inspection-unavailable" ? "gpt-oss:20b-cloud" : "local-not-cloud:latest",
        },
        ollamaHost: host,
      },
      localAiSummaries: new Map([[host, healthy]]),
      localAiFailure: null,
      canStartAiSetupAction: () => true,
      beginLocalAiAction: () => 1,
      finishLocalAiAction() {},
      syncLocalAiState() {},
      ollamaLocalClient: {
        version: async () => ({ version: "0.33.3" }),
        status: async () => ({ cloud: { disabled: false } }),
        tags: async () => failure === "no-cloud-model" ? [] : [verifiedCloudModel],
        show: async () => {
          if (failure === "cloud-model-inspection-unavailable") {
            throw new LocalAiError("model_unavailable", "The selected Ollama Cloud model could not be inspected.");
          }
          return {
            name: "local-not-cloud:latest",
            capabilities: ["completion"],
          };
        },
      },
    });
    let localFailureWrites = 0;
    plugin.setLocalAiFailure = () => { localFailureWrites += 1; };

    assert.equal(await plugin.checkOllamaCloudConnection(), false);
    assert.equal(localFailureWrites, 0);
    assert.equal(plugin.localAiSummaries.get(host), healthy);
    assert.equal(plugin.localAiFailure, null);
    assert.match(plugin.feedback.at(-1) ?? "", /Ollama Cloud setup failed/u);
    assert.equal(plugin.issues.length, 1);
  });
}

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
  let setupChecks = 0;
  tab.plugin = {
    aiSetupBusy: () => false,
    hostedAiState: null,
    localAiState: { activeAction: "" },
    saveHostedApiKey: async (value: string) => { saved.push(value); return confirmed; },
    checkHostedAiConnection: async () => { setupChecks += 1; return true; },
    settings: {},
  };
  tab.hostedCredentialSetting(container, "openai");
  assert.equal(inputs[0].inputEl.type, "password");
  inputs[0].setValue("sk-actual-typed-secret").change("sk-actual-typed-secret");
  await buttons[0].click();
  assert.equal(inputs.at(-1)?.value, "sk-actual-typed-secret");
  assert.equal(setupChecks, 0);
  confirmed = true;
  await buttons[0].click();
  assert.deepEqual(saved, ["sk-actual-typed-secret", "sk-actual-typed-secret"]);
  assert.equal(setupChecks, 1);
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
    previewCloudAnswer: async () => ({
      provider: "openai",
      retrieval: {},
      preview: {
        preview: {},
        evidence: [{ path: "Note.md", title: "Note", evidence: "Approved excerpt", score: 1 }],
      },
    }),
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
