import {
  ENRICH_NOTE_MAX_CANDIDATES,
  ENRICH_NOTE_MAX_EVIDENCE_CHARS,
  truncateCodePoints,
} from "./contract.ts";
import type { EnrichmentCandidate, EnrichmentRequest } from "./contract.ts";
import { EnrichmentError } from "./errors.ts";
import {
  inspectVaultRelativeMarkdownPath,
  normalizeRelativeMarkdownPath,
  type PathInspectionResult,
} from "./path-safety.ts";
import { buildEnrichmentRequest as buildBoundedRequest } from "./request-builder.ts";

// Function words cannot establish a useful relationship between note titles.
const LEXICAL_STOP_WORDS = new Set(
  "a an and are as at be been being but by can could did do does doing for from had has have how i if in into is it its of on or our should so than that the their them there these they this those through to too under up use used using very was we were what when where which while who will with would you your".split(" "),
);

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
  const pathBindings = new Map<string, PathInspectionResult>();

  for (const file of app.vault.getMarkdownFiles()) {
    const inspection = await inspectVaultRelativeMarkdownPath(vaultPath, file.path);
    if (!inspection.ok) continue;
    safeFiles.push(file);
    pathBindings.set(file.path, inspection);
  }

  const safeTarget = safeFiles.find((file) => file.path === targetFile.path);
  if (!safeTarget) {
    throw new EnrichmentError("invalid_request", "The selected note is not eligible for enrichment.");
  }

  const files = safeFiles.map((file) => metadataRecord(app, file, incoming.get(file.path) ?? []));
  const targetMetadata = files.find((entry) => entry.path === targetFile.path)!;
  await requireMatchingPathBinding(vaultPath, safeTarget.path, pathBindings.get(safeTarget.path));
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
    if (!samePathBinding(pathBindings.get(file.path), inspection)) continue;
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

async function requireMatchingPathBinding(
  vaultRoot: string,
  relativePath: string,
  expected: PathInspectionResult | undefined,
): Promise<void> {
  const current = await inspectVaultRelativeMarkdownPath(vaultRoot, relativePath);
  if (!samePathBinding(expected, current)) {
    throw new EnrichmentError("invalid_request", "The selected note changed during enrichment setup. Try again.");
  }
}

function samePathBinding(
  expected: PathInspectionResult | undefined,
  current: PathInspectionResult,
): boolean {
  return Boolean(
    expected?.ok
    && current.ok
    && expected.normalizedPath === current.normalizedPath
    && expected.absolutePath === current.absolutePath
    && expected.device === current.device
    && expected.inode === current.inode,
  );
}

