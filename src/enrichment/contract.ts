import { createHash } from "node:crypto";
import { EnrichmentError } from "./errors.ts";

export const ENRICHMENT_SCHEMA_VERSION = 1;
export const ENRICH_NOTE_ACTION = "enrich_note_preview";
export const ENRICH_NOTE_SCHEMA_VERSION = ENRICHMENT_SCHEMA_VERSION;
export const MAX_REQUEST_BYTES = 512 * 1024;
export const MAX_TARGET_NOTE_BYTES = 64 * 1024;
export const MAX_CANDIDATES = 200;
export const MAX_VAULT_TAGS = 500;
export const MAX_EXISTING_LINKS = 20;
export const MAX_NEW_CONCEPTS = 12;
export const MAX_EXISTING_TAGS = 20;
export const MAX_NEW_TAGS = 12;
export const MAX_EVIDENCE_CHARS = 400;
export const MAX_WARNINGS = 16;
export const MAX_WARNING_CHARS = 160;

export const ENRICH_NOTE_REQUEST_LIMIT_BYTES = MAX_REQUEST_BYTES;
export const ENRICH_NOTE_TARGET_LIMIT_BYTES = MAX_TARGET_NOTE_BYTES;
export const ENRICH_NOTE_MAX_CANDIDATES = MAX_CANDIDATES;
export const ENRICH_NOTE_MAX_VAULT_TAGS = MAX_VAULT_TAGS;
export const ENRICH_NOTE_MAX_EVIDENCE_CHARS = MAX_EVIDENCE_CHARS;
export const ENRICH_NOTE_MAX_EXISTING_LINKS = MAX_EXISTING_LINKS;
export const ENRICH_NOTE_MAX_NEW_CONCEPTS = MAX_NEW_CONCEPTS;
export const ENRICH_NOTE_MAX_EXISTING_TAGS = MAX_EXISTING_TAGS;
export const ENRICH_NOTE_MAX_NEW_TAGS = MAX_NEW_TAGS;
export const ENRICH_NOTE_MAX_TITLE_CHARS = 256;
export const ENRICH_NOTE_MAX_CANDIDATE_ID_CHARS = 128;
export const ENRICH_NOTE_MAX_ALIAS_CHARS = 256;
export const ENRICH_NOTE_MAX_ALIASES = 32;
export const ENRICH_NOTE_MAX_TAG_CHARS = 128;
export const ENRICH_NOTE_MAX_CANDIDATE_TAGS = 64;
export const ENRICH_NOTE_MAX_MODEL_CHARS = 256;
export const ENRICH_NOTE_MAX_HOST_CHARS = 2048;
export const ENRICH_NOTE_MAX_PATH_CHARS = 512;
export const ENRICH_NOTE_MAX_REQUEST_ID_CHARS = 128;
export const ENRICH_NOTE_MAX_VAULT_PATH_CHARS = 4096;
export const ENRICH_NOTE_MAX_SUMMARY_CHARS = 1000;
export const ENRICH_NOTE_MAX_REASON_CHARS = 500;

export interface EnrichmentCandidate {
  id: string;
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  evidence: string;
}

export interface EnrichmentRequest {
  schema_version: 1;
  request_id: string;
  action: "enrich_note_preview";
  vault_path: string;
  note: {
    path: string;
    content: string;
    content_sha256: string;
  };
  candidates: EnrichmentCandidate[];
  vault_tags: string[];
  model: string;
  host: string;
}

export interface EnrichmentLinkSuggestion {
  candidate_id: string;
  target_path: string;
  display: string;
  reason: string;
  evidence: string;
  recommended: boolean;
}

export interface EnrichmentTagSuggestion {
  tag: string;
  reason: string;
  recommended?: boolean;
}

export interface EnrichmentConceptSuggestion {
  label: string;
  reason: string;
}

