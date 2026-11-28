import type { OmdHomeSettings } from "./settings.ts";
import { modelIsCloudBacked } from "./ai-provider.ts";
import {
  LOCAL_OLLAMA_HOSTS,
  LocalAiError,
  type LocalAiCheckedModel,
  type LocalAiConnectionSummary,
  type LocalAiDisplayState,
  type LocalAiEmbeddingProbe,
  type LocalAiModelEntry,
  type LocalAiModelInfo,
  type LocalAiProviderMode,
  type LocalAiReadinessCode,
  type LocalAiRuntimeState,
  type LocalAiSnapshot,
  type LocalAiStatusInfo,
  type LocalAiWorkflowDisplayState,
  type LocalAiWorkflowId,
} from "./ollama-local-types.ts";

const WORKFLOW_LABELS: Record<LocalAiWorkflowId, string> = {
  qa: "Vault Q&A",
  enrichment: "Note enrichment",
  capture: "Polish Markdown",
};

export const LOCAL_AI_CACHE_TTL_MS = 60_000;

export function localModelNamesMatch(left: string, right: string): boolean {
  const canonical = (value: string): string => value.trim().toLowerCase().replace(/:latest$/u, "");
  return Boolean(canonical(left)) && canonical(left) === canonical(right);
}

export function normalizeLocalOllamaHost(input: string): string {
  const trimmed = input.trim();
  // Check the original spelling because URL parsing normalizes alternate IP spellings,
  // strips empty credentials, and omits explicit default ports.
  const match = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):([0-9]+)$/u.exec(trimmed);
  const port = Number(match?.[1]);
  if (match && port >= 1 && port <= 65_535) {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.hostname}:${port}`;
  }
  throw new LocalAiError(
    "invalid_host",
    "Use an HTTP loopback Ollama endpoint with localhost, 127.0.0.1, or [::1] and an explicit port from 1 to 65535.",
    "Enter a base endpoint such as http://localhost:11434, without credentials, a path, a query, or a fragment.",
  );
}

export function localModelPullCommand(value: string, endpoint: string, windows: boolean): string | null {
  const model = value.trim();
  const id = /^(?:[A-Za-z0-9][A-Za-z0-9_-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*)?$/u;
  if (model.length > 256 || !id.test(model) || modelIsCloudBacked({ name: model })) return null;
  let host: string;
  try {
    host = normalizeLocalOllamaHost(endpoint);
  } catch {
    return null;
  }
  return windows
    ? `cmd.exe /d /c "set OLLAMA_HOST=${host}&& ollama pull ${model}"`
    : `OLLAMA_HOST='${host}' ollama pull ${model}`;
}

export function embeddingModelPullCommand(value: string, endpoint: string, windows: boolean): string | null {
  return localModelPullCommand(value, endpoint, windows);
}

export function textModelInstallGuidance(input: {
  model: string;
  host: string;
  windows?: boolean;
  models: readonly LocalAiModelEntry[];
  catalogChecked: boolean;
  connectionCode: LocalAiRuntimeState["daemonCode"];
  code: LocalAiWorkflowDisplayState["code"];
}): { model: string; pullCommand: string | null } | null {
  if (input.connectionCode !== "ready" && input.connectionCode !== "no_models_installed") return null;
  if (input.code !== "selected_model_missing" && input.code !== "no_models_installed" && input.code !== "unchecked") return null;
  const model = input.model.trim();
  if (!model) return null;
  const missing = input.code === "selected_model_missing" || input.code === "no_models_installed"
    || (input.catalogChecked && !input.models.some((entry) => localModelNamesMatch(entry.name, model)));
  return missing ? { model, pullCommand: localModelPullCommand(model, input.host, input.windows ?? false) } : null;
}

export interface EmbeddingSetupPresentation {
  kind: "unchecked" | "daemon-unreachable" | "connection-failed"
    | "no-local-models" | "model-not-selected" | "model-missing" | "model-incompatible"
    | "model-cloud-backed" | "embedding-only" | "test-failed" | "ready" | "verified";
  title: string;
  detail: string;
  action: "check-setup" | "open-ollama" | "start-ollama" | "copy-pull-command"
    | "refresh-models" | "choose-model" | "test-embeddings";
  needsTextModel: boolean;
  pullCommand: string | null;
}

export function classifyEmbeddingSetup(input: {
  model: string;
  models?: readonly LocalAiModelEntry[];
  host: string;
  windows?: boolean;
  connectionCode?: LocalAiReadinessCode;
  probe?: LocalAiEmbeddingProbe | null;
  localAnswer?: boolean;
}): EmbeddingSetupPresentation {
  const model = input.model.trim();
  const probe = input.probe?.host === input.host && localModelNamesMatch(input.probe.model, model)
    ? input.probe
    : null;
  const localModels = input.models?.filter((entry) => !modelIsCloudBacked(entry));
  const needsTextModel = Boolean(input.localAnswer && (
    input.connectionCode === "no_models_installed" || (localModels && !localModels.some(localWritingModelIsSelectable))
  ));
  const present = (
    kind: EmbeddingSetupPresentation["kind"],
    title: string,
    detail: string,
    action: EmbeddingSetupPresentation["action"],
  ): EmbeddingSetupPresentation => ({ kind, title, detail, action, needsTextModel, pullCommand: null });

  switch (input.connectionCode) {
    case "invalid_host":
      return present("connection-failed", "Check the Ollama endpoint", "Enter an HTTP loopback endpoint with a port, then run Check setup.", "check-setup");
    case "version_unavailable":
    case "status_unavailable":
    case "provider_catalog_unavailable":
    case "provider_unreachable":
      return present("connection-failed", "Ollama setup check failed", "Check that the configured endpoint serves the Ollama API, then run Check setup.", "check-setup");
    case "daemon_unreachable":
      return present("daemon-unreachable", "Ollama is not responding", "If Ollama is installed, open it or start its local service. Otherwise install it first. Then run Check setup.", "start-ollama");
  }
  if (!model) {
    return present("model-not-selected", "Choose an embedding model", "Select a local embedding model for Vault retrieval, then run Test semantic search.", "choose-model");
  }

  const selected = input.models?.find((entry) => localModelNamesMatch(entry.name, model));
  const selectedRevision = selected?.digest?.trim();
  const verifiedProbe = probe?.code === "ready"
    && Boolean(selectedRevision)
    && probe.revision === selectedRevision;
  if (probe?.code === "selected_model_remote_blocked" || modelIsCloudBacked(selected ?? { name: model })) {
    return present("model-cloud-backed", "Cloud-backed model blocked", "Choose a local embedding model for Vault retrieval, then run Test semantic search.", "choose-model");
  }
  if (probe?.code === "selected_model_incompatible") {
    return present("model-incompatible", "Embedding support unavailable", `${model} could not be used for embeddings. Choose an embedding-capable local model, then run Test semantic search.`, "choose-model");
  }
  if (probe?.code === "smoke_failed" || probe?.code === "model_unavailable") {
    return present("test-failed", "Embedding check failed", `Ollama could not verify embeddings with ${model}. Run Test semantic search again after checking the model in Ollama.`, "test-embeddings");
  }

  const noLocalModels = input.connectionCode === "no_models_installed" || localModels?.length === 0;
  const missing = probe?.code === "selected_model_missing" || (input.models && !selected);
  if (noLocalModels || missing) {
    const pullCommand = embeddingModelPullCommand(model, input.host, input.windows ?? false);
    const kind = noLocalModels ? "no-local-models" : "model-missing";
    const title = noLocalModels ? "No local models installed" : "Embedding model missing";
    const action = pullCommand ? "copy-pull-command" : "refresh-models";
    const detail = pullCommand
      ? "Copy the install command and run it in a terminal. Ollama downloads the model separately; size and time depend on the model. After it finishes, choose Check setup, then Test semantic search."
      : "Install an embedding-capable model from the Ollama model library, then choose Check setup, select it, and run Test semantic search.";
    return { ...present(kind, title, detail, action), pullCommand };
  }
  // Catalog entries can omit capabilities. Test semantic search inspects the selected model directly.
  if (selected?.capabilities.length && !modelSupportsEmbedding(selected) && !verifiedProbe) {
    return present("model-incompatible", "Embedding support unavailable", `${model} does not advertise embedding support. Choose an embedding-capable local model, then run Test semantic search.`, "choose-model");
  }
  if (verifiedProbe) {
    const vectors = probe.vectorCount && probe.dimensions ? ` (${probe.vectorCount} vectors × ${probe.dimensions} dimensions)` : "";
    return present("verified", "Embeddings verified", `${model} passed the local embedding test for Vault retrieval${vectors}.`, "test-embeddings");
  }
  if (selected) {
    const embeddingOnly = needsTextModel && localModels?.every((entry) => modelSupportsEmbedding(entry) && !modelSupportsCompletion(entry));
    return present(embeddingOnly ? "embedding-only" : "ready", "Test the local embedding model", `Run Test semantic search to verify ${model} for Vault retrieval.`, "test-embeddings");
  }
  return present("unchecked", "Check local embedding setup", "Run Check setup to load the Ollama catalog, then run Test semantic search.", "check-setup");
}

export function providerMode(provider: OmdHomeSettings["aiProvider"]): LocalAiProviderMode {
  return provider === "ollama" ? "ollama" : "cloud";
}

export function createWorkflowSnapshot(
  workflow: LocalAiWorkflowId,
  settings: OmdHomeSettings,
  enabled = true,
): LocalAiSnapshot {
  const model = workflowModel(workflow, settings).trim();
  if (enabled && !model) {
    throw new LocalAiError(
      "selected_model_missing",
      `Choose an Ollama model for ${WORKFLOW_LABELS[workflow]} before continuing.`,
    );
  }
  return {
    workflow,
    provider: "ollama",
    host: enabled ? normalizeLocalOllamaHost(settings.ollamaHost) : normalizeDisabledSnapshotHost(settings.ollamaHost),
    model,
    enabled,
  };
}

export function workflowModel(workflow: LocalAiWorkflowId, settings: OmdHomeSettings): string {
  if (workflow === "qa") return settings.aiModel;
  return settings.localWritingModel;
}

export function snapshotsMatch(left: LocalAiSnapshot, right: LocalAiSnapshot): boolean {
  return left.workflow === right.workflow
    && left.provider === right.provider
    && left.host === right.host
    && left.model === right.model
    && left.enabled === right.enabled;
}

export function modelIsKnownAnswerBudgetIncompatible(model: Pick<LocalAiModelEntry, "name">): boolean {
  const normalized = model.name.trim().toLowerCase().replace(/:latest$/u, "");
  return normalized === "qwen3:4b" || normalized.includes("-thinking");
}

export function modelSupportsCompletion(model: Pick<LocalAiModelEntry, "capabilities">): boolean {
  return model.capabilities.includes("completion");
}

export function modelSupportsEmbedding(model: Pick<LocalAiModelEntry, "name" | "capabilities">): boolean {
  if (model.capabilities.length) return model.capabilities.includes("embedding");
  const normalized = model.name.trim().toLowerCase().replace(/:latest$/u, "");
  return normalized === "bge-m3" || normalized.includes("embed") || normalized.includes("embedding");
}

export function localWritingModelIsSelectable(model: LocalAiModelEntry): boolean {
  if (modelIsCloudBacked(model) || modelIsKnownAnswerBudgetIncompatible(model)) return false;
  if (modelSupportsCompletion(model)) return true;
  // Missing or partial catalog metadata is inconclusive. The execution gate inspects the
  // selected model with /api/show before any vault evidence is sent to it.
  return !modelSupportsEmbedding(model) && !model.capabilities.includes("thinking");
}

export function localWritingModelOptionLabel(model: LocalAiModelEntry): string {
  if (modelIsCloudBacked(model)) return `${model.name} (cloud-backed; unavailable for local text answers)`;
  if (modelIsKnownAnswerBudgetIncompatible(model)) {
    return `${model.name} (not supported for OMD Home answers)`;
  }
  if (!modelSupportsCompletion(model) && model.capabilities.includes("thinking")) {
    return `${model.name} (thinking-only; unavailable for text answers)`;
  }
  if (modelSupportsEmbedding(model) && !modelSupportsCompletion(model)) {
    return `${model.name} (embedding model; unavailable for text answers)`;
  }
  return modelSupportsCompletion(model) ? model.name : `${model.name} (completion support unverified)`;
}

export function describeLocalCompletionCatalog(models: LocalAiModelEntry[], catalogChecked: boolean): string {
  if (!catalogChecked) return "";
  const localModels = models.filter((model) => !modelIsCloudBacked(model));
  const availableModels = localModels.filter(localWritingModelIsSelectable);
  return `${availableModels.length} of ${localModels.length} local models available for text.`;
}

export function buildModelEntry(raw: {
  name: string;
  digest?: string;
  capabilities?: string[];
  remoteModel?: string;
  remoteHost?: string;
}): LocalAiModelEntry {
  const name = raw.name.trim();
  const capabilities = [...new Set((raw.capabilities ?? []).filter(Boolean))].sort();
  return {
    name,
    digest: raw.digest?.trim() || undefined,
    capabilities,
    supportsCompletion: capabilities.includes("completion"),
    remoteModel: raw.remoteModel?.trim() || undefined,
    remoteHost: raw.remoteHost?.trim() || undefined,
  };
}


export function mergeInspectedModelEntry(
  catalogEntry: LocalAiModelEntry | undefined,
  inspectedEntry: LocalAiModelEntry,
  name = inspectedEntry.name,
): LocalAiModelEntry {
  return {
    ...catalogEntry,
    ...inspectedEntry,
    name,
    digest: inspectedEntry.digest ?? catalogEntry?.digest,
    remoteModel: inspectedEntry.remoteModel ?? catalogEntry?.remoteModel,
    remoteHost: inspectedEntry.remoteHost ?? catalogEntry?.remoteHost,
  };
}

export function resolveEmbeddingModelRevision(
  modelName: string,
  models: Pick<LocalAiModelEntry, "name" | "digest">[],
): string | undefined {
  const trimmed = modelName.trim();
  if (!trimmed) return undefined;
  return models.find((model) => localModelNamesMatch(model.name, trimmed))?.digest?.trim() || undefined;
}

export function deriveLocalAiDaemonCode(
  _status: LocalAiStatusInfo,
  models: LocalAiModelEntry[],
): LocalAiReadinessCode {
  if (!models.length) return "no_models_installed";
  return "ready";
}

export function deriveLocalAiModelCode(model: LocalAiModelInfo): LocalAiReadinessCode {
  if (modelIsCloudBacked(model)) return "selected_model_remote_blocked";
  if (modelIsKnownAnswerBudgetIncompatible(model) || !modelSupportsCompletion(model)) {
    return "selected_model_incompatible";
  }
  return "ready";
}

export function describeDaemonReadiness(code: LocalAiReadinessCode): string {
  switch (code) {
    case "ready":
      return "The local daemon and selected models are ready.";
    case "no_models_installed":
      return "Ollama is reachable, but no local models are installed. Run `ollama pull` for a text model.";
    case "cloud_features_enabled":
      return "Ollama reports that Cloud features are available. Local workflows can still run when the selected models stay local and pass inspection.";
    case "cloud_features_unknown":
      return "Ollama did not report Cloud status, so OMD Home will verify the selected models directly before local actions run.";
    default:
      return describeReadinessCode(code);
  }
}

export function describeModelReadiness(model: string, info: LocalAiModelInfo): string {
  if (modelIsCloudBacked(info)) {
    return `${model} was identified as cloud-backed and blocked from local-only use.`;
  }
  if (modelIsKnownAnswerBudgetIncompatible(info)) {
    return `${model} can generate text, but it is not supported for reliable answers in OMD Home. Choose qwen3:4b-instruct or another answer-compatible local model.`;
  }
  if (!modelSupportsCompletion(info)) {
    return `${model} does not advertise text completion support. Choose a completion-capable local model.`;
  }
  return `${model} is available locally for text completion.`;
}

export function buildModelSelectorState(
  currentValue: string,
  models: LocalAiModelEntry[],
): {
  optionValue: string;
  useCustom: boolean;
  stale: boolean;
  customValue: string;
} {
  if (!currentValue.trim()) {
    return { optionValue: "__custom__", useCustom: true, stale: false, customValue: "" };
  }
  const known = models.find((model) => localModelNamesMatch(model.name, currentValue));
  if (known) {
    return { optionValue: known.name, useCustom: false, stale: false, customValue: currentValue };
  }
  return { optionValue: "__stale__", useCustom: true, stale: true, customValue: currentValue };
}

export function describeReadinessCode(code: LocalAiDisplayState): string {
  switch (code) {
    case "ready":
      return "Ready";
    case "unchecked":
      return "Unchecked";
    case "checking":
      return "Checking";
    case "partial":
      return "Partial";
    case "cloud-provider":
      return "Cloud answer selected";
    case "invalid_host":
      return "Invalid host";
    case "daemon_unreachable":
      return "Daemon unreachable";
    case "version_unavailable":
      return "Version unavailable";
    case "status_unavailable":
      return "Status unavailable";
    case "cloud_features_enabled":
      return "Cloud features enabled";
    case "cloud_features_unknown":
      return "Cloud status unknown";
    case "no_models_installed":
      return "No models installed";
    case "credentials_invalid":
      return "API key rejected";
    case "credentials_missing":
      return "API key missing";
    case "provider_unreachable":
      return "Provider unreachable";
    case "provider_catalog_unavailable":
      return "Model catalog unavailable";
    case "disclosure_unavailable":
      return "Disclosure unavailable";
    case "model_unavailable":
      return "Model unavailable";
    case "selected_model_missing":
      return "Model missing";
    case "selected_model_incompatible":
      return "Model incompatible";
    case "selected_model_remote_blocked":
      return "Remote-backed model blocked";
    case "snapshot_mismatch":
      return "Settings changed";
    case "provider_destination_mismatch":
      return "Destination mismatch";
    case "smoke_failed":
      return "Smoke failed";
  }
}

export function buildWorkflowDisplayState(
  workflow: LocalAiWorkflowId,
  settings: OmdHomeSettings,
  summary: LocalAiConnectionSummary | null,
  currentProviderMode: LocalAiProviderMode,
  enabled = true,
): LocalAiWorkflowDisplayState {
  const model = workflowModel(workflow, settings).trim();
  if (!enabled) {
    return {
      id: workflow,
      label: WORKFLOW_LABELS[workflow],
      model,
      enabled: false,
      code: "unchecked",
      detail: "Disabled for this action.",
    };
  }
  if (currentProviderMode !== "ollama" && workflow === "qa") {
    return {
      id: workflow,
      label: WORKFLOW_LABELS[workflow],
      model,
      enabled,
      code: "cloud-provider",
      detail: "Check setup verifies the selected cloud answer path. Retrieval still stays local, and each cloud answer needs confirmation.",
    };
  }
  if (!summary) {
    return {
      id: workflow,
      label: WORKFLOW_LABELS[workflow],
      model,
      enabled,
      code: "unchecked",
      detail: "Run Check setup to validate Ollama and the configured model.",
    };
  }
  if (summary.daemonCode !== "ready") {
    return {
      id: workflow,
      label: WORKFLOW_LABELS[workflow],
      model,
      enabled,
      code: summary.daemonCode,
      detail: summary.daemonDetail,
      checkedAt: summary.checkedAt,
    };
  }
  if (!summary.models.length) {
    return {
      id: workflow,
      label: WORKFLOW_LABELS[workflow],
      model,
      enabled,
      code: "no_models_installed",
      detail: "Install at least one local text model with `ollama pull`.",
      checkedAt: summary.checkedAt,
    };
  }
  const checked = summary.modelChecks[model];
  if (!checked) {
    return {
      id: workflow,
      label: WORKFLOW_LABELS[workflow],
      model,
      enabled,
      code: "unchecked",
      detail: "Run Check setup after changing the selected model.",
      checkedAt: summary.checkedAt,
    };
  }
  return {
    id: workflow,
    label: WORKFLOW_LABELS[workflow],
    model,
    enabled,
    code: checked.code,
    detail: checked.detail,
    checkedAt: checked.checkedAt,
  };
}

export function aggregateLocalAiState(
  settings: OmdHomeSettings,
  connectionSummary: LocalAiConnectionSummary | null,
  models: LocalAiModelEntry[],
  activeAction: LocalAiRuntimeState["activeAction"],
): LocalAiRuntimeState {
  const currentProviderMode = providerMode(settings.aiProvider);
  const activeSummary = connectionSummary;
  const qa = buildWorkflowDisplayState("qa", settings, activeSummary, currentProviderMode);
  const enrichment = buildWorkflowDisplayState("enrichment", settings, activeSummary, currentProviderMode);
  const capture = buildWorkflowDisplayState("capture", settings, activeSummary, currentProviderMode, settings.capturePolish);
  const workflows = { qa, enrichment, capture };
  const workflowCodes = Object.values(workflows)
    .filter((state) => state.enabled && state.code !== "cloud-provider")
    .map((state) => state.code);
  let daemonCode: LocalAiDisplayState = "unchecked";
  let daemonDetail = "Run Check setup to validate the local Ollama daemon.";
  if (activeSummary) {
    daemonCode = activeSummary.daemonCode;
    daemonDetail = activeSummary.daemonDetail;
    if (workflowCodes.length && workflowCodes.every((code) => code === "ready")) {
      daemonCode = "ready";
      daemonDetail = "The selected local text models are ready.";
    } else if (workflowCodes.some((code) => code === "ready")) {
      daemonCode = "partial";
      daemonDetail = "Some local text models are ready; check the model status below.";
    } else if (workflowCodes.some((code) => code !== "unchecked")) {
      const blocking = Object.values(workflows).find((state) => state.enabled && state.code !== "ready");
      if (blocking) {
        daemonCode = blocking.code;
        daemonDetail = blocking.detail;
      }
    }
  }
  return {
    providerMode: currentProviderMode,
    providerValue: settings.aiProvider,
    connectionCode: activeSummary?.daemonCode ?? "unchecked",
    normalizedHost: activeSummary?.host,
    catalogHost: activeSummary?.host,
    catalogCheckedAt: activeSummary?.checkedAt,
    version: activeSummary?.version,
    daemonCode,
    daemonDetail,
    workflows,
    models,
    modelChecks: activeSummary?.modelChecks ?? {},
    activeAction,
  };
}

export function buildConnectionSummary(input: {
  host: string;
  checkedAt: number;
  version?: string;
  daemonCode: LocalAiReadinessCode;
  daemonDetail: string;
  models: LocalAiModelEntry[];
  modelChecks: Record<string, LocalAiCheckedModel>;
}): LocalAiConnectionSummary {
  return {
    host: input.host,
    checkedAt: input.checkedAt,
    version: input.version,
    daemonCode: input.daemonCode,
    daemonDetail: input.daemonDetail,
    models: input.models,
    modelChecks: input.modelChecks,
  };
}

export function getActiveWorkflowModels(settings: OmdHomeSettings): LocalAiWorkflowDisplayState[] {
  const summary = aggregateLocalAiState(settings, null, [], "");
  return Object.values(summary.workflows).filter(
    (workflow) => workflow.enabled && workflow.code !== "cloud-provider",
  );
}

export function isFresh(timestamp?: number, now = Date.now()): boolean {
  return typeof timestamp === "number" && now - timestamp <= LOCAL_AI_CACHE_TTL_MS;
}

function normalizeDisabledSnapshotHost(input: string): string {
  const trimmed = input.trim().replace(/\/+$/u, "");
  return trimmed || LOCAL_OLLAMA_HOSTS[0];
}
