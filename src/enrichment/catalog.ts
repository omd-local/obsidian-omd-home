import {
  ENRICH_NOTE_MAX_CANDIDATES,
  ENRICH_NOTE_MAX_EVIDENCE_CHARS,
} from "./contract.ts";
import type { EnrichmentCandidate, EnrichmentRequest } from "./contract.ts";
import { EnrichmentError } from "./errors.ts";
import { inspectVaultRelativeMarkdownPath, normalizeRelativeMarkdownPath } from "./path-safety.ts";
import { buildEnrichmentRequest as buildBoundedRequest } from "./request-builder.ts";

export interface EnrichmentFileRecord {
  path: string;
  basename: string;
  content: string;
  aliases: string[];
  tags: string[];
  outgoingLinks: string[];
  incomingLinks: string[];
}

export interface EnrichmentCatalogCandidate {
  id: string;
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  evidence: string;
  relationScore: number;
  exactMatchScore: number;
  lexicalOverlapScore: number;
}

export interface EnrichmentCatalogResult {
  target: EnrichmentFileRecord;
  candidates: EnrichmentCatalogCandidate[];
  vaultTags: string[];
}

interface MarkdownFileLike {
  path: string;
  basename: string;
}

interface FileCacheLike {
  frontmatter?: Record<string, unknown> | null;
  links?: Array<{ link: string }>;
  tags?: Array<{ tag: string }>;
}

interface EnrichmentAppLike {
  vault: {
    adapter: unknown;
    getMarkdownFiles(): MarkdownFileLike[];
    cachedRead(file: MarkdownFileLike): Promise<string>;
  };
  metadataCache: {
    resolvedLinks: Record<string, Record<string, number>>;
    getFileCache(file: MarkdownFileLike): FileCacheLike | null;
  };
}

export async function buildEnrichmentRequest(
  app: EnrichmentAppLike,
  targetFile: MarkdownFileLike,
  model: string,
  host: string,
): Promise<{ request: EnrichmentRequest; catalogById: ReadonlyMap<string, EnrichmentCandidate> }> {
  const adapter = app.vault.adapter;
  const vaultPath = desktopVaultPath(adapter);
  if (!vaultPath) {
    throw new EnrichmentError("vault_required", "OMD enrichment requires a desktop filesystem vault.");
  }

  const incoming = buildIncomingLinks(app.metadataCache.resolvedLinks);
  const safeFiles: MarkdownFileLike[] = [];

  for (const file of app.vault.getMarkdownFiles()) {
    const inspection = await inspectVaultRelativeMarkdownPath(vaultPath, file.path);
    if (!inspection.ok) continue;
    safeFiles.push(file);
  }

  const safeTarget = safeFiles.find((file) => file.path === targetFile.path);
  if (!safeTarget) {
    throw new EnrichmentError("invalid_request", "The selected note is not eligible for enrichment.");
  }

  const files = safeFiles.map((file) => metadataRecord(app, file, incoming.get(file.path) ?? []));
  const targetMetadata = files.find((entry) => entry.path === targetFile.path)!;
  const target = { ...targetMetadata, content: await app.vault.cachedRead(safeTarget) };
  const vaultTags = files.flatMap((file) => file.tags);

  const catalog = buildEnrichmentCatalog({
    target,
    files,
    vaultTags,
  });
  const fileByPath = new Map(safeFiles.map((file) => [file.path, file]));
  const candidates: EnrichmentCatalogCandidate[] = [];
  for (const candidate of catalog.candidates) {
    const file = fileByPath.get(candidate.path);
    if (!file) continue;
    const inspection = await inspectVaultRelativeMarkdownPath(vaultPath, file.path);
    if (!inspection.ok) continue;
    candidates.push({ ...candidate, evidence: extractEvidence(await app.vault.cachedRead(file)) });
  }
  const built = buildBoundedRequest({
    requestId: `enrich-${Date.now()}`,
    vaultPath,
    target: catalog.target,
    candidates,
    vaultTags: catalog.vaultTags,
    model,
    host,
  });

  return {
    request: built.request,
    catalogById: new Map(built.retainedCandidates.map((candidate) => [candidate.id, candidate])),
  };
}

export function buildEnrichmentCatalog(input: {
  target: EnrichmentFileRecord;
  files: EnrichmentFileRecord[];
  vaultTags: string[];
}): EnrichmentCatalogResult {
  const targetPath = normalizeRelativeMarkdownPath(input.target.path);
  if (!targetPath) throw new Error("Target note path is not safe for enrichment.");

  const target = { ...input.target, path: targetPath };
  const targetIdentityPhrases = new Set(normalizeIdentityPhrases([target.basename, ...target.aliases]));
  const targetTokens = new Set(normalizeTokens([target.basename, ...target.aliases, ...target.tags]));
  const targetOutgoing = new Set(target.outgoingLinks.map((value) => normalizeRelativeMarkdownPath(value)).filter(Boolean) as string[]);

  const candidates = input.files
    .filter((file) => file.path !== target.path)
    .map((file) => normalizeCandidate(file, target.path))
    .filter((file): file is EnrichmentFileRecord => Boolean(file))
    .map((file) => {
      const normalizedOutgoing = new Set(file.outgoingLinks.map((value) => normalizeRelativeMarkdownPath(value)).filter(Boolean) as string[]);
      const relationScore = (targetOutgoing.has(file.path) ? 2 : 0) + (normalizedOutgoing.has(target.path) ? 1 : 0);
      const candidatePhrases = normalizeIdentityPhrases([file.basename, ...file.aliases]);
      const exactMatchScore = candidatePhrases.reduce((count, phrase) => count + (targetIdentityPhrases.has(phrase) ? 1 : 0), 0);
      const lexicalOverlapScore = countTokenOverlap(
        targetTokens,
        new Set(normalizeTokens([file.basename, ...file.aliases, ...file.tags])),
      );
      return {
        id: "",
        path: file.path,
        title: file.basename,
        aliases: dedupeStrings(file.aliases),
        tags: dedupeStrings(file.tags),
        evidence: extractEvidence(file.content),
        relationScore,
        exactMatchScore,
        lexicalOverlapScore,
      } satisfies EnrichmentCatalogCandidate;
    })
    .sort(compareCandidates)
    .slice(0, ENRICH_NOTE_MAX_CANDIDATES)
    .map((candidate, index) => ({ ...candidate, id: `candidate-${index + 1}` }));

  return {
    target,
    candidates,
    vaultTags: normalizeVaultTags(input.vaultTags),
  };
}

