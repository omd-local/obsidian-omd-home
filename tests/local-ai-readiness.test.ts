import assert from "node:assert/strict";
import test from "node:test";
import { modelIsCloudBacked } from "../src/ai-provider.ts";
import {
  aggregateLocalAiState,
  buildConnectionSummary,
  buildModelEntry,
  buildModelSelectorState,
  createWorkflowSnapshot,
  deriveLocalAiDaemonCode,
  deriveLocalAiModelCode,
  describeLocalCompletionCatalog,
  describeModelReadiness,
  localWritingModelIsSelectable,
  localWritingModelOptionLabel,
  mergeInspectedModelEntry,
  modelIsKnownThinkingOnly,
  modelSupportsCompletion,
  modelSupportsEmbedding,
  normalizeLocalOllamaHost,
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
  captureOcrLanguage: "",
  captureAsrLanguage: "inherit-adapter-default",
  pinnedNotes: [],
};

const localModel = buildModelEntry({ name: "qwen3:4b-instruct", capabilities: ["completion", "tools"] });
const embedModel = buildModelEntry({ name: "nomic-embed", capabilities: ["embedding"] });
const remoteModel = buildModelEntry({ name: "cloudy", capabilities: ["completion"], remoteModel: "cloudy", remoteHost: "https://example.com" });
const thinkingOnlyModel = buildModelEntry({ name: "qwen3:4b", capabilities: ["completion", "thinking", "tools"] });

test("normalizeLocalOllamaHost enforces the loopback host contract", () => {
  assert.equal(normalizeLocalOllamaHost("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(normalizeLocalOllamaHost("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
  assert.throws(
    () => normalizeLocalOllamaHost("http://localhost:9999"),
    (error: unknown) => error instanceof LocalAiError && error.code === "invalid_host",
  );
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
  assert.equal(modelIsKnownThinkingOnly(thinkingOnlyModel), true);
  assert.equal(modelSupportsCompletion(thinkingOnlyModel), false);
  assert.equal(modelIsCloudBacked(remoteModel), true);
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
    /0 local models found\. 0 can answer text questions\. 1 cloud-backed model is not shown/u,
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

test("daemon policy accepts only the exact cloud-disabled status shape", () => {
  assert.equal(deriveLocalAiDaemonCode({ cloud: { disabled: true } }, [localModel]), "ready");
  assert.equal(deriveLocalAiDaemonCode({ cloud: { disabled: false } }, [localModel]), "ready");
  assert.equal(deriveLocalAiDaemonCode({ cloud: {} }, [localModel]), "ready");
  assert.equal(deriveLocalAiDaemonCode({ cloud: null }, [localModel]), "ready");
  assert.equal(deriveLocalAiDaemonCode({ cloud: { disabled: true } }, []), "no_models_installed");
});

test("model policy distinguishes local completion, incompatible, and remote-backed models", () => {
  assert.equal(deriveLocalAiModelCode(localModel), "ready");
  assert.equal(deriveLocalAiModelCode(embedModel), "selected_model_incompatible");
  assert.equal(deriveLocalAiModelCode(thinkingOnlyModel), "selected_model_incompatible");
  assert.match(describeModelReadiness(thinkingOnlyModel.name, thinkingOnlyModel), /qwen3:4b-instruct/u);
  assert.equal(deriveLocalAiModelCode(remoteModel), "selected_model_remote_blocked");
});

test("local completion catalog keeps every downloaded model explainable without making unsafe models selectable", () => {
  const unknownLocalModel = buildModelEntry({ name: "future-text:latest" });
  const models = [localModel, thinkingOnlyModel, embedModel, remoteModel, unknownLocalModel];

  assert.equal(localWritingModelIsSelectable(localModel), true);
  assert.equal(localWritingModelIsSelectable(unknownLocalModel), true);
  assert.equal(localWritingModelIsSelectable(thinkingOnlyModel), false);
  assert.equal(localWritingModelIsSelectable(embedModel), false);
  assert.equal(localWritingModelIsSelectable(remoteModel), false);
  assert.equal(localWritingModelOptionLabel(thinkingOnlyModel), "qwen3:4b (thinking-only; unavailable for text answers)");
  assert.equal(localWritingModelOptionLabel(embedModel), "nomic-embed (embedding model; unavailable for text answers)");
  assert.equal(localWritingModelOptionLabel(unknownLocalModel), "future-text:latest (completion support unverified)");
  assert.equal(describeLocalCompletionCatalog(models, false), "");
  assert.equal(
    describeLocalCompletionCatalog(models, true),
    "4 local models found. 2 can answer text questions. qwen3:4b and nomic-embed are shown but unavailable for text answers. 1 cloud-backed model is not shown in this local list.",
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
