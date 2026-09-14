import { LocalAiError } from "../ollama-local-types.ts";

export type EnrichmentErrorCode =
  | "desktop_only"
  | "missing_executable"
  | "unsupported_capability"
  | "unsupported_schema"
  | "capability_timeout"
  | "capability_invalid_json"
  | "invalid_request"
  | "invalid_candidate_evidence"
  | "invalid_response"
  | "invalid_event"
  | "request_too_large"
  | "target_note_too_large"
  | "remote_host_not_allowed"
  | "vault_required"
  | "note_unavailable"
  | "note_conflict"
  | "apply_failed"
  | "partial_apply"
  | "cancelled"
  | "generation_timeout"
  | "output_overflow"
  | "omd_failed";

export const INVALID_CANDIDATE_EVIDENCE_MESSAGE = "A candidate note snippet contains text that OMD cannot use for suggestions.";

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
  if (error instanceof OmdEnrichmentError && error.code === "invalid_candidate_evidence") {
    return INVALID_CANDIDATE_EVIDENCE_MESSAGE;
  }
  if (error instanceof OmdEnrichmentError) return error.message;
  if (error instanceof LocalAiError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "OMD enrichment was cancelled.";
  return "OMD enrichment failed. Check the OMD setup and try again.";
}

export interface EnrichmentFailurePresentation {
  phase: "cancelled" | "conflict" | "unavailable" | "error";
  statusText: string;
  detailText: string;
  canRetry?: boolean;
}

export type EnrichmentFailureContext = "generation" | "apply";

export function describeEnrichmentFailure(
  error: unknown,
  context: EnrichmentFailureContext,
): EnrichmentFailurePresentation {
  const statusText = toUserFacingEnrichmentMessage(error);
  if (error instanceof OmdEnrichmentError && error.code === "invalid_candidate_evidence") {
    return {
      phase: "error",
      statusText,
      detailText: context === "generation"
        ? "Your note is unchanged. Close this view and check the related note snippets for incompatible text."
        : "Close this view and review the target note and related note snippets for incompatible text.",
      canRetry: false,
    };
  }
  if ((error instanceof OmdEnrichmentError && error.code === "cancelled")
    || (error instanceof Error && error.name === "AbortError")) {
    return {
      phase: "cancelled",
      statusText,
      detailText: context === "generation"
        ? "No proposal changes were written."
        : "Apply was cancelled. Review the note before trying again.",
    };
  }
  if (error instanceof OmdEnrichmentError && error.code === "note_conflict") {
    return {
      phase: "conflict",
      statusText,
      detailText: context === "generation"
        ? "No proposal changes were written. Refresh the note, then generate a new proposal."
        : "Review the note, then generate a fresh proposal before applying again.",
    };
  }
  if (error instanceof OmdEnrichmentError && error.code === "note_unavailable") {
    return {
      phase: "unavailable",
      statusText,
      detailText: "No proposal changes were written. Close this view, then start again from an available Markdown note.",
    };
  }
  return {
    phase: "error",
    statusText,
    detailText: context === "generation"
      ? generationRecoveryDetail(error)
      : applyRecoveryDetail(error),
  };
}

export function mapOmdErrorKind(kind: string, model?: string, terminalMessage?: string, validation?: unknown): OmdEnrichmentError {
  switch (kind) {
    case "unsupported_schema":
      return new OmdEnrichmentError("unsupported_schema", "Update OMD to a build that supports enrichment schema v1.");
    case "invalid_request":
      if (isCandidateEvidenceValidation(validation)) {
        return new OmdEnrichmentError("invalid_candidate_evidence", INVALID_CANDIDATE_EVIDENCE_MESSAGE);
      }
      return new OmdEnrichmentError("invalid_request", invalidRequestMessage(terminalMessage));
    case "path_outside_vault":
      return new OmdEnrichmentError("invalid_request", "OMD rejected a note path because it was outside this vault. Generate again from a note inside this vault.");
    case "note_not_found":
      return new OmdEnrichmentError("note_unavailable", "The target note or a suggested note is no longer available. Refresh the vault and generate again.");
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
      return new OmdEnrichmentError("invalid_response", invalidModelProposalMessage(terminalMessage));
    case "unknown_candidate_id":
      return new OmdEnrichmentError("invalid_response", "The local model selected a note outside the bounded candidate list. Generate again or choose another local writing model.");
    case "cancelled":
      return new OmdEnrichmentError("cancelled", "OMD enrichment was cancelled.");
    default:
      return new OmdEnrichmentError("omd_failed", "OMD enrichment failed. Check the local OMD output and try again.");
  }
}

