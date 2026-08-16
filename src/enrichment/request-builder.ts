import path from "node:path";
import {
  ENRICH_NOTE_ACTION,
  ENRICH_NOTE_MAX_ALIASES,
  ENRICH_NOTE_MAX_ALIAS_CHARS,
  ENRICH_NOTE_MAX_CANDIDATES,
  ENRICH_NOTE_MAX_CANDIDATE_ID_CHARS,
  ENRICH_NOTE_MAX_CANDIDATE_TAGS,
  ENRICH_NOTE_MAX_EVIDENCE_CHARS,
  ENRICH_NOTE_MAX_HOST_CHARS,
  ENRICH_NOTE_MAX_MODEL_CHARS,
  ENRICH_NOTE_MAX_PATH_CHARS,
  ENRICH_NOTE_MAX_REQUEST_ID_CHARS,
  ENRICH_NOTE_MAX_TAG_CHARS,
  ENRICH_NOTE_MAX_TITLE_CHARS,
  ENRICH_NOTE_MAX_VAULT_PATH_CHARS,
  ENRICH_NOTE_MAX_VAULT_TAGS,
  ENRICH_NOTE_REQUEST_LIMIT_BYTES,
  ENRICH_NOTE_TARGET_LIMIT_BYTES,
  ensureLoopbackHost,
  sha256HexUtf8,
  truncateCodePoints,
  utf8ByteLength,
  type OmdEnrichCandidate,
  type OmdEnrichRequest,
} from "./contract.ts";
import type { EnrichmentCatalogCandidate, EnrichmentFileRecord } from "./catalog.ts";
import { OmdEnrichmentError } from "./errors.ts";
import { normalizeRelativeMarkdownPath } from "./path-safety.ts";

export interface BuildEnrichmentRequestResult {
  request: OmdEnrichRequest;
  retainedCandidates: EnrichmentCatalogCandidate[];
  retainedVaultTags: string[];
}

export interface BuildEnrichmentRequestInput {
  requestId: string;
  vaultPath: string;
  target: EnrichmentFileRecord;
  candidates: EnrichmentCatalogCandidate[];
  vaultTags: string[];
  model: string;
  host: string;
}

export function buildEnrichmentRequest(input: BuildEnrichmentRequestInput): BuildEnrichmentRequestResult {
  if (utf8ByteLength(input.target.content) > ENRICH_NOTE_TARGET_LIMIT_BYTES) {
    throw new OmdEnrichmentError("target_note_too_large", "This note exceeds OMD enrich-note v1's 64 KiB UTF-8 limit.");
  }

  const requestId = boundedRequired(input.requestId, "request ID", ENRICH_NOTE_MAX_REQUEST_ID_CHARS);
  const vaultPath = boundedRequired(input.vaultPath, "vault path", ENRICH_NOTE_MAX_VAULT_PATH_CHARS);
  if (!path.isAbsolute(vaultPath)) throw new OmdEnrichmentError("vault_required", "OMD enrichment requires an absolute desktop vault path.");
  const notePath = normalizeRelativeMarkdownPath(input.target.path);
  if (!notePath || [...notePath].length > ENRICH_NOTE_MAX_PATH_CHARS) {
    throw new OmdEnrichmentError("invalid_request", "The target note does not have a safe vault-relative Markdown path.");
  }
  const model = boundedRequired(input.model, "model", ENRICH_NOTE_MAX_MODEL_CHARS);
  const host = ensureLoopbackHost(boundedRequired(input.host, "Ollama endpoint", ENRICH_NOTE_MAX_HOST_CHARS));

  const retainedSourceCandidates = input.candidates.slice(0, ENRICH_NOTE_MAX_CANDIDATES);
  const candidates = retainedSourceCandidates.map((candidate) => normalizeCandidate(candidate, notePath));
  assertUnique(candidates.map((candidate) => candidate.id), "candidate IDs");
  assertUnique(candidates.map((candidate) => candidate.path), "candidate paths");
  let retainedVaultTags = normalizeTags(input.vaultTags).slice(0, ENRICH_NOTE_MAX_VAULT_TAGS);
  let retainedCandidates = [...retainedSourceCandidates];

  let request: OmdEnrichRequest = {
    schema_version: 1,
    request_id: requestId,
    action: ENRICH_NOTE_ACTION,
    vault_path: vaultPath,
    note: {
      path: notePath,
      content: input.target.content,
      content_sha256: sha256HexUtf8(input.target.content),
    },
    candidates,
    vault_tags: retainedVaultTags,
    model,
    host,
  };

  while (requestBytes(request) > ENRICH_NOTE_REQUEST_LIMIT_BYTES && request.candidates.length > 0) {
    request = { ...request, candidates: request.candidates.slice(0, -1) };
    retainedCandidates = retainedCandidates.slice(0, -1);
  }
  while (requestBytes(request) > ENRICH_NOTE_REQUEST_LIMIT_BYTES && request.vault_tags.length > 0) {
    request = { ...request, vault_tags: request.vault_tags.slice(0, -1) };
    retainedVaultTags = retainedVaultTags.slice(0, -1);
  }
  if (requestBytes(request) > ENRICH_NOTE_REQUEST_LIMIT_BYTES) {
    throw new OmdEnrichmentError("request_too_large", "This note cannot fit within OMD enrich-note v1's 512 KiB request limit.");
  }

  return { request, retainedCandidates, retainedVaultTags };
}

