import type { OmdHomeSettings } from "./settings.ts";
import {
  LOCAL_OLLAMA_HOSTS,
  LocalAiError,
  type LocalAiCheckedModel,
  type LocalAiConnectionSummary,
  type LocalAiDisplayState,
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
  capture: "Capture polish",
};

export const LOCAL_AI_CACHE_TTL_MS = 60_000;

export function normalizeLocalOllamaHost(input: string): string {
  const trimmed = input.trim().replace(/\/+$/u, "");
  if (LOCAL_OLLAMA_HOSTS.includes(trimmed as (typeof LOCAL_OLLAMA_HOSTS)[number])) return trimmed;
  throw new LocalAiError(
    "invalid_host",
    "OMD Home Phase 1a accepts only http://localhost:11434 or http://127.0.0.1:11434.",
    "Use the default Ollama port and disable Ollama Cloud before retrying.",
  );
}

export function providerMode(provider: OmdHomeSettings["aiProvider"]): LocalAiProviderMode {
  return provider === "ollama" ? "ollama" : "legacy-disabled";
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
  if (workflow === "enrichment") return settings.enrichmentModel;
  return settings.capturePolishModel;
}

export function snapshotsMatch(left: LocalAiSnapshot, right: LocalAiSnapshot): boolean {
  return left.workflow === right.workflow
    && left.provider === right.provider
    && left.host === right.host
    && left.model === right.model
    && left.enabled === right.enabled;
}

export function modelIsKnownThinkingOnly(model: Pick<LocalAiModelEntry, "name">): boolean {
  const normalized = model.name.trim().toLowerCase();
  return normalized === "qwen3:4b" || normalized.includes("-thinking");
}

export function modelSupportsCompletion(model: Pick<LocalAiModelEntry, "name" | "capabilities">): boolean {
  return model.capabilities.includes("completion") && !modelIsKnownThinkingOnly(model);
}

export function modelHasRemoteMetadata(model: Pick<LocalAiModelEntry, "remoteModel" | "remoteHost">): boolean {
  return Boolean(model.remoteModel || model.remoteHost);
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
    supportsCompletion: capabilities.includes("completion") && !modelIsKnownThinkingOnly({ name }),
    remoteModel: raw.remoteModel?.trim() || undefined,
    remoteHost: raw.remoteHost?.trim() || undefined,
  };
}

export function deriveLocalAiDaemonCode(
  status: LocalAiStatusInfo,
  models: LocalAiModelEntry[],
): LocalAiReadinessCode {
  if (!status.cloud || status.cloud.disabled === undefined) return "cloud_features_unknown";
  if (status.cloud.disabled === false) return "cloud_features_enabled";
  if (!models.length) return "no_models_installed";
  return "ready";
}

export function deriveLocalAiModelCode(model: LocalAiModelInfo): LocalAiReadinessCode {
  if (modelHasRemoteMetadata(model)) return "selected_model_remote_blocked";
  if (!modelSupportsCompletion(model)) return "selected_model_incompatible";
  return "ready";
}

export function describeDaemonReadiness(code: LocalAiReadinessCode): string {
  switch (code) {
    case "ready":
      return "The local daemon and selected models are ready.";
    case "no_models_installed":
      return "Ollama is reachable, but no local models are installed. Run `ollama pull` for a text model.";
    case "cloud_features_enabled":
      return "Ollama reports that Cloud features are available. This does not mean your selected model is currently online, but OMD Home requires local-only mode before sending vault content. Set `disable_ollama_cloud` to true or `OLLAMA_NO_CLOUD=1`, restart Ollama, then check again.";
    case "cloud_features_unknown":
      return "Ollama did not prove that Cloud features are disabled. OMD Home requires local-only mode before sending vault content. Set `disable_ollama_cloud` to true or `OLLAMA_NO_CLOUD=1`, restart Ollama, then check again.";
    default:
      return describeReadinessCode(code);
  }
}

export function describeModelReadiness(model: string, info: LocalAiModelInfo): string {
  if (modelHasRemoteMetadata(info)) {
    return `${model} reported remote Ollama metadata and was blocked.`;
  }
  if (!modelSupportsCompletion(info)) {
    if (modelIsKnownThinkingOnly(info)) {
      return `${model} can spend the entire bounded answer budget on reasoning. Choose qwen3:4b-instruct for Vault Q&A and other bounded text tasks.`;
    }
    return `${model} does not advertise text completion support. Choose a completion-capable local model.`;
  }
  return `${model} is ready.`;
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
  const knownNames = new Set(models.map((model) => model.name));
  if (!currentValue.trim()) {
    return { optionValue: "__custom__", useCustom: true, stale: false, customValue: "" };
  }
  if (knownNames.has(currentValue)) {
    return { optionValue: currentValue, useCustom: false, stale: false, customValue: currentValue };
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
    case "legacy-disabled":
      return "Legacy provider disabled";
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
    case "selected_model_missing":
      return "Model missing";
    case "selected_model_incompatible":
      return "Model incompatible";
    case "selected_model_remote_blocked":
      return "Remote-backed model blocked";
    case "snapshot_mismatch":
      return "Settings changed";
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
      code: "legacy-disabled",
      detail: "Select Ollama in OMD Home settings before using vault AI.",
    };
  }
  if (!summary) {
    return {
      id: workflow,
      label: WORKFLOW_LABELS[workflow],
      model,
      enabled,
      code: "unchecked",
      detail: "Run Check connection to validate Ollama and the configured model.",
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
      detail: "Run Check connection after changing the selected model.",
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
    .filter((state) => state.enabled && state.code !== "legacy-disabled")
    .map((state) => state.code);
  let daemonCode: LocalAiDisplayState = currentProviderMode === "legacy-disabled" ? "legacy-disabled" : "unchecked";
  let daemonDetail = currentProviderMode === "legacy-disabled"
    ? "Hosted provider settings are preserved for Vault Q&A, but local Ollama still powers note enrichment and capture polish."
    : "Run Check connection to validate the local Ollama daemon.";
  if (activeSummary) {
    daemonCode = activeSummary.daemonCode;
    daemonDetail = activeSummary.daemonDetail;
    if (workflowCodes.length && workflowCodes.every((code) => code === "ready")) {
      daemonCode = "ready";
      daemonDetail = "The local daemon and all active workflow models are ready.";
    } else if (workflowCodes.some((code) => code === "ready")) {
      daemonCode = "partial";
      daemonDetail = "At least one workflow model is ready, but another still needs attention.";
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
    (workflow) => workflow.enabled && workflow.code !== "legacy-disabled",
  );
}

export function isFresh(timestamp?: number, now = Date.now()): boolean {
  return typeof timestamp === "number" && now - timestamp <= LOCAL_AI_CACHE_TTL_MS;
}

function normalizeDisabledSnapshotHost(input: string): string {
  const trimmed = input.trim().replace(/\/+$/u, "");
  return trimmed || LOCAL_OLLAMA_HOSTS[0];
}
