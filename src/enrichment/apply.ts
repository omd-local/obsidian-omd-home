import { sha256HexUtf8 } from "./contract.ts";
import { OmdEnrichmentError } from "./errors.ts";
import { upsertManagedLinksBlock } from "./managed-block.ts";

export interface ApplyLinkCandidate {
  id: string;
  path: string;
  display: string;
}

export interface ApplyEnrichmentPlan {
  targetPath: string;
  originalContent: string;
  originalHash: string;
  linkCandidates: ApplyLinkCandidate[];
  selectedCandidateIds: string[];
  selectedTags: string[];
}

export type ApplyEnrichmentResult =
  | { status: "applied"; appliedLinks: number; appliedTags: number; changedBody: boolean }
  | { status: "conflict"; message: string; changedBody: false }
  | { status: "failed"; message: string; changedBody: false }
  | { status: "partial-failure"; message: string; changedBody: true };

export interface ApplyServices<FileRef> {
  resolveMarkdown(path: string): Promise<FileRef | null>;
  validate(file: FileRef): Promise<boolean>;
  read(file: FileRef): Promise<string>;
  process(file: FileRef, update: (current: string) => string): Promise<void>;
  processFrontMatter(file: FileRef, update: (frontmatter: Record<string, unknown>) => void): Promise<void>;
  generateMarkdownLink(file: FileRef, sourcePath: string, display: string): string;
  contentHash?: (content: string) => string;
}

export async function applyEnrichmentSelection<FileRef>(
  plan: ApplyEnrichmentPlan,
  services: ApplyServices<FileRef>,
): Promise<ApplyEnrichmentResult> {
  const selectedIds = unique(plan.selectedCandidateIds);
  const selectedTags = normalizeFrontmatterTags(plan.selectedTags);
  if (selectedIds.length + selectedTags.length === 0) {
    throw new OmdEnrichmentError("invalid_request", "Choose at least one link or tag before applying.");
  }
  const hash = services.contentHash ?? sha256HexUtf8;
  if (hash(plan.originalContent) !== plan.originalHash) {
    throw new OmdEnrichmentError("invalid_request", "The proposal snapshot hash is invalid. Generate a fresh proposal.");
  }

  const target = await services.resolveMarkdown(plan.targetPath);
  if (!target) return conflict("The target note is no longer available. Generate a fresh proposal.");

  const candidatesById = new Map(plan.linkCandidates.map((candidate) => [candidate.id, candidate]));
  const selectedCandidates: Array<{ candidate: ApplyLinkCandidate; file: FileRef }> = [];
  for (const id of selectedIds) {
    const candidate = candidatesById.get(id);
    if (!candidate) return conflict("A selected note no longer matches the reviewed proposal. Generate again.");
    const file = await services.resolveMarkdown(candidate.path);
    if (!file) return conflict("A selected note moved or became unavailable. Generate again.");
    selectedCandidates.push({ candidate, file });
  }
  selectedCandidates.sort((left, right) => compareText(left.candidate.path, right.candidate.path));
  if (!(await services.validate(target))) {
    return conflict("The target note changed after its path was validated. Generate a fresh proposal.");
  }
  for (const { file } of selectedCandidates) {
    if (!(await services.validate(file))) {
      return conflict("A selected note changed after its path was validated. Generate a fresh proposal.");
    }
  }

  let intermediateContent = plan.originalContent;
  let changedBody = false;
  if (selectedCandidates.length > 0) {
    const links = selectedCandidates.map(({ candidate, file }) => {
      const markdownLink = services.generateMarkdownLink(file, plan.targetPath, candidate.display).trim();
      if (!markdownLink || /[\r\n]/u.test(markdownLink)) {
        throw new OmdEnrichmentError("apply_failed", "Obsidian could not generate a safe Markdown link for one selection.");
      }
      return `- ${markdownLink}`;
    });
    let hashConflict = false;
    try {
      await services.process(target, (current) => {
        if (hash(current) !== plan.originalHash) {
          hashConflict = true;
          return current;
        }
        const result = upsertManagedLinksBlock(current, links);
        if (!result.ok) throw new OmdEnrichmentError("apply_failed", result.message);
        intermediateContent = result.content;
        changedBody = result.changed;
        return result.content;
      });
    } catch (error) {
      if (error instanceof OmdEnrichmentError && error.code === "note_conflict") {
        return conflict("The target note changed after its path was validated. Generate a fresh proposal.");
      }
      if (error instanceof OmdEnrichmentError) throw error;
      throw new OmdEnrichmentError("apply_failed", "OMD Home could not write the managed links block.", { cause: error as Error });
    }
    if (hashConflict) return conflict("The note changed after the proposal was generated. Generate again before applying.");
  } else {
    const current = await services.read(target);
    if (hash(current) !== plan.originalHash) return conflict("The note changed after the proposal was generated. Generate again before applying.");
  }

  let currentBeforeFrontmatter: string;
  try {
    currentBeforeFrontmatter = await services.read(target);
  } catch {
    if (!changedBody) return conflict("The target note changed before Apply could finish. Generate a fresh proposal.");
    return partialFailure(plan.targetPath);
  }
  if (currentBeforeFrontmatter !== intermediateContent) {
    if (!changedBody) return conflict("The note changed after the proposal was generated. Generate again before applying.");
    return partialFailure(plan.targetPath);
  }

  try {
    await services.processFrontMatter(target, (frontmatter) => {
      if (selectedTags.length > 0) frontmatter.tags = mergeTags(frontmatter.tags, selectedTags);
      frontmatter.omd_home_status = "reviewed";
    });
  } catch (error) {
    if (error instanceof OmdEnrichmentError && error.code === "note_conflict") {
      if (!changedBody) return conflict("The target note changed before Apply could finish. Generate a fresh proposal.");
      return partialFailure(plan.targetPath);
    }
    if (!changedBody) {
      return { status: "failed", changedBody: false, message: "The note was not changed because its frontmatter could not be updated." };
    }
    const rolledBack = await guardedRollback(target, intermediateContent, plan.originalContent, services);
    if (rolledBack) {
      return { status: "failed", changedBody: false, message: "Frontmatter could not be updated, so the managed links change was rolled back." };
    }
    return partialFailure(plan.targetPath);
  }

  return {
    status: "applied",
    appliedLinks: selectedCandidates.length,
    appliedTags: selectedTags.length,
    changedBody,
  };
}

