import { isOmdInboxNote, omdHomeStatus, type OmdHomeStatus } from "./inbox.ts";

export interface HomeNoteFileLike {
  path: string;
  basename: string;
  parent: { path: string } | null;
  stat: {
    ctime: number;
    mtime: number;
  };
}

export interface HomeNoteMetadata {
  frontmatter?: Record<string, unknown>;
  tags?: Iterable<string>;
}

export type HomeNoteTimeKind = "captured" | "updated";

export interface HomeNoteRow<TFile extends HomeNoteFileLike = HomeNoteFileLike> {
  file: TFile;
  path: string;
  title: string;
  parentPath: string;
  status: OmdHomeStatus | null;
  inbox: boolean;
  tags: string[];
  capturedAt: number | null;
  createdAt: number | null;
  updatedAt: number;
}

export interface HomeNoteDisplayTime {
  timestamp: number;
  kind: HomeNoteTimeKind;
}

export interface VisibleHomeNoteTags {
  visible: string[];
  remaining: number;
}

export function buildHomeNoteSnapshot<TFile extends HomeNoteFileLike>(
  files: readonly TFile[],
  metadataFor: (file: TFile) => HomeNoteMetadata,
  now = Date.now(),
): HomeNoteRow<TFile>[] {
  return files.map((file) => {
    const metadata = metadataFor(file);
    const frontmatter = metadata.frontmatter;
    return {
      file,
      path: file.path,
      title: file.basename,
      parentPath: file.parent?.path ?? "/",
      status: omdHomeStatus(frontmatter),
      inbox: isOmdInboxNote(file.path, frontmatter),
      tags: normalizeHomeNoteTags(metadata.tags ?? []),
      capturedAt: reliableCapturedAt(frontmatter?.captured_at, now),
      createdAt: validTimestamp(file.stat.ctime),
      updatedAt: validTimestamp(file.stat.mtime) ?? 0,
    };
  });
}

export function normalizeHomeNoteTags(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags.sort(compareText);
}

export function homeNoteDisplayTime(row: HomeNoteRow, context: "inbox" | "recent"): HomeNoteDisplayTime {
  if (context === "inbox") {
    if (row.capturedAt !== null) return { timestamp: row.capturedAt, kind: "captured" };
    if (row.createdAt !== null) return { timestamp: row.createdAt, kind: "captured" };
  }
  return { timestamp: row.updatedAt, kind: "updated" };
}

export function sortHomeNoteRows<TFile extends HomeNoteFileLike>(
  rows: readonly HomeNoteRow<TFile>[],
  context: "inbox" | "recent",
): HomeNoteRow<TFile>[] {
  return [...rows].sort((left, right) => {
    const timeDifference = homeNoteDisplayTime(right, context).timestamp
      - homeNoteDisplayTime(left, context).timestamp;
    return timeDifference || compareText(left.path, right.path);
  });
}

export function matchesHomeNoteTagFilters(tags: readonly string[], filters: Iterable<string>): boolean {
  const normalizedTags = tags.map(normalizeTagKey).filter((tag) => tag.length > 0);
  for (const value of filters) {
    const filter = normalizeTagKey(value);
    if (!filter) continue;
    if (!normalizedTags.some((tag) => tag === filter || tag.startsWith(`${filter}/`))) return false;
  }
  return true;
}

export function filterHomeNoteRows<TFile extends HomeNoteFileLike>(
  rows: readonly HomeNoteRow<TFile>[],
  filters: Iterable<string>,
): HomeNoteRow<TFile>[] {
  const selected = [...filters];
  if (!selected.length) return [...rows];
  return rows.filter((row) => matchesHomeNoteTagFilters(row.tags, selected));
}

export function homeNoteTagFilterOptions(rows: readonly HomeNoteRow[]): string[] {
  const options: string[] = [];
  for (const row of rows) {
    for (const tag of row.tags) {
      const segments = tag.split("/");
      for (let index = 1; index <= segments.length; index += 1) {
        options.push(segments.slice(0, index).join("/"));
      }
    }
  }
  return normalizeHomeNoteTags(options);
}

export function visibleHomeNoteTags(tags: readonly string[], limit = 2): VisibleHomeNoteTags {
  const visible = tags.slice(0, Math.max(0, limit));
  return { visible, remaining: Math.max(0, tags.length - visible.length) };
}

export function formatRelativeHomeNoteTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  const minute = 60_000;
  if (elapsed < minute) return "now";
  if (elapsed < 60 * minute) return `${Math.floor(elapsed / minute)}m ago`;
  const hour = 60 * minute;
  if (elapsed < 24 * hour) return `${Math.floor(elapsed / hour)}h ago`;
  const day = 24 * hour;
  if (elapsed < 7 * day) return `${Math.floor(elapsed / day)}d ago`;
  if (elapsed < 35 * day) return `${Math.floor(elapsed / (7 * day))}w ago`;
  if (elapsed < 365 * day) return `${Math.floor(elapsed / (30 * day))}mo ago`;
  return `${Math.floor(elapsed / (365 * day))}y ago`;
}

export function formatFullHomeNoteTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(timestamp));
}

function reliableCapturedAt(value: unknown, now: number): number | null {
  let timestamp: number | null = null;
  if (value instanceof Date) timestamp = value.getTime();
  else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(value.trim())) timestamp = Date.parse(value);
  else if (typeof value === "number") timestamp = value;
  const valid = validTimestamp(timestamp);
  if (valid === null || valid > now + 86_400_000) return null;
  return valid;
}

function validTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeTag(value: string): string {
  return value.normalize("NFC").trim().replace(/^#+/u, "").replace(/^\/+|\/+$/gu, "").replace(/\/{2,}/gu, "/");
}

function normalizeTagKey(value: string): string {
  return normalizeTag(value).toLowerCase();
}

function compareText(left: string, right: string): number {
  const folded = left.localeCompare(right, undefined, { sensitivity: "base" });
  return folded || (left < right ? -1 : left > right ? 1 : 0);
}