export interface EnrichmentResponse {
  schema_version: 1;
  request_id: string;
  action: "enrich_note_preview";
  note: {
    path: string;
    content_sha256: string;
  };
  proposal: {
    summary: string;
    existing_links: EnrichmentLinkSuggestion[];
    new_concepts: EnrichmentConceptSuggestion[];
    existing_tags: EnrichmentTagSuggestion[];
    new_tags: EnrichmentTagSuggestion[];
  };
  warnings: string[];
  generation: {
    provider: string;
    model: string;
    endpoint_class: "local_loopback" | "remote_https";
  };
}

export interface CapabilityResponse {
  enrich_note: {
    schema_versions: number[];
    supported: boolean;
  };
}

export interface EnrichmentEvent {
  v: 1;
  event: string;
  stage?: string;
  message?: string;
  request_id?: string;
  kind?: string;
  ts: number;
  [key: string]: unknown;
}

export type OmdEnrichRequest = EnrichmentRequest;
export type OmdEnrichResponse = EnrichmentResponse;
export type OmdEnrichCandidate = EnrichmentCandidate;
export type OmdEnrichEvent = EnrichmentEvent;
export type OmdCapabilitiesResponse = CapabilityResponse;
export type OmdCapabilities = CapabilityResponse;

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function utf8ByteLength(value: string): number {
  return utf8Bytes(value);
}

export function truncateCodePoints(value: string, limit: number): string {
  if (limit <= 0) return "";
  const codePoints = [...value];
  return codePoints.length <= limit ? value : codePoints.slice(0, limit).join("");
}

