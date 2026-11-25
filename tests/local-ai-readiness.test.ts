import assert from "node:assert/strict";
import test from "node:test";
import { modelIsCloudBacked } from "../src/ai-provider.ts";
import {
  aggregateLocalAiState,
  buildConnectionSummary,
  buildModelEntry,
  buildModelSelectorState,
  classifyEmbeddingSetup,
  createWorkflowSnapshot,
  deriveLocalAiDaemonCode,
  deriveLocalAiModelCode,
  describeLocalCompletionCatalog,
  describeModelReadiness,
  embeddingModelPullCommand,
  localModelNamesMatch,
  localWritingModelIsSelectable,
  localWritingModelOptionLabel,
  mergeInspectedModelEntry,
  modelIsKnownAnswerBudgetIncompatible,
  modelSupportsCompletion,
  modelSupportsEmbedding,
  normalizeLocalOllamaHost,
  oneClickInstallableEmbeddingModel,
  providerMode,
  resolveEmbeddingModelRevision,
  snapshotsMatch,
} from "../src/local-ai-readiness.ts";
import { LocalAiError } from "../src/ollama-local-types.ts";
import type { OmdHomeSettings } from "../src/settings.ts";

const DEFAULT_SETTINGS: OmdHomeSettings = {
  openOnLaunch: true,
  omdExecutable: "omd",
  pythonExecutable: "",
  pythonBridgePath: "",
  eventKitHelperPath: "",
  selectedCalendarIds: [],
  defaultExternalCalendarId: "",
  aiProvider: "ollama",
  aiModel: "qwen3:4b-instruct",
  aiModels: {
    ollama: "qwen3:4b-instruct",
    "ollama-cloud": "",
    openai: "",
    anthropic: "",
    deepseek: "",
  },
  allowedCloudAnswerProviders: [],
  hybridRetrievalEnabled: true,
  embeddingModel: "bge-m3",
  semanticRerankEnabled: false,
  localWritingModel: "qwen3:4b-instruct",
  ollamaHost: "http://localhost:11434",
  capturePolish: false,
  captureSuggestLinksAndTags: true,
  captureOcrLanguage: "eng",
  captureAsrLanguage: "auto-detect",
  douyinCookiesPath: "",
  xhsCookiesPath: "",
  pinnedNotes: [],
  welcomeGuideShown: false,
};

const localModel = buildModelEntry({ name: "qwen3:4b-instruct", capabilities: ["completion", "thinking", "tools"] });
const embedModel = buildModelEntry({ name: "nomic-embed", capabilities: ["embedding"] });
const remoteModel = buildModelEntry({ name: "cloudy", capabilities: ["completion"], remoteModel: "cloudy", remoteHost: "https://example.com" });
const boundedAnswerIncompatibleModel = buildModelEntry({ name: "qwen3:4b", capabilities: ["completion", "thinking", "tools"] });

test("normalizeLocalOllamaHost enforces the loopback host contract", () => {
  for (const [input, expected] of [
    ["http://localhost:11434", "http://localhost:11434"],
    [" http://localhost:9999 ", "http://localhost:9999"],
    ["http://127.0.0.1:00080", "http://127.0.0.1:80"],
    ["http://[::1]:65535", "http://[::1]:65535"],
    ["http://[::1]:1", "http://[::1]:1"],
  ]) {
    assert.equal(normalizeLocalOllamaHost(input!), expected, input);
  }
  for (const host of [
    "http://localhost", "http://localhost:", "http://localhost:0", "http://localhost:65536",
    "http://localhost:+80", "http://localhost:0x50", "http://localhost:８０", "https://localhost:80",
    "http://localhost:80/", "http://localhost:80/.", "http://localhost:80/API", "http://localhost:80?",
    "http://localhost:80#", "http://localhost:80?q=yes", "http://localhost:80#fragment",
    "http://localhost:80\\evil", "http://@localhost:80", "http://user:password@localhost:80",
    "http://localhost:80@example.com:80", "http://localhost.example.com:80", "http://sub.localhost:80",
    "http://local\thost:80", "http://%6cocalhost:80", "http://localhost.:80", "http://0.0.0.0:80",
    "http://127.1:80", "http://127.0.0.2:80", "http://2130706433:80", "http://0177.0.0.1:80",
    "http://192.168.0.2:80", "http://[0:0:0:0:0:0:0:1]:80", "http://[::ffff:127.0.0.1]:80",
  ]) {
    assert.throws(
      () => normalizeLocalOllamaHost(host),
      (error: unknown) => error instanceof LocalAiError && error.code === "invalid_host",
      host,
    );
  }
});

