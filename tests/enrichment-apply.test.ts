import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_LINKS_END,
  MANAGED_LINKS_START,
  mergeTags,
  normalizeFrontmatterTags,
  upsertManagedLinksBlock,
} from "../src/enrichment/apply.ts";

test("upsertManagedLinksBlock inserts before a real Full Content heading", () => {
  const source = "# Note\n\nBody\n\n## Full Content\n\nMore";
  const result = upsertManagedLinksBlock(source, ["[[One]]", "[[Two]]"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, new RegExp(`${escape(MANAGED_LINKS_START)}[\\s\\S]*## Related notes[\\s\\S]*\\[\\[One\\]\\][\\s\\S]*## Full Content`));
  assert.equal(result.changed, true);
});

test("upsertManagedLinksBlock ignores fenced headings and replaces existing blocks idempotently", () => {
  const source = [
    "# Note",
    "```md",
    "## Full Content",
    "```",
    MANAGED_LINKS_START,
    "## Related notes",
    "- [[Old]]",
    MANAGED_LINKS_END,
    "",
  ].join("\n");
  const result = upsertManagedLinksBlock(source, ["[[New]]"]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /\-\s\[\[New\]\]/);
  assert.doesNotMatch(result.content, /\-\s\[\[Old\]\]/);
});

test("normalizeFrontmatterTags preserves unique tags case-insensitively", () => {
  assert.deepEqual(normalizeFrontmatterTags(["AI", "ai", "research"]), ["AI", "research"]);
  assert.deepEqual(mergeTags(["AI"], ["ai", "workflow"]), ["AI", "workflow"]);
});

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
