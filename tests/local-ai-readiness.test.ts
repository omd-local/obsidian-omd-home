import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateLocalAiState,
  buildConnectionSummary,
  buildModelEntry,
  buildModelSelectorState,
  createWorkflowSnapshot,
  deriveLocalAiDaemonCode,
  deriveLocalAiModelCode,
  describeModelReadiness,
  modelHasRemoteMetadata,
  modelIsKnownThinkingOnly,
  modelSupportsCompletion,
  modelSupportsEmbedding,
  normalizeLocalOllamaHost,
  providerMode,
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
  hybridRetrievalEnabled: true,
  embeddingModel: "bge-m3",
  semanticRerankEnabled: false,
  enrichmentModel: "qwen3:4b-instruct",
  ollamaHost: "http://localhost:11434",
  capturePolish: false,
  capturePolishModel: "qwen3:4b-instruct",
  captureSuggestLinksAndTags: true,
  pinnedNotes: [],
};

const localModel = buildModelEntry({ name: "qwen3:4b-instruct", capabilities: ["completion", "tools"] });
const embedModel = buildModelEntry({ name: "nomic-embed", capabilities: ["embedding"] });
const remoteModel = buildModelEntry({ name: "cloudy", capabilities: ["completion"], remoteModel: "cloudy", remoteHost: "https://example.com" });
const thinkingOnlyModel = buildModelEntry({ name: "qwen3:4b", capabilities: ["completion", "thinking", "tools"] });

test("normalizeLocalOllamaHost enforces the Phase 1a loopback host contract", () => {
  assert.equal(normalizeLocalOllamaHost("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(normalizeLocalOllamaHost("http://127.0.0.1:11434"), "http://127.0.0.1:11434");
  assert.throws(
    () => normalizeLocalOllamaHost("http://localhost:9999"),
    (error: unknown) => error instanceof LocalAiError && error.code === "invalid_host",
  );
});

test("providerMode keeps hosted providers as legacy-disabled in Phase 1a", () => {
  assert.equal(providerMode("ollama"), "ollama");
  assert.equal(providerMode("openai"), "legacy-disabled");
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
  assert.equal(modelHasRemoteMetadata(remoteModel), true);
});

test("createWorkflowSnapshot and snapshotsMatch bind the workflow tuple", () => {
  const qa = createWorkflowSnapshot("qa", DEFAULT_SETTINGS);
  const enrichment = createWorkflowSnapshot("enrichment", DEFAULT_SETTINGS);
  assert.equal(qa.workflow, "qa");
  assert.equal(enrichment.model, DEFAULT_SETTINGS.enrichmentModel);
  assert.equal(snapshotsMatch(qa, { ...qa }), true);
  assert.equal(snapshotsMatch(qa, { ...qa, model: "qwen3:4b" }), false);
});

test("aggregateLocalAiState surfaces daemon and model failures distinctly", () => {
  const cloudEnabled = buildConnectionSummary({
    host: "http://localhost:11434",
    checkedAt: 1,
    version: "0.32.5",
    daemonCode: "cloud_features_enabled",
    daemonDetail: "disable cloud",
    models: [localModel],
    modelChecks: {},
  });
  const cloudState = aggregateLocalAiState(DEFAULT_SETTINGS, cloudEnabled, [localModel], "");
  assert.equal(cloudState.daemonCode, "cloud_features_enabled");

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
    enrichmentModel: embedModel.name,
  }, partial, [localModel, embedModel], "");
  assert.equal(partialState.daemonCode, "partial");
  assert.equal(partialState.workflows.enrichment.code, "selected_model_incompatible");
});

test("aggregateLocalAiState keeps hosted provider QA disabled without rewriting stored settings", () => {
  const state = aggregateLocalAiState({
    ...DEFAULT_SETTINGS,
    aiProvider: "deepseek",
  }, null, [localModel], "");
  assert.equal(state.providerMode, "legacy-disabled");
  assert.equal(state.workflows.qa.code, "legacy-disabled");
  assert.equal(state.workflows.enrichment.code, "unchecked");
});

test("aggregateLocalAiState keeps local enrichment and capture readiness visible under a preserved hosted provider", () => {
  const ready = buildConnectionSummary({
    host: "http://localhost:11434",
    checkedAt: 1,
    version: "0.32.5",
    daemonCode: "ready",
    daemonDetail: "ready",
    models: [localModel],
    modelChecks: {
      [DEFAULT_SETTINGS.enrichmentModel]: {
        model: DEFAULT_SETTINGS.enrichmentModel,
        checkedAt: 1,
        code: "ready",
        detail: "ready",
        supportsCompletion: true,
      },
      [DEFAULT_SETTINGS.capturePolishModel]: {
        model: DEFAULT_SETTINGS.capturePolishModel,
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
  assert.equal(state.providerMode, "legacy-disabled");
  assert.equal(state.daemonCode, "ready");
  assert.equal(state.workflows.qa.code, "legacy-disabled");
  assert.equal(state.workflows.enrichment.code, "ready");
  assert.equal(state.workflows.capture.code, "ready");
});

test("daemon policy accepts only the exact cloud-disabled status shape", () => {
  assert.equal(deriveLocalAiDaemonCode({ cloud: { disabled: true } }, [localModel]), "ready");
  assert.equal(deriveLocalAiDaemonCode({ cloud: { disabled: false } }, [localModel]), "cloud_features_enabled");
  assert.equal(deriveLocalAiDaemonCode({ cloud: {} }, [localModel]), "cloud_features_unknown");
  assert.equal(deriveLocalAiDaemonCode({ cloud: null }, [localModel]), "cloud_features_unknown");
  assert.equal(deriveLocalAiDaemonCode({ cloud: { disabled: true } }, []), "no_models_installed");
});

test("model policy distinguishes local completion, incompatible, and remote-backed models", () => {
  assert.equal(deriveLocalAiModelCode(localModel), "ready");
  assert.equal(deriveLocalAiModelCode(embedModel), "selected_model_incompatible");
  assert.equal(deriveLocalAiModelCode(thinkingOnlyModel), "selected_model_incompatible");
  assert.match(describeModelReadiness(thinkingOnlyModel.name, thinkingOnlyModel), /qwen3:4b-instruct/u);
  assert.equal(deriveLocalAiModelCode(remoteModel), "selected_model_remote_blocked");
});

test("disabled capture snapshots preserve the invocation flag without requiring a model", () => {
  const settings = { ...DEFAULT_SETTINGS, capturePolishModel: "" };
  assert.equal(createWorkflowSnapshot("capture", settings, false).enabled, false);
  assert.throws(
    () => createWorkflowSnapshot("capture", settings, true),
    (error: unknown) => error instanceof LocalAiError && error.code === "selected_model_missing",
  );
});

test("disabled capture snapshots do not require a valid Ollama host", () => {
  const settings = { ...DEFAULT_SETTINGS, ollamaHost: "http://localhost:9999", capturePolishModel: "" };
  const snapshot = createWorkflowSnapshot("capture", settings, false);
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.host, "http://localhost:9999");
});