const host = "http://localhost:11434";
const probeResult = { host, model: "bge-m3", checkedAt: 1, detail: "test result" };

test("embedding pull suggestions contain only a conservative local model identifier", () => {
  for (const model of ["bge-m3", "all-minilm:22m", "author/Embed_1:v1.2"]) {
    assert.equal(embeddingModelPullCommand(` ${model} `, host, false), `OLLAMA_HOST='${host}' ollama pull ${model}`);
  }
  assert.equal(embeddingModelPullCommand("author/custom", "http://[::1]:12000", true),
    'cmd.exe /d /c "set OLLAMA_HOST=http://[::1]:12000&& ollama pull author/custom"');
  assert.equal(embeddingModelPullCommand("bge-m3", "http://localhost:22/&& echo", false), null);
  for (const model of [
    "", "-help", "--help", "author/-model", "author/../model", "x:latest:again", "x:",
    "host.test/author/model", "https://example.com/m", "${MODEL}", "$(touch x)", "x`whoami`",
    "x;echo y", "x && y", "a\nb", "a\tb", "x#y", "x*y", "a\\b", "Kelvin", "x:cloud", "a".repeat(257),
  ]) {
    assert.equal(embeddingModelPullCommand(model, host, true), null, model);
  }
});

test("embedding setup distinguishes the daemon and model first-use states", () => {
  const model = "bge-m3";
  const embedding = buildModelEntry({ name: "bge-m3:latest", digest: "sha256:tested", capabilities: ["embedding"] });
  assert.equal(classifyEmbeddingSetup({ host, model }).action, "check-setup");
  assert.equal(classifyEmbeddingSetup({ host, model, connectionCode: "daemon_unreachable" }).action, "start-ollama");
  assert.match(classifyEmbeddingSetup({ host, model, connectionCode: "daemon_unreachable" }).detail, /install.*open|open.*install/iu);
  const empty = classifyEmbeddingSetup({ host, model, models: [] });
  assert.equal(empty.kind, "no-local-models");
  assert.equal(empty.action, "install-model");
  assert.equal(empty.installableModel, "bge-m3");
  assert.equal(classifyEmbeddingSetup({ host, model, connectionCode: "no_models_installed", localAnswer: true }).needsTextModel, true);
  const missing = classifyEmbeddingSetup({ host, model: "all-minilm:22m", models: [localModel] });
  assert.equal(missing.kind, "model-missing");
  assert.equal(missing.action, "copy-pull-command");
  assert.equal(missing.pullCommand, `OLLAMA_HOST='${host}' ollama pull all-minilm:22m`);
  assert.equal(missing.installableModel, null);
  const unsafe = classifyEmbeddingSetup({ host, model: "x;echo y", models: [localModel] });
  assert.equal(unsafe.action, "refresh-models");
  assert.equal(unsafe.pullCommand, null);
  const embeddingOnly = classifyEmbeddingSetup({ host, model, models: [embedding], localAnswer: true });
  assert.equal(embeddingOnly.kind, "embedding-only");
  assert.equal(embeddingOnly.needsTextModel, true);
  assert.equal(embeddingOnly.action, "test-embeddings");
  assert.equal(classifyEmbeddingSetup({ host, model, models: [embedding] }).needsTextModel, false);
  const ready = classifyEmbeddingSetup({ host, model, models: [embedding, localModel], localAnswer: true });
  assert.equal(ready.kind, "ready");
  assert.equal(ready.needsTextModel, false);
  const verified = classifyEmbeddingSetup({ host, model, models: [embedding], probe: { ...probeResult, revision: "sha256:tested", code: "ready" } });
  assert.equal(verified.kind, "verified");
  assert.match(verified.detail, /bge-m3/u);
  assert.equal(classifyEmbeddingSetup({ host, model, models: [embedding], probe: { ...probeResult, code: "ready" } }).kind, "ready");
  assert.equal(classifyEmbeddingSetup({ host, model, models: [embedding], probe: { ...probeResult, revision: "sha256:old", code: "ready" } }).kind, "ready");
});

test("embedding verification is scoped to the selected endpoint and model", () => {
  const probe = { ...probeResult, code: "ready" as const, vectorCount: 2, dimensions: 1024 };
  const model = buildModelEntry({ name: "bge-m3:latest", digest: "sha256:tested", capabilities: ["embedding"] });
  const input = { host, model: model.name, models: [model], probe: { ...probe, revision: "sha256:tested" } };
  assert.match(classifyEmbeddingSetup(input).detail, /2 vectors × 1024 dimensions/u);
  assert.equal(classifyEmbeddingSetup({ ...input, host: "http://localhost:12000" }).kind, "ready");
  assert.equal(classifyEmbeddingSetup({ ...input, probe: { ...probe, model: "custom" } }).kind, "ready");
});

