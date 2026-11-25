export const OMD_HOME_STATUS_FIELD = "omd_home_status";

export type OmdHomeStatus = "inbox" | "reviewed";

const CAPTURE_INDEX_DELAYS_MS = [0, 50, 100, 200, 400, 800, 1_600, 2_000] as const;

export function omdHomeStatus(frontmatter: Record<string, unknown> | undefined): OmdHomeStatus | null {
  const status = frontmatter?.[OMD_HOME_STATUS_FIELD];
  return status === "inbox" || status === "reviewed" ? status : null;
}

export function isOmdInboxNote(
  path: string,
  frontmatter: Record<string, unknown> | undefined,
  legacyFolder = "Inbox",
): boolean {
  const status = omdHomeStatus(frontmatter);
  if (status === "reviewed") return false;
  if (status === "inbox") return true;
  const folder = normalizeRelativePath(legacyFolder);
  const notePath = normalizeRelativePath(path);
  return Boolean(folder) && notePath.startsWith(`${folder}/`);
}

export function capturedOutputVaultPath(output: string | null, vaultRoot: string): string | null {
  if (!output) return null;
  const raw = normalizeSlashes(output.trim());
  const root = normalizeSlashes(vaultRoot.trim()).replace(/\/+$/, "");
  if (!raw || !root || containsControlCharacter(raw)) return null;

  let relative = raw;
  if (isAbsolutePath(raw)) {
    const caseInsensitive = /^[A-Za-z]:\//u.test(root);
    const comparableRoot = caseInsensitive ? root.toLowerCase() : root;
    const comparableRaw = caseInsensitive ? raw.toLowerCase() : raw;
    if (!comparableRaw.startsWith(`${comparableRoot}/`)) return null;
    relative = raw.slice(root.length + 1);
  }

  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) return null;
  const normalized = segments.join("/");
  return normalized.toLowerCase().endsWith(".md") ? normalized : null;
}

export async function waitForCapturedVaultFile<T>(
  path: string,
  lookup: (path: string) => T | null,
  delays: readonly number[] = CAPTURE_INDEX_DELAYS_MS,
  pause: (delayMs: number) => Promise<void> = wait,
): Promise<T | null> {
  for (const delayMs of delays) {
    if (delayMs > 0) await pause(delayMs);
    const file = lookup(path);
    if (file !== null) return file;
  }
  return null;
}

export function setOmdHomeStatusInMarkdown(content: string, status: OmdHomeStatus): string {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = bom ? content.slice(1) : content;
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/u);
  const statusLine = `${OMD_HOME_STATUS_FIELD}: ${status}`;

  if (lines[0] !== "---") {
    return `${bom}---${lineEnding}${statusLine}${lineEnding}---${lineEnding}${source}`;
  }

  const frontmatterEnd = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
  if (frontmatterEnd < 0) {
    throw new Error("The captured note has an unclosed frontmatter block.");
  }

  const statusIndex = lines.findIndex((line, index) => (
    index > 0
    && index < frontmatterEnd
    && /^omd_home_status\s*:/u.test(line)
  ));
  if (statusIndex >= 0) {
    if (lines[statusIndex] === statusLine) return content;
    lines[statusIndex] = statusLine;
  } else {
    lines.splice(frontmatterEnd, 0, statusLine);
  }
  return `${bom}${lines.join(lineEnding)}`;
}

function normalizeRelativePath(value: string): string {
  return normalizeSlashes(value.trim()).replace(/^\/+|\/+$/g, "");
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//u.test(value);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
}
