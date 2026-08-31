export function isPinnedNote(pinnedNotes: readonly string[], path: string): boolean {
  const normalizedPath = path.trim();
  return normalizedPath.length > 0 && pinnedNotes.includes(normalizedPath);
}

export function setPinnedNote(
  pinnedNotes: readonly string[],
  path: string,
  pinned: boolean,
): string[] {
  const normalizedPath = path.trim();
  const normalizedNotes = [...new Set(pinnedNotes.map((note) => note.trim()).filter(Boolean))];
  if (!normalizedPath) return normalizedNotes;
  if (pinned) return normalizedNotes.includes(normalizedPath)
    ? normalizedNotes
    : [...normalizedNotes, normalizedPath];
  return normalizedNotes.filter((note) => note !== normalizedPath);
}