test("embedding setup keeps failure reasons and next actions distinct", () => {
  const model = "bge-m3";
  const embedded = buildModelEntry({ name: model, capabilities: ["embedding"] });
  assert.equal(classifyEmbeddingSetup({ host, model, connectionCode: "invalid_host" }).kind, "connection-failed");
  assert.equal(classifyEmbeddingSetup({ host, model, connectionCode: "status_unavailable" }).kind, "connection-failed");
  assert.equal(classifyEmbeddingSetup({ host, model, probe: { ...probeResult, code: "selected_model_missing" } }).kind, "model-missing");
  assert.equal(classifyEmbeddingSetup({ host, model, probe: { ...probeResult, code: "selected_model_incompatible" }, models: [embedded] }).kind, "model-incompatible");
  assert.equal(classifyEmbeddingSetup({ host, model, probe: { ...probeResult, code: "selected_model_remote_blocked" } }).kind, "model-cloud-backed");
  assert.equal(classifyEmbeddingSetup({ host, model: "custom:cloud", models: [localModel] }).pullCommand, null);
  assert.equal(classifyEmbeddingSetup({ host, model, probe: { ...probeResult, code: "smoke_failed" } }).kind, "test-failed");
  assert.equal(classifyEmbeddingSetup({ host, model: "qwen3:4b-instruct", models: [localModel] }).kind, "model-incompatible");
  assert.equal(classifyEmbeddingSetup({ host, model: "author/custom", models: [buildModelEntry({ name: "author/custom" })] }).action, "test-embeddings");
});

test("providerMode separates local Ollama from cloud answer providers", () => {
  assert.equal(providerMode("ollama"), "ollama");
  assert.equal(providerMode("openai"), "cloud");
  assert.equal(providerMode("ollama-cloud"), "cloud");
});

test("buildModelSelectorState keeps installed, custom, and stale selections distinct", () => {
  assert.deepEqual(buildModelSelectorState("qwen3:4b-instruct", [localModel]), {
    optionValue: "qwen3:4b-instruct",
    useCustom: false,
    stale: false,
    customValue: "qwen3:4b-instruct",
  });
  assert.equal(buildModelSelectorState("custom-model", [localModel]).stale, true);
  assert.equal(buildModelSelectorState("", [localModel]).useCustom, true);
});

test("model helpers classify completion support and remote metadata", () => {
  assert.equal(modelSupportsCompletion(localModel), true);
  assert.equal(modelSupportsCompletion(embedModel), false);
  assert.equal(modelSupportsEmbedding(embedModel), true);
  assert.equal(modelSupportsEmbedding(localModel), false);
  assert.equal(modelIsKnownAnswerBudgetIncompatible(boundedAnswerIncompatibleModel), true);
  assert.equal(modelSupportsCompletion(boundedAnswerIncompatibleModel), true);
  assert.equal(boundedAnswerIncompatibleModel.supportsCompletion, true);
  assert.equal(modelIsCloudBacked(remoteModel), true);
});

test("thinking-capable completion models remain eligible for text answers", () => {
  assert.equal(modelIsKnownAnswerBudgetIncompatible(localModel), false);
  assert.equal(modelSupportsCompletion(localModel), true);
  assert.equal(localWritingModelIsSelectable(localModel), true);
  assert.equal(localWritingModelOptionLabel(localModel), "qwen3:4b-instruct");
  assert.equal(deriveLocalAiModelCode(localModel), "ready");
  assert.equal(describeModelReadiness(localModel.name, localModel), "qwen3:4b-instruct is available locally for text completion.");
});

test("explicit cloud ids stay out of every local-only model path when metadata is absent", () => {
  const metadataAbsentCloudCompletion = buildModelEntry({
    name: "gpt-oss:20b-cloud",
    capabilities: ["completion"],
  });
  const metadataAbsentCloudEmbedding = buildModelEntry({
    name: "bge-m3-cloud",
    capabilities: ["embedding"],
  });

  assert.equal(modelIsCloudBacked(metadataAbsentCloudCompletion), true);
  assert.equal(localWritingModelIsSelectable(metadataAbsentCloudCompletion), false);
  assert.equal(deriveLocalAiModelCode(metadataAbsentCloudCompletion), "selected_model_remote_blocked");
  assert.match(localWritingModelOptionLabel(metadataAbsentCloudCompletion), /cloud-backed/u);
  assert.equal(modelIsCloudBacked(metadataAbsentCloudEmbedding), true);
  assert.match(
    describeLocalCompletionCatalog([metadataAbsentCloudCompletion], true),
    /0 of 0 local models available for text/u,
  );
});