export function buildEnrichmentCatalog(input: {
  target: EnrichmentFileRecord;
  files: EnrichmentFileRecord[];
  vaultTags: string[];
}): EnrichmentCatalogResult {
  const targetPath = normalizeRelativeMarkdownPath(input.target.path);
  if (!targetPath) throw new Error("Target note path is not safe for enrichment.");

  const target = { ...input.target, path: targetPath };
  const targetText = relevanceText(target.content).toLocaleLowerCase();
  const targetIdentityPhrases = new Set(normalizeIdentityPhrases([target.basename, ...target.aliases]));
  const targetIdentityTokens = new Set(normalizeTokens([target.basename, ...target.aliases]));
  const targetTags = new Set(normalizeVaultTags(target.tags).map((tag) => tag.toLocaleLowerCase()));
  const targetTokens = new Set(normalizeTokens([
    target.basename,
    ...target.aliases,
    targetText,
  ]));
  const targetOutgoing = new Set(target.outgoingLinks.map((value) => normalizeRelativeMarkdownPath(value)).filter(Boolean) as string[]);

  const candidates = input.files
    .filter((file) => file.path !== target.path)
    .map((file) => normalizeCandidate(file, target.path))
    .filter((file): file is EnrichmentFileRecord => Boolean(file))
    .map((file) => {
      const normalizedOutgoing = new Set(file.outgoingLinks.map((value) => normalizeRelativeMarkdownPath(value)).filter(Boolean) as string[]);
      const relationScore = (targetOutgoing.has(file.path) ? 2 : 0) + (normalizedOutgoing.has(target.path) ? 1 : 0);
      const candidatePhrases = normalizeIdentityPhrases([file.basename, ...file.aliases]);
      const exactMatchScore = candidatePhrases.reduce(
        (count, phrase) => count
          + (targetIdentityPhrases.has(phrase) ? 2 : 0)
          + (containsIdentityPhrase(targetText, phrase) ? 1 : 0),
        0,
      );
      const candidateIdentityTokens = new Set(normalizeTokens([file.basename, ...file.aliases]));
      const identityOverlap = countTokenOverlap(targetIdentityTokens, candidateIdentityTokens);
      const contentOverlap = countTokenOverlap(targetTokens, candidateIdentityTokens);
      const sharedTags = countTokenOverlap(targetTags, new Set(file.tags.map((tag) => tag.toLocaleLowerCase())));
      // A single incidental body word is weak evidence for a multiword title.
      // Shared tags are deliberate metadata; body mentions of e.g. "audio" are not.
      const lexicalOverlapScore = sharedTags + (identityOverlap > 0 || contentOverlap >= 2 ? contentOverlap : 0);
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
    .filter((candidate) => candidate.relationScore > 0 || candidate.exactMatchScore > 0 || candidate.lexicalOverlapScore > 0)
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
    return truncateCodePoints(cleaned, ENRICH_NOTE_MAX_EVIDENCE_CHARS);
  }

  return truncateCodePoints(withoutFrontmatter.trim(), ENRICH_NOTE_MAX_EVIDENCE_CHARS);
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
    || compareText(left.path, right.path)
  );
}

function compareText(left: string, right: string): number {
  const foldedLeft = left.toLocaleLowerCase();
  const foldedRight = right.toLocaleLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
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

function containsIdentityPhrase(text: string, phrase: string): boolean {
  const words = phrase.match(/[\p{Letter}\p{Number}]+/gu) ?? [];
  if (words.length === 0 || words.every((word) => LEXICAL_STOP_WORDS.has(word))) return false;
  if (containsUnsegmentedScript(phrase)) {
    return [...phrase].length >= 2 && text.includes(phrase);
  }
  let index = text.indexOf(phrase);
  while (index !== -1) {
    const before = index === 0 ? "" : text[index - 1] ?? "";
    const afterIndex = index + phrase.length;
    const after = afterIndex >= text.length ? "" : text[afterIndex] ?? "";
    if (!isIdentityCharacter(before) && !isIdentityCharacter(after)) return true;
    index = text.indexOf(phrase, index + phrase.length);
  }
  return false;
}

function containsUnsegmentedScript(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
}

function isIdentityCharacter(value: string): boolean {
  return value !== "" && /[\p{Letter}\p{Number}_]/u.test(value);
}

function normalizeTokens(values: string[]): string[] {
  return values
    .flatMap((value) => value.toLocaleLowerCase().split(/[^0-9\p{Letter}/_-]+/u))
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !LEXICAL_STOP_WORDS.has(token));
}

function relevanceText(content: string): string {
  return stripFrontmatter(content.replace(/^\uFEFF/u, ""))
    // OMD capture provenance and URL/query text describe transport, not the topic.
    .replace(/^>\s*\[Source\]\([^\n]*\)\s*·\s*Captured:[^\n]*$/gmu, "")
    .replace(/\]\([^\n)]*\)/gu, "]")
    .replace(/https?:\/\/[^\s<>]+/gu, "");
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
    outgoingLinks: dedupeStrings([
      ...Object.keys(app.metadataCache.resolvedLinks[file.path] ?? {}),
      ...(cache?.links ?? []).map((entry) => entry.link),
    ]),
    incomingLinks,
  };
}

function desktopVaultPath(adapter: unknown): string | null {
  if (!adapter || typeof adapter !== "object") return null;
  const candidate = adapter as { getBasePath?: unknown };
  if (typeof candidate.getBasePath !== "function") return null;
  const getBasePath = candidate.getBasePath as (this: unknown) => string;
  const value = getBasePath.call(adapter);
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
