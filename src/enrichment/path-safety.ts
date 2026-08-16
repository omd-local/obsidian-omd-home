import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
// Dot-prefixed directories, including a custom Obsidian config directory,
// are rejected below. This set is only for non-hidden system directories.
const SYSTEM_COMPONENTS = new Set(["__MACOSX"]);

export interface PathInspectionResult {
  ok: boolean;
  normalizedPath: string | null;
  absolutePath: string | null;
  device: number | null;
  inode: number | null;
  reason: string | null;
}

export function normalizeRelativeMarkdownPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
  if (!normalized || normalized.startsWith("/") || WINDOWS_ABSOLUTE.test(normalized) || containsControlCharacter(normalized)) {
    return null;
  }
  if (!normalized.toLowerCase().endsWith(".md")) return null;

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.startsWith(".") || SYSTEM_COMPONENTS.has(segment)) {
      return null;
    }
  }
  return segments.join("/");
}

export function isEligibleMarkdownPath(value: string): boolean {
  return normalizeRelativeMarkdownPath(value) !== null;
}

export async function inspectVaultRelativeMarkdownPath(vaultRoot: string, relativePath: string): Promise<PathInspectionResult> {
  const normalizedPath = normalizeRelativeMarkdownPath(relativePath);
  if (!normalizedPath) {
    return rejected("path is not a safe vault-relative Markdown path");
  }

  try {
    const realVaultRoot = await realpath(vaultRoot);
    const components = normalizedPath.split("/");
    const lexicalTarget = path.resolve(realVaultRoot, ...components);
    if (!isContainedPath(realVaultRoot, lexicalTarget)) {
      return { ok: false, normalizedPath, absolutePath: lexicalTarget, device: null, inode: null, reason: "path escaped the vault root" };
    }

    let current = realVaultRoot;
    let device: number | null = null;
    let inode: number | null = null;
    for (const [index, component] of components.entries()) {
      current = path.join(current, component);
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        return { ok: false, normalizedPath, absolutePath: current, device: null, inode: null, reason: "symlink traversal is not allowed" };
      }
      const isLast = index === components.length - 1;
      if (!isLast && !stats.isDirectory()) {
        return { ok: false, normalizedPath, absolutePath: current, device: null, inode: null, reason: "path component is not a directory" };
      }
      if (isLast && !stats.isFile()) {
        return { ok: false, normalizedPath, absolutePath: current, device: null, inode: null, reason: "target is not a regular Markdown file" };
      }
      if (isLast) {
        device = stats.dev;
        inode = stats.ino;
      }
    }

    const realTarget = await realpath(lexicalTarget);
    if (!isContainedPath(realVaultRoot, realTarget)) {
      return { ok: false, normalizedPath, absolutePath: realTarget, device: null, inode: null, reason: "resolved path escaped the vault root" };
    }

    return { ok: true, normalizedPath, absolutePath: realTarget, device, inode, reason: null };
  } catch {
    return { ok: false, normalizedPath, absolutePath: null, device: null, inode: null, reason: "path could not be validated" };
  }
}

export function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (!relative) return true;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function rejected(reason: string): PathInspectionResult {
  return { ok: false, normalizedPath: null, absolutePath: null, device: null, inode: null, reason };
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