test("model inspection preserves catalog digest and remote metadata", () => {
  const catalog = buildModelEntry({
    name: "bge-m3",
    digest: "sha256:catalog",
    capabilities: ["embedding"],
    remoteModel: "remote-bge",
    remoteHost: "https://example.com",
  });
  const inspected = buildModelEntry({ name: "bge-m3", capabilities: ["embedding"] });

  const merged = mergeInspectedModelEntry(catalog, inspected);

  assert.equal(merged.digest, "sha256:catalog");
  assert.equal(merged.remoteModel, "remote-bge");
  assert.equal(merged.remoteHost, "https://example.com");
});

test("embedding model revision resolves from the installed catalog", () => {
  const models = [
    buildModelEntry({ name: "bge-m3", digest: " sha256:current ", capabilities: ["embedding"] }),
  ];

  assert.equal(resolveEmbeddingModelRevision(" bge-m3 ", models), "sha256:current");
  assert.equal(resolveEmbeddingModelRevision("missing", models), undefined);
  assert.equal(resolveEmbeddingModelRevision("", models), undefined);
});

test("bge-m3 latest aliases resolve consistently for catalog matching and one-click install", () => {
  const installed = buildModelEntry({
    name: "bge-m3:latest",
    digest: "sha256:latest",
    capabilities: [],
  });

  assert.equal(localModelNamesMatch(" BGE-M3 ", installed.name), true);
  assert.equal(modelSupportsEmbedding(installed), true);
  assert.equal(modelSupportsEmbedding({ ...installed, capabilities: ["completion"] }), false);
  assert.equal(resolveEmbeddingModelRevision("BGE-M3", [installed]), "sha256:latest");
  assert.equal(oneClickInstallableEmbeddingModel(" bge-m3 "), "bge-m3");
  assert.equal(oneClickInstallableEmbeddingModel("BGE-M3:latest"), "bge-m3");
});

test("createWorkflowSnapshot and snapshotsMatch bind the workflow tuple", () => {
  const qa = createWorkflowSnapshot("qa", DEFAULT_SETTINGS);
  const enrichment = createWorkflowSnapshot("enrichment", DEFAULT_SETTINGS);
  assert.equal(qa.workflow, "qa");
  assert.equal(enrichment.model, DEFAULT_SETTINGS.localWritingModel);
  assert.equal(snapshotsMatch(qa, { ...qa }), true);
  assert.equal(snapshotsMatch(qa, { ...qa, model: "qwen3:4b" }), false);
});

test("aggregateLocalAiState surfaces partial readiness without blocking on daemon cloud availability", () => {
  const partial = buildConnectionSummary({
    host: "http://localhost:11434",
    checkedAt: 1,
    version: "0.32.5",
    daemonCode: "ready",
    daemonDetail: "ready",
    models: [localModel, embedModel, remoteModel],
    modelChecks: {
      [DEFAULT_SETTINGS.aiModel]: {
        model: DEFAULT_SETTINGS.aiModel,
        checkedAt: 1,
        code: "ready",
        detail: "ready",
        supportsCompletion: true,
      },
      [embedModel.name]: {
        model: embedModel.name,
        checkedAt: 1,
        code: "selected_model_incompatible",
        detail: "no completion",
        supportsCompletion: false,
      },
    },
  });
  const partialState = aggregateLocalAiState({
    ...DEFAULT_SETTINGS,
    localWritingModel: embedModel.name,
  }, partial, [localModel, embedModel], "");
  assert.equal(partialState.daemonCode, "partial");
  assert.equal(partialState.connectionCode, "ready");
  assert.equal(partialState.workflows.enrichment.code, "selected_model_incompatible");
});

test("aggregateLocalAiState marks hosted QA separately without hiding local workflows", () => {
  const state = aggregateLocalAiState({
    ...DEFAULT_SETTINGS,
    aiProvider: "deepseek",
  }, null, [localModel], "");
  assert.equal(state.providerMode, "cloud");
  assert.equal(state.workflows.qa.code, "cloud-provider");
  assert.equal(state.workflows.enrichment.code, "unchecked");
});

