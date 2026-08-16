import {
  FileSystemAdapter,
  TFile,
  type App,
} from "obsidian";
import type { ApplyServices } from "./apply.ts";
import { OmdEnrichmentError } from "./errors.ts";
import { inspectVaultRelativeMarkdownPath, normalizeRelativeMarkdownPath } from "./path-safety.ts";

interface BoundMarkdownFile {
  file: TFile;
  path: string;
  absolutePath: string;
  device: number;
  inode: number;
}

export function desktopVaultRoot(app: App): string {
  if (!(app.vault.adapter instanceof FileSystemAdapter)) {
    throw new OmdEnrichmentError("vault_required", "OMD enrichment requires a desktop filesystem vault.");
  }
  return app.vault.adapter.getBasePath();
}

export function createObsidianApplyServices(
  app: App,
  vaultRoot = desktopVaultRoot(app),
): ApplyServices<BoundMarkdownFile> {
  const bind = async (relativePath: string): Promise<BoundMarkdownFile | null> => {
    const normalized = normalizeRelativeMarkdownPath(relativePath);
    if (!normalized) return null;
    const inspection = await inspectVaultRelativeMarkdownPath(vaultRoot, normalized);
    if (
      !inspection.ok
      || !inspection.absolutePath
      || inspection.device === null
      || inspection.inode === null
    ) return null;
    const file = app.vault.getFileByPath(normalized);
    if (!(file instanceof TFile)) return null;
    return {
      file,
      path: normalized,
      absolutePath: inspection.absolutePath,
      device: inspection.device,
      inode: inspection.inode,
    };
  };

  const validate = async (bound: BoundMarkdownFile): Promise<boolean> => {
    const inspection = await inspectVaultRelativeMarkdownPath(vaultRoot, bound.path);
    if (
      !inspection.ok
      || inspection.absolutePath !== bound.absolutePath
      || inspection.device !== bound.device
      || inspection.inode !== bound.inode
    ) return false;
    return app.vault.getFileByPath(bound.path) === bound.file;
  };

  const requireValid = async (bound: BoundMarkdownFile): Promise<TFile> => {
    if (!(await validate(bound))) {
      throw new OmdEnrichmentError("note_conflict", "A note changed after its filesystem path was validated.");
    }
    return bound.file;
  };

  return {
    resolveMarkdown: bind,
    validate,
    read: async (bound) => await app.vault.read(await requireValid(bound)),
    process: async (bound, update) => {
      await app.vault.process(await requireValid(bound), update);
    },
    processFrontMatter: async (bound, update) => {
      await app.fileManager.processFrontMatter(await requireValid(bound), (frontmatter) => {
        update(frontmatter as Record<string, unknown>);
      });
    },
    generateMarkdownLink: (bound, sourcePath, display) => app.fileManager.generateMarkdownLink(
      bound.file,
      sourcePath,
      undefined,
      display && display !== bound.file.basename ? display : undefined,
    ),
  };
}
