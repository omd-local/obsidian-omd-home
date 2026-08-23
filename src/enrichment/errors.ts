import { LocalAiError } from "../ollama-local-types.ts";

export type EnrichmentErrorCode =
  | "desktop_only"
  | "missing_executable"
  | "unsupported_capability"
  | "unsupported_schema"
  | "capability_timeout"
  | "capability_invalid_json"
  | "invalid_request"
  | "invalid_response"
  | "invalid_event"
  | "request_too_large"
  | "target_note_too_large"
  | "remote_host_not_allowed"
  | "vault_required"
  | "note_conflict"
  | "apply_failed"
  | "partial_apply"
  | "cancelled"
  | "generation_timeout"
  | "output_overflow"
  | "omd_failed";

export class OmdEnrichmentError extends Error {
  readonly code: EnrichmentErrorCode;

  constructor(code: EnrichmentErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OmdEnrichmentError";
    this.code = code;
  }
}

export { OmdEnrichmentError as EnrichmentError };

export function isEnrichmentError(value: unknown): value is OmdEnrichmentError {
  return value instanceof OmdEnrichmentError;
}

export function toUserFacingEnrichmentMessage(error: unknown): string {
  if (error instanceof OmdEnrichmentError) return error.message;
  if (error instanceof LocalAiError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "OMD enrichment was cancelled.";
  return "OMD enrichment failed. Check the OMD setup and try again.";
}

export function mapOmdErrorKind(kind: string, model?: string): OmdEnrichmentError {
  switch (kind) {
    case "unsupported_schema":
      return new OmdEnrichmentError("unsupported_schema", "Update OMD to a build that supports enrichment schema v1.");
    case "invalid_request":
    case "path_outside_vault":
    case "note_not_found":
      return new OmdEnrichmentError("invalid_request", "The note or candidate catalog changed. Generate a fresh proposal.");
    case "request_too_large":
      return new OmdEnrichmentError("request_too_large", "The enrichment request exceeds the 512 KiB OMD v1 limit.");
    case "ollama_unavailable":
      return new OmdEnrichmentError("omd_failed", "Ollama is unavailable. Start Ollama and try again.");
    case "remote_ollama_not_authorized":
      return new OmdEnrichmentError("remote_host_not_allowed", "OMD Home v1 only allows a loopback Ollama endpoint for enrichment.");
    case "model_not_installed":
      return new OmdEnrichmentError(
        "omd_failed",
        safeOllamaModelName(model)
          ? `The selected Ollama model is not installed. Run: ollama pull ${model}`
          : "The selected Ollama model is not installed. Run ollama pull for the exact model in OMD Home settings.",
      );
    case "generation_timeout":
      return new OmdEnrichmentError("generation_timeout", "The local model timed out while generating suggestions.");
    case "invalid_model_json":
    case "unknown_candidate_id":
      return new OmdEnrichmentError("invalid_response", "OMD rejected the model proposal. Try again or choose another local model.");
    case "cancelled":
      return new OmdEnrichmentError("cancelled", "OMD enrichment was cancelled.");
    default:
      return new OmdEnrichmentError("omd_failed", "OMD enrichment failed. Check the local OMD output and try again.");
  }
}

function safeOllamaModelName(model: string | undefined): model is string {
  return typeof model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(model);
}
