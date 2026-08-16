export const MANAGED_LINKS_START = "<!-- omd-home:links:start -->";
export const MANAGED_LINKS_END = "<!-- omd-home:links:end -->";
export const MANAGED_LINKS_HEADING = "## Related notes";

export type ManagedBlockFailureReason = "duplicate-markers" | "malformed-markers" | "invalid-link";

export type ManagedBlockResult =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; reason: ManagedBlockFailureReason; message: string };

interface ScannedLine {
  text: string;
  start: number;
  end: number;
}

interface FenceState {
  marker: "`" | "~";
  length: number;
}

export function upsertManagedLinksBlock(content: string, links: string[]): ManagedBlockResult {
  const normalizedLinks: string[] = [];
  for (const link of links) {
    const trimmed = link.trim();
    if (!trimmed || /[\r\n]/u.test(trimmed)) {
      return { ok: false, reason: "invalid-link", message: "Managed links must each fit on one Markdown line." };
    }
    normalizedLinks.push(trimmed.startsWith("- ") ? trimmed : `- ${trimmed}`);
  }

  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = bom ? content.slice(1) : content;
  const eol = detectLineEnding(body);
  const block = [MANAGED_LINKS_START, MANAGED_LINKS_HEADING, ...normalizedLinks, MANAGED_LINKS_END].join(eol);
  const scanned = scanOutsideFences(body);
  const starts = scanned.filter((line) => line.text.trim() === MANAGED_LINKS_START);
  const ends = scanned.filter((line) => line.text.trim() === MANAGED_LINKS_END);

  if (starts.length > 1 || ends.length > 1) {
    return { ok: false, reason: "duplicate-markers", message: "Managed links block markers must appear at most once." };
  }
  if (starts.length !== ends.length || (starts[0] && ends[0] && ends[0].start <= starts[0].start)) {
    return { ok: false, reason: "malformed-markers", message: "Managed links block markers are incomplete." };
  }

  let nextBody: string;
  if (starts[0] && ends[0]) {
    nextBody = `${body.slice(0, starts[0].start)}${block}${body.slice(ends[0].end)}`;
  } else {
    const heading = scanned.find((line) => /^##[\t ]+Full Content(?:[\t ]+#+)?[\t ]*$/u.test(line.text));
    if (heading) {
      const prefix = body.slice(0, heading.start);
      const suffix = body.slice(heading.start);
      nextBody = `${prefix}${separatorBefore(prefix, eol)}${block}${eol}${eol}${suffix}`;
    } else {
      const trailing = body.match(/(?:\r\n|\n|\r)+$/u)?.[0] ?? "";
      const core = trailing ? body.slice(0, -trailing.length) : body;
      nextBody = `${core}${separatorBefore(core, eol)}${block}${trailing}`;
    }
  }

  const next = `${bom}${nextBody}`;
  return { ok: true, content: next, changed: next !== content };
}

export function applyManagedLinksBlock(content: string, links: string[]): { content: string; changed: boolean } {
  const result = upsertManagedLinksBlock(content, links);
  if (!result.ok) throw new Error(result.message);
  return result;
}

function scanOutsideFences(content: string): ScannedLine[] {
  const result: ScannedLine[] = [];
  const lines = scanLines(content);
  let fence: FenceState | null = null;
  for (const line of lines) {
    if (fence) {
      const closing = line.text.match(/^\s*(`+|~+)\s*$/u);
      if (closing?.[1]?.startsWith(fence.marker) && closing[1].length >= fence.length) fence = null;
      continue;
    }
    const opening = line.text.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (opening) {
      fence = { marker: opening[0] as "`" | "~", length: opening.length };
      continue;
    }
    result.push(line);
  }
  return result;
}

function scanLines(content: string): ScannedLine[] {
  const lines: ScannedLine[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const newline = findNextNewline(content, cursor);
    if (newline === -1) {
      lines.push({ text: content.slice(cursor), start: cursor, end: content.length });
      break;
    }
    const newlineLength = content[newline] === "\r" && content[newline + 1] === "\n" ? 2 : 1;
    lines.push({ text: content.slice(cursor, newline), start: cursor, end: newline });
    cursor = newline + newlineLength;
  }
  return lines;
}

function findNextNewline(content: string, start: number): number {
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === "\n" || content[index] === "\r") return index;
  }
  return -1;
}

function separatorBefore(prefix: string, eol: string): string {
  if (!prefix) return "";
  if (prefix.endsWith(`${eol}${eol}`)) return "";
  if (prefix.endsWith(eol)) return eol;
  return `${eol}${eol}`;
}

function detectLineEnding(content: string): string {
  return content.match(/\r\n|\n|\r/u)?.[0] ?? "\n";
}