export function isLoopbackHttpUrl(value: string): boolean {
  try {
    ensureLoopbackHost(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeCandidate(candidate: EnrichmentCatalogCandidate, targetPath: string): OmdEnrichCandidate {
  const candidatePath = normalizeRelativeMarkdownPath(candidate.path);
  if (!candidatePath || candidatePath === targetPath || [...candidatePath].length > ENRICH_NOTE_MAX_PATH_CHARS) {
    throw new OmdEnrichmentError("invalid_request", "The candidate catalog contains an unsafe Markdown path.");
  }
  return {
    id: boundedRequired(candidate.id, "candidate ID", ENRICH_NOTE_MAX_CANDIDATE_ID_CHARS),
    path: candidatePath,
    title: truncateCodePoints(boundedRequired(candidate.title, "candidate title", 10_000), ENRICH_NOTE_MAX_TITLE_CHARS),
    aliases: normalizeStrings(candidate.aliases, ENRICH_NOTE_MAX_ALIASES, ENRICH_NOTE_MAX_ALIAS_CHARS),
    tags: normalizeTags(candidate.tags).slice(0, ENRICH_NOTE_MAX_CANDIDATE_TAGS),
    evidence: truncateCodePoints(candidate.evidence.trim(), ENRICH_NOTE_MAX_EVIDENCE_CHARS),
  };
}

function normalizeStrings(values: string[], itemLimit: number, characterLimit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = truncateCodePoints(raw.trim(), characterLimit);
    const identity = value.toLocaleLowerCase();
    if (!value || seen.has(identity) || containsDisallowedControl(value)) continue;
    seen.add(identity);
    result.push(value);
    if (result.length >= itemLimit) break;
  }
  return result;
}

function normalizeTags(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const normalized = normalizeGeneratedTag(raw);
    if (!normalized || normalized.length > ENRICH_NOTE_MAX_TAG_CHARS) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= ENRICH_NOTE_MAX_VAULT_TAGS) break;
  }
  return result;
}

function boundedRequired(value: string, label: string, characterLimit: number): string {
  const normalized = value.trim();
  if (!normalized || [...normalized].length > characterLimit || containsDisallowedControl(normalized)) {
    throw new OmdEnrichmentError("invalid_request", `The configured ${label} is invalid or exceeds its OMD v1 limit.`);
  }
  return normalized;
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values.map((value) => value.toLocaleLowerCase())).size !== values.length) {
    throw new OmdEnrichmentError("invalid_request", `The enrichment catalog contains duplicate ${label}.`);
  }
}

function requestBytes(request: OmdEnrichRequest): number {
  return utf8ByteLength(JSON.stringify(request));
}

function containsDisallowedControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function normalizeGeneratedTag(value: string): string {
  return value
    .trim()
    .replace(/^#+/u, "")
    .replace(/_/gu, "-")
    .replace(/ /gu, "-")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff/-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