export function extractEvidence(content: string): string {
  const withoutBom = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const withoutFrontmatter = stripFrontmatter(withoutBom);
  const paragraphs = withoutFrontmatter
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (/^(```|~~~)/u.test(paragraph)) continue;
    if (/^#{1,6}\s+\S/u.test(paragraph) && !/\n/u.test(paragraph)) continue;
    const cleaned = paragraph
      .replace(/^#+\s+/u, "")
      .replace(/^[-*]\s+/u, "")
      .trim();
    if (!cleaned) continue;
    return cleaned.slice(0, ENRICH_NOTE_MAX_EVIDENCE_CHARS);
  }

  return withoutFrontmatter.trim().slice(0, ENRICH_NOTE_MAX_EVIDENCE_CHARS);
}

export function normalizeVaultTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags.map((value) => value.trim().replace(/^#/u, "")).filter(Boolean)) {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result.slice(0, 500);
}

function normalizeCandidate(file: EnrichmentFileRecord, targetPath: string): EnrichmentFileRecord | null {
  const normalizedPath = normalizeRelativeMarkdownPath(file.path);
  if (!normalizedPath || normalizedPath === targetPath) return null;
  return {
    ...file,
    path: normalizedPath,
    aliases: dedupeStrings(file.aliases),
    tags: dedupeStrings(file.tags.map((tag) => tag.replace(/^#/u, ""))),
    outgoingLinks: file.outgoingLinks,
    incomingLinks: file.incomingLinks,
  };
}

function compareCandidates(left: EnrichmentCatalogCandidate, right: EnrichmentCatalogCandidate): number {
  return (
    right.relationScore - left.relationScore
    || right.exactMatchScore - left.exactMatchScore
    || right.lexicalOverlapScore - left.lexicalOverlapScore
    || left.path.localeCompare(right.path)
  );
}

function countTokenOverlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) count += 1;
  }
  return count;
}

function normalizeIdentityPhrases(values: string[]): string[] {
  return dedupeStrings(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean));
}

function normalizeTokens(values: string[]): string[] {
  return values
    .flatMap((value) => value.toLocaleLowerCase().split(/[^0-9\p{Letter}/_-]+/u))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return content;
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u);
  return match ? content.slice(match[0].length) : content;
}

function metadataRecord(
  app: EnrichmentAppLike,
  file: MarkdownFileLike,
  incomingLinks: string[],
): EnrichmentFileRecord {
  const cache = app.metadataCache.getFileCache(file);
  return {
    path: file.path,
    basename: file.basename,
    content: "",
    aliases: extractAliases(cache?.frontmatter),
    tags: extractTags(cache?.frontmatter, cache?.tags?.map((entry) => entry.tag) ?? []),
    outgoingLinks: (cache?.links ?? []).map((entry) => entry.link),
    incomingLinks,
  };
}

function desktopVaultPath(adapter: unknown): string | null {
  if (!adapter || typeof adapter !== "object") return null;
  const candidate = adapter as { getBasePath?: unknown };
  if (typeof candidate.getBasePath !== "function") return null;
  const value = candidate.getBasePath.call(adapter);
  return typeof value === "string" && value.length ? value : null;
}

function buildIncomingLinks(resolvedLinks: Record<string, Record<string, number>>): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const [source, targets] of Object.entries(resolvedLinks)) {
    for (const target of Object.keys(targets)) {
      const list = incoming.get(target) ?? [];
      list.push(source);
      incoming.set(target, list);
    }
  }
  return incoming;
}

function extractAliases(frontmatter: Record<string, unknown> | null | undefined): string[] {
  if (!frontmatter) return [];
  const aliases = frontmatter.aliases;
  if (Array.isArray(aliases)) {
    return aliases.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof aliases === "string") return [aliases];
  return [];
}

function extractTags(frontmatter: Record<string, unknown> | null | undefined, cacheTags: string[]): string[] {
  const tags = [...cacheTags];
  if (frontmatter) {
    const frontmatterTags = frontmatter.tags;
    if (Array.isArray(frontmatterTags)) {
      tags.push(...frontmatterTags.filter((entry): entry is string => typeof entry === "string"));
    } else if (typeof frontmatterTags === "string") {
      tags.push(frontmatterTags);
    }
  }
  return tags;
}
