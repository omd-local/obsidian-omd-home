export const OMD_HOME_STATUS_FIELD = "omd_home_status";

export type OmdHomeStatus = "inbox" | "reviewed";

export function isOmdInboxNote(
  path: string,
  frontmatter: Record<string, unknown> | undefined,
  legacyFolder = "Inbox",
): boolean {
  const status = frontmatter?.[OMD_HOME_STATUS_FIELD];
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