test("aggregateLocalAiState keeps local enrichment and capture readiness visible under a hosted answer provider", () => {
  const ready = buildConnectionSummary({
    host: "http://localhost:11434",
    checkedAt: 1,
    version: "0.32.5",
    daemonCode: "ready",
    daemonDetail: "ready",
    models: [localModel],
    modelChecks: {
      [DEFAULT_SETTINGS.localWritingModel]: {
        model: DEFAULT_SETTINGS.localWritingModel,
        checkedAt: 1,
        code: "ready",
        detail: "ready",
        supportsCompletion: true,
      },
      [DEFAULT_SETTINGS.localWritingModel]: {
        model: DEFAULT_SETTINGS.localWritingModel,
        checkedAt: 1,
        code: "ready",
        detail: "ready",
        supportsCompletion: true,
      },
    },
  });
  const state = aggregateLocalAiState({
    ...DEFAULT_SETTINGS,
    aiProvider: "openai",
    capturePolish: true,
  }, ready, [localModel], "");
  assert.equal(state.providerMode, "cloud");
  assert.equal(state.daemonCode, "ready");
  assert.equal(state.workflows.qa.code, "cloud-provider");
  assert.equal(state.workflows.enrichment.code, "ready");
  assert.equal(state.workflows.capture.code, "ready");
});

test("local readiness is independent of reported Ollama Cloud availability", () => {
  assert.equal(deriveLocalAiDaemonCode({ cloud: { disabled: true } }, [localModel]), "ready");
  assert.equal(deriveLocalAiDaemonCode({ cloud: { disabled: false } }, [localModel]), "ready");
  assert.equal(deriveLocalAiDaemonCode({ cloud: {} }, [localModel]), "ready");
  assert.equal(deriveLocalAiDaemonCode({ cloud: null }, [localModel]), "ready");
  assert.equal(deriveLocalAiDaemonCode({ cloud: { disabled: true } }, []), "no_models_installed");
});

test("model policy distinguishes local completion, incompatible, and remote-backed models", () => {
  assert.equal(deriveLocalAiModelCode(localModel), "ready");
  assert.equal(deriveLocalAiModelCode(embedModel), "selected_model_incompatible");
  assert.equal(deriveLocalAiModelCode(boundedAnswerIncompatibleModel), "selected_model_incompatible");
  assert.match(describeModelReadiness(boundedAnswerIncompatibleModel.name, boundedAnswerIncompatibleModel), /can generate text.+reliable answers in OMD Home/u);
  assert.equal(deriveLocalAiModelCode(remoteModel), "selected_model_remote_blocked");
});

test("local completion catalog keeps every downloaded model explainable without making unsafe models selectable", () => {
  const unknownLocalModel = buildModelEntry({ name: "future-text:latest" });
  const models = [localModel, boundedAnswerIncompatibleModel, embedModel, remoteModel, unknownLocalModel];

  assert.equal(localWritingModelIsSelectable(localModel), true);
  assert.equal(localWritingModelIsSelectable(unknownLocalModel), true);
  assert.equal(localWritingModelIsSelectable(boundedAnswerIncompatibleModel), false);
  assert.equal(localWritingModelIsSelectable(embedModel), false);
  assert.equal(localWritingModelIsSelectable(remoteModel), false);
  assert.equal(localWritingModelOptionLabel(boundedAnswerIncompatibleModel), "qwen3:4b (not supported for OMD Home answers)");
  assert.equal(localWritingModelOptionLabel(embedModel), "nomic-embed (embedding model; unavailable for text answers)");
  assert.equal(localWritingModelOptionLabel(unknownLocalModel), "future-text:latest (completion support unverified)");
  assert.equal(describeLocalCompletionCatalog(models, false), "");
  assert.equal(
    describeLocalCompletionCatalog(models, true),
    "2 of 4 local models available for text.",
  );
});

test("disabled capture snapshots preserve the invocation flag without requiring a model", () => {
  const settings = { ...DEFAULT_SETTINGS, localWritingModel: "" };
  assert.equal(createWorkflowSnapshot("capture", settings, false).enabled, false);
  assert.throws(
    () => createWorkflowSnapshot("capture", settings, true),
    (error: unknown) => error instanceof LocalAiError && error.code === "selected_model_missing",
  );
});

test("disabled capture snapshots do not require a valid Ollama host", () => {
  const settings = { ...DEFAULT_SETTINGS, ollamaHost: "http://localhost:9999", localWritingModel: "" };
  const snapshot = createWorkflowSnapshot("capture", settings, false);
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.host, "http://localhost:9999");
});