function isCandidateEvidenceValidation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const validation = value as Record<string, unknown>;
  return validation.field === "candidate.evidence" && validation.reason === "incompatible_text";
}

function generationRecoveryDetail(error: unknown): string {
  if (!(error instanceof OmdEnrichmentError)) {
    return error instanceof LocalAiError
      ? "No proposal changes were written. Check Local AI setup, then try again."
      : "No proposal changes were written. Check OMD setup, then try again.";
  }
  switch (error.code) {
    case "invalid_response":
    case "invalid_event":
      return "No proposal changes were written. Generate again. If this repeats, choose another local writing model.";
    case "invalid_request":
      return "No proposal changes were written. Generate again from the current note. If this repeats, update OMD Home and OMD together.";
    case "generation_timeout":
      return "No proposal changes were written. Try again, or choose a smaller local writing model.";
    case "request_too_large":
    case "target_note_too_large":
      return "No proposal changes were written. Use a smaller note or reduce the bounded candidate set, then try again.";
    case "remote_host_not_allowed":
      return "No proposal changes were written. Use the configured loopback Ollama endpoint for local writing tools.";
    case "missing_executable":
    case "unsupported_capability":
    case "unsupported_schema":
    case "capability_invalid_json":
    case "capability_timeout":
      return "No proposal changes were written. Check OMD setup, then try again.";
    case "output_overflow":
    case "omd_failed":
      return "No proposal changes were written. Check Local AI and OMD setup, then try again.";
    default:
      return "No proposal changes were written. Review the error above, then try again.";
  }
}

function applyRecoveryDetail(error: unknown): string {
  if (error instanceof OmdEnrichmentError && error.code === "invalid_request") {
    return "Review your selection and the current note, then try again.";
  }
  return "Apply could not finish. Review the target note and its frontmatter before trying again.";
}

function invalidRequestMessage(detail: string | undefined): string {
  if (detail === "content_sha256 does not match note.content") {
    return "OMD rejected the note snapshot because its content check did not match. Generate a fresh proposal.";
  }
  return "OMD rejected the enrichment request. Generate again. If this repeats, update OMD Home and OMD together.";
}

function invalidModelProposalMessage(detail: string | undefined): string {
  switch (detail) {
    case "model selected an unknown vault tag":
    case "model classified an unknown vault tag as existing":
      return "The local model suggested a tag outside the current vault catalog. Generate again or choose another local writing model.";
    case "model selected an unknown evidence option":
    case "model evidence is not grounded in the source note":
      return "The local model returned a suggestion without valid note evidence. Generate again or choose another local writing model.";
    case "model selected an unknown candidate ID":
    case "model selected a candidate outside the bounded prompt catalog":
      return "The local model selected a note outside the bounded candidate list. Generate again or choose another local writing model.";
    case "Ollama did not return the required structured proposal":
    case "Ollama returned an invalid proposal":
      return "The local model did not return the required proposal format. Generate again or choose another local writing model.";
    default:
      return "The local model returned a proposal OMD could not validate. Generate again or choose another local writing model.";
  }
}

function safeOllamaModelName(model: string | undefined): model is string {
  return typeof model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(model);
}
