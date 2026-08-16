export interface TagGroup {
  name: string;
  count: number;
  tags: Array<{ name: string; count: number }>;
}

export function groupTagCounts(values: Iterable<string>): TagGroup[] {
  const tagCounts = new Map<string, number>();
  for (const raw of values) {
    const tag = raw.trim().replace(/^#/, "").replace(/\/+$/, "");
    if (!tag) continue;
    tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const groups = new Map<string, TagGroup>();
  for (const [tag, count] of tagCounts) {
    const root = tag.split("/")[0] ?? tag;
    const group = groups.get(root) ?? { name: root, count: 0, tags: [] };
    group.count += count;
    group.tags.push({ name: tag, count });
    groups.set(root, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, tags: group.tags.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