export async function sha256Utf8(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

export function sha256HexUtf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function ensureLoopbackHost(value: string): string {
  const url = parseHttpUrl(value, "host");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  if (url.username || url.password) {
    throw new EnrichmentError("remote_host_not_allowed", "OMD enrichment requires an Ollama base URL without embedded credentials.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EnrichmentError("remote_host_not_allowed", "OMD enrichment requires an HTTP loopback Ollama endpoint.");
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new EnrichmentError("remote_host_not_allowed", "OMD enrichment requires a base URL without a path, query, or fragment.");
  }
  if (!isLoopbackHostname(host)) {
    throw new EnrichmentError("remote_host_not_allowed", "Phase 2 enrichment only allows a loopback Ollama endpoint.");
  }
  return url.toString().replace(/\/$/u, "");
}

export function validateCapabilityResponse(value: unknown): CapabilityResponse {
  const record = expectRecord(value, "capabilities");
  const enrich = expectRecord(record.enrich_note, "capabilities.enrich_note");
  const schema_versions = expectArray(enrich.schema_versions, "capabilities.enrich_note.schema_versions")
    .map((entry, index) => expectNumber(entry, `capabilities.enrich_note.schema_versions[${index}]`));
  if (schema_versions.length > 16 || schema_versions.some((version) => !Number.isInteger(version) || version < 1)) {
    throw new EnrichmentError("invalid_response", "OMD returned invalid enrichment schema versions.");
  }
  const supported = expectBoolean(enrich.supported, "capabilities.enrich_note.supported");
  return {
    enrich_note: {
      schema_versions,
      supported,
    },
  };
}

export function capabilitySupportsEnrichNote(value: unknown): boolean {
  const capability = validateCapabilityResponse(value);
  return capability.enrich_note.supported && capability.enrich_note.schema_versions.includes(ENRICHMENT_SCHEMA_VERSION);
}

export function validateEnrichmentEvent(value: unknown): EnrichmentEvent {
  const record = expectRecord(value, "event");
  const version = expectNumber(record.v, "event.v");
  if (version !== ENRICHMENT_SCHEMA_VERSION) {
    throw new EnrichmentError("unsupported_schema", `OMD returned unsupported event schema v${version}.`);
  }
  const event = expectString(record.event, "event.event");
  const ts = expectNumber(record.ts, "event.ts");
  const normalized: EnrichmentEvent = { v: ENRICHMENT_SCHEMA_VERSION, event, ts };
  if (record.stage !== undefined) normalized.stage = expectString(record.stage, "event.stage");
  if (record.message !== undefined) normalized.message = expectString(record.message, "event.message");
  if (record.request_id !== undefined) normalized.request_id = expectString(record.request_id, "event.request_id");
  if (record.kind !== undefined) normalized.kind = expectString(record.kind, "event.kind");
  for (const [key, entry] of Object.entries(record)) {
    if (!(key in normalized)) normalized[key] = entry;
  }
  return normalized;
}

export function validateEnrichEvent(value: unknown): OmdEnrichEvent {
  return validateEnrichmentEvent(value);
}

export function validateEnrichmentResponse(
  value: unknown,
  request: EnrichmentRequest,
  catalogById: ReadonlyMap<string, EnrichmentCandidate>,
): EnrichmentResponse {
  const record = expectRecord(value, "response");
  const schema_version = expectNumber(record.schema_version, "response.schema_version");
  if (schema_version !== ENRICHMENT_SCHEMA_VERSION) {
    throw new EnrichmentError("unsupported_schema", `OMD returned unsupported schema v${schema_version}.`);
  }

  const request_id = expectString(record.request_id, "response.request_id");
  const action = expectString(record.action, "response.action");
  if (request_id !== request.request_id || action !== request.action) {
    throw new EnrichmentError("invalid_response", "OMD returned a response for a different request.");
  }

  const note = expectRecord(record.note, "response.note");
  const notePath = expectRelativeMarkdownPath(note.path, "response.note.path");
  const content_sha256 = expectSha256(note.content_sha256, "response.note.content_sha256");
  if (notePath !== request.note.path || content_sha256 !== request.note.content_sha256) {
    throw new EnrichmentError("invalid_response", "OMD returned a response for a different note revision.");
  }

  const proposal = expectRecord(record.proposal, "response.proposal");
  return {
    schema_version: ENRICHMENT_SCHEMA_VERSION,
    request_id,
    action: "enrich_note_preview",
    note: {
      path: notePath,
      content_sha256,
    },
    proposal: {
      summary: expectBoundedString(proposal.summary, ENRICH_NOTE_MAX_SUMMARY_CHARS, "response.proposal.summary", true),
      existing_links: validateExistingLinks(proposal.existing_links, request, catalogById),
      new_concepts: validateConceptSuggestions(proposal.new_concepts, request),
      existing_tags: validateTagSuggestions(
        proposal.existing_tags,
        MAX_EXISTING_TAGS,
        "response.proposal.existing_tags",
        "existing",
        request,
      ),
      new_tags: validateTagSuggestions(
        proposal.new_tags,
        MAX_NEW_TAGS,
        "response.proposal.new_tags",
        "new",
        request,
      ),
    },
    warnings: normalizeWarnings(record.warnings),
    generation: validateGeneration(record.generation),
  };
}

export function validateEnrichResponse(
  value: unknown,
  request: OmdEnrichRequest,
  catalogById: ReadonlyMap<string, OmdEnrichCandidate>,
): OmdEnrichResponse {
  return validateEnrichmentResponse(value, request, catalogById);
}

function validateExistingLinks(
  value: unknown,
  request: EnrichmentRequest,
  catalogById: ReadonlyMap<string, EnrichmentCandidate>,
): EnrichmentLinkSuggestion[] {
  const array = expectArray(value, "response.proposal.existing_links");
  if (array.length > MAX_EXISTING_LINKS) {
    throw new EnrichmentError("invalid_response", `OMD returned too many existing-note suggestions (${array.length}).`);
  }
  const seen = new Set<string>();
  return array.map((entry, index) => {
    const record = expectRecord(entry, `response.proposal.existing_links[${index}]`);
    const candidate_id = expectBoundedString(
      record.candidate_id,
      ENRICH_NOTE_MAX_CANDIDATE_ID_CHARS,
      `response.proposal.existing_links[${index}].candidate_id`,
    );
    const candidate = catalogById.get(candidate_id);
    if (!candidate) {
      throw new EnrichmentError("invalid_response", `OMD referenced unknown candidate: ${candidate_id}.`);
    }
    const target_path = expectRelativeMarkdownPath(record.target_path, `response.proposal.existing_links[${index}].target_path`);
    if (target_path !== candidate.path) {
      throw new EnrichmentError("invalid_response", `OMD returned a mismatched path for candidate ${candidate_id}.`);
    }
    if (seen.has(candidate_id)) {
      throw new EnrichmentError("invalid_response", "OMD returned a duplicate existing-note suggestion.");
    }
    seen.add(candidate_id);
    const display = expectBoundedString(
      record.display,
      ENRICH_NOTE_MAX_TITLE_CHARS,
      `response.proposal.existing_links[${index}].display`,
    );
    if (display !== candidate.title) {
      throw new EnrichmentError("invalid_response", `OMD returned a mismatched title for candidate ${candidate_id}.`);
    }
    const evidence = expectBoundedString(
      record.evidence,
      MAX_EVIDENCE_CHARS,
      `response.proposal.existing_links[${index}].evidence`,
    );
    if (!request.note.content.includes(evidence)) {
      throw new EnrichmentError("invalid_response", "OMD returned link evidence that is not present in the source note.");
    }
    return {
      candidate_id,
      target_path,
      display,
      reason: expectBoundedString(
        record.reason,
        ENRICH_NOTE_MAX_REASON_CHARS,
        `response.proposal.existing_links[${index}].reason`,
      ),
      evidence,
      recommended: expectBoolean(record.recommended, `response.proposal.existing_links[${index}].recommended`),
    };
  });
}

function validateConceptSuggestions(value: unknown, request: EnrichmentRequest): EnrichmentConceptSuggestion[] {
  const array = expectArray(value, "response.proposal.new_concepts");
  if (array.length > MAX_NEW_CONCEPTS) {
    throw new EnrichmentError("invalid_response", `OMD returned too many concept suggestions (${array.length}).`);
  }
  const candidateIdentities = new Set(
    request.candidates
      .flatMap((candidate) => [candidate.title, ...candidate.aliases])
      .map((identity) => identity.toLocaleLowerCase()),
  );
  const seen = new Set<string>();
  return array.map((entry, index) => {
    const record = expectRecord(entry, `response.proposal.new_concepts[${index}]`);
    const label = expectBoundedString(
      record.label,
      ENRICH_NOTE_MAX_TITLE_CHARS,
      `response.proposal.new_concepts[${index}].label`,
    );
    const key = label.toLocaleLowerCase();
    if (label.includes("[[") || label.includes("]]" ) || candidateIdentities.has(key) || seen.has(key)) {
      throw new EnrichmentError("invalid_response", "OMD returned an invalid or duplicate new concept.");
    }
    seen.add(key);
    return {
      label,
      reason: expectBoundedString(
        record.reason,
        ENRICH_NOTE_MAX_REASON_CHARS,
        `response.proposal.new_concepts[${index}].reason`,
      ),
    };
  });
}

function validateTagSuggestions(
  value: unknown,
  max: number,
  path: string,
  kind: "existing" | "new",
  request: EnrichmentRequest,
): EnrichmentTagSuggestion[] {
  const array = expectArray(value, path);
  if (array.length > max) {
    throw new EnrichmentError("invalid_response", `OMD returned too many tag suggestions (${array.length}).`);
  }
  const vaultTags = new Map(request.vault_tags.map((tag) => [tag.toLocaleLowerCase(), tag]));
  const seen = new Set<string>();
  return array.map((entry, index) => {
    const record = expectRecord(entry, `${path}[${index}]`);
    const rawTag = expectTag(record.tag, `${path}[${index}].tag`);
    const tag = kind === "new" ? normalizeGeneratedTag(rawTag) : rawTag;
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) {
      throw new EnrichmentError("invalid_response", `OMD returned an invalid or duplicate ${kind} tag suggestion.`);
    }
    if (kind === "new" && tag !== rawTag) {
      throw new EnrichmentError("invalid_response", "OMD returned a new tag that is not canonically normalized.");
    }
    if (kind === "existing" && vaultTags.get(key) !== tag) {
      throw new EnrichmentError("invalid_response", "OMD returned a tag that is not in the supplied vault tag catalog.");
    }
    if (kind === "new" && vaultTags.has(key)) {
      throw new EnrichmentError("invalid_response", "OMD classified an existing vault tag as new.");
    }
    seen.add(key);
    const suggestion: EnrichmentTagSuggestion = {
      tag,
      reason: expectBoundedString(record.reason, ENRICH_NOTE_MAX_REASON_CHARS, `${path}[${index}].reason`),
    };
    if (kind === "existing") {
      suggestion.recommended = expectBoolean(record.recommended, `${path}[${index}].recommended`);
    } else if (record.recommended !== undefined) {
      throw new EnrichmentError("invalid_response", "OMD returned an unsupported recommended flag for a new tag.");
    }
    return suggestion;
  });
}

function normalizeWarnings(value: unknown): string[] {
  const array = expectArray(value, "response.warnings");
  if (array.length > MAX_WARNINGS) {
    throw new EnrichmentError("invalid_response", "OMD returned too many enrichment warnings.");
  }
  return array.map((entry, index) => expectBoundedString(
    entry,
    MAX_WARNING_CHARS,
    `response.warnings[${index}]`,
  ));
}

function validateGeneration(value: unknown): EnrichmentResponse["generation"] {
  const record = expectRecord(value, "response.generation");
  const endpoint_class = expectString(record.endpoint_class, "response.generation.endpoint_class");
  if (endpoint_class !== "local_loopback") {
    throw new EnrichmentError("remote_host_not_allowed", "OMD enrichment returned a non-loopback generation endpoint.");
  }
  const provider = expectBoundedString(record.provider, 64, "response.generation.provider");
  if (provider !== "ollama") {
    throw new EnrichmentError("invalid_response", "OMD returned an unexpected generation provider.");
  }
  return {
    provider,
    model: expectBoundedString(record.model, ENRICH_NOTE_MAX_MODEL_CHARS, "response.generation.model"),
    endpoint_class,
  };
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be an object.`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be an array.`);
  }
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be a non-empty string.`);
  }
  return value;
}

function expectBoundedString(value: unknown, maxChars: number, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be ${allowEmpty ? "a string" : "a non-empty string"}.`);
  }
  const string = value;
  if ([...string].length > maxChars) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be at most ${maxChars} characters.`);
  }
  return string;
}

function expectNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be a finite number.`);
  }
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be a boolean.`);
  }
  return value;
}

function expectSha256(value: unknown, path: string): string {
  const string = expectString(value, path);
  if (!/^[0-9a-f]{64}$/u.test(string)) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be a SHA-256 hex digest.`);
  }
  return string;
}

