export const LOCAL_OLLAMA_HOSTS = ["http://localhost:11434", "http://127.0.0.1:11434"] as const;

export type SupportedLocalAiProvider = "ollama";
export type StoredAiProvider = SupportedLocalAiProvider | "openai" | "anthropic" | "deepseek";
export type LocalAiProviderMode = "ollama" | "legacy-disabled";
export type LocalAiWorkflowId = "qa" | "enrichment" | "capture";
export type LocalAiReadinessCode =
  | "invalid_host"
  | "daemon_unreachable"
  | "version_unavailable"
  | "status_unavailable"
  | "cloud_features_enabled"
  | "cloud_features_unknown"
  | "no_models_installed"
  | "selected_model_missing"
  | "selected_model_incompatible"
  | "selected_model_remote_blocked"
  | "snapshot_mismatch"
  | "smoke_failed"
  | "unchecked"
  | "ready";

export type LocalAiDisplayState = LocalAiReadinessCode | "checking" | "partial" | "legacy-disabled";

export interface LocalAiModelEntry {
  name: string;
  digest?: string;
  supportsCompletion: boolean;
  capabilities: string[];
  remoteModel?: string;
  remoteHost?: string;
}

export interface LocalAiVersionInfo {
  version: string;
}

export interface LocalAiStatusInfo {
  cloud: {
    disabled?: boolean;
  } | null;
}

export interface LocalAiModelInfo {
  name: string;
  capabilities: string[];
  remoteModel?: string;
  remoteHost?: string;
}

export interface LocalAiSmokeResult {
  model: string;
  latencyMs: number;
  responseText: string;
  remoteModel?: string;
  remoteHost?: string;
}

export interface LocalAiIssue {
  code: LocalAiReadinessCode;
  message: string;
  checkedAt?: number;
  latencyMs?: number;
}

export interface LocalAiSnapshot {
  workflow: LocalAiWorkflowId;
  provider: SupportedLocalAiProvider;
  host: string;
  model: string;
  enabled: boolean;
}

export interface LocalAiCheckedModel {
  model: string;
  checkedAt: number;
  code: LocalAiReadinessCode;
  detail: string;
  supportsCompletion: boolean;
}

export interface LocalAiConnectionSummary {
  host: string;
  checkedAt: number;
  version?: string;
  daemonCode: LocalAiReadinessCode;
  daemonDetail: string;
  models: LocalAiModelEntry[];
  modelChecks: Record<string, LocalAiCheckedModel>;
}

export interface LocalAiWorkflowDisplayState {
  id: LocalAiWorkflowId;
  label: string;
  model: string;
  enabled: boolean;
  code: LocalAiDisplayState;
  detail: string;
  checkedAt?: number;
}

export interface LocalAiRuntimeState {
  providerMode: LocalAiProviderMode;
  providerValue: StoredAiProvider;
  normalizedHost?: string;
  catalogHost?: string;
  catalogCheckedAt?: number;
  version?: string;
  daemonCode: LocalAiDisplayState;
  daemonDetail: string;
  workflows: Record<LocalAiWorkflowId, LocalAiWorkflowDisplayState>;
  models: LocalAiModelEntry[];
  modelChecks: Record<string, LocalAiCheckedModel>;
  activeAction: "" | "refresh-models" | "check-connection" | `smoke:${LocalAiWorkflowId}`;
}

export interface LocalAiActionFeedback {
  tone: "neutral" | "success" | "error";
  message: string;
  at: number;
}

export class LocalAiError extends Error {
  readonly code: LocalAiReadinessCode;
  readonly detail?: string;

  constructor(code: LocalAiReadinessCode, message: string, detail?: string) {
    super(message);
    this.name = "LocalAiError";
    this.code = code;
    this.detail = detail;
  }
}

export function isLocalAiWorkflowId(value: string): value is LocalAiWorkflowId {
  return value === "qa" || value === "enrichment" || value === "capture";
}