export function normalizeFrontmatterTags(value: unknown): string[] {
  if (value === undefined || value === null || value === "") return [];
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!values) throw new OmdEnrichmentError("apply_failed", "The existing frontmatter tags use an unsupported shape.");
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== "string") throw new OmdEnrichmentError("apply_failed", "The existing frontmatter tags use an unsupported shape.");
    const tag = cleanTag(raw);
    if (!tag) continue;
    const identity = tag.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(tag);
  }
  return result;
}

export function mergeTags(existing: unknown, additions: string[]): string[] {
  const result = normalizeFrontmatterTags(existing);
  const seen = new Set(result.map((tag) => tag.toLocaleLowerCase()));
  for (const raw of additions) {
    const tag = cleanTag(raw);
    if (!tag) continue;
    const identity = tag.toLocaleLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(tag);
  }
  return result;
}

async function guardedRollback<FileRef>(
  target: FileRef,
  expectedIntermediate: string,
  originalContent: string,
  services: ApplyServices<FileRef>,
): Promise<boolean> {
  let rolledBack = false;
  try {
    await services.process(target, (current) => {
      if (current !== expectedIntermediate) return current;
      rolledBack = true;
      return originalContent;
    });
  } catch {
    return false;
  }
  return rolledBack;
}

function cleanTag(value: string): string {
  const tag = value.trim().replace(/^#+/u, "");
  if (!tag || [...tag].length > 128 || containsInvalidTagCharacter(tag)) {
    throw new OmdEnrichmentError("apply_failed", "A selected tag is not valid for Obsidian frontmatter.");
  }
  return tag;
}

function containsInvalidTagCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === " " || character === "," || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function conflict(message: string): ApplyEnrichmentResult {
  return { status: "conflict", changedBody: false, message };
}

function partialFailure(targetPath: string): ApplyEnrichmentResult {
  return {
    status: "partial-failure",
    changedBody: true,
    message: `Links may be present in ${targetPath}, but frontmatter was not finalized. Review the managed Related notes block before retrying.`,
  };
}

function compareText(left: string, right: string): number {
  const foldedLeft = left.toLocaleLowerCase();
  const foldedRight = right.toLocaleLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export {
  MANAGED_LINKS_END,
  MANAGED_LINKS_START,
  upsertManagedLinksBlock,
} from "./managed-block.ts";