function expectRelativeMarkdownPath(value: unknown, path: string): string {
  const string = expectBoundedString(value, ENRICH_NOTE_MAX_PATH_CHARS, path);
  if (string.startsWith("/") || string.includes("\\") || hasControlCharacter(string)) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be a vault-relative Markdown path.`);
  }
  const parts = string.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to stay outside hidden and parent paths.`);
  }
  if (!string.toLowerCase().endsWith(".md")) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to point to a Markdown note.`);
  }
  return string;
}

function expectTag(value: unknown, path: string): string {
  const string = expectBoundedString(value, ENRICH_NOTE_MAX_TAG_CHARS, path);
  if (!string || string.startsWith("#") || hasControlCharacter(string)) {
    throw new EnrichmentError("invalid_response", `Expected ${path} to be a valid tag.`);
  }
  return string;
}

function parseHttpUrl(value: string, path: string): URL {
  try {
    return new URL(value);
  } catch (error) {
    throw new EnrichmentError("remote_host_not_allowed", `Expected ${path} to be a valid HTTP URL.`, { cause: error as Error });
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/\.$/u, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (!/^127(?:\.\d{1,3}){3}$/u.test(host)) return false;
  return host.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function normalizeGeneratedTag(value: string): string {
  return value
    .trim()
    .replace(/^#+/u, "")
    .replace(/[ _]/gu, "-")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff/-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}
