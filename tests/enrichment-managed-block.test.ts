import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_LINKS_END,
  MANAGED_LINKS_HEADING,
  MANAGED_LINKS_START,
  MANAGED_SUMMARY_END,
  MANAGED_SUMMARY_HEADING,
  MANAGED_SUMMARY_START,
  upsertManagedEnrichmentBlocks,
  upsertManagedLinksBlock,
  upsertManagedSummaryBlock,
  validateManagedSummaryText,
} from "../src/enrichment/managed-block.ts";

test("inserts managed links before the real Full Content heading", () => {
  const source = "# Note\n\n## Summary\nhello\n\n## Full Content\nbody\n";
  const result = upsertManagedLinksBlock(source, ["- [[Alpha]]", "- [[Beta]]"]);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.content, [
    "# Note",
    "",
    "## Summary",
    "hello",
    "",
    MANAGED_LINKS_START,
    MANAGED_LINKS_HEADING,
    "- [[Alpha]]",
    "- [[Beta]]",
    MANAGED_LINKS_END,
    "",
    "## Full Content",
    "body",
    "",
  ].join("\n"));
});

test("ignores Full Content headings inside fenced code blocks", () => {
  const source = "# Note\n\n```md\n## Full Content\n```\n";
  const result = upsertManagedLinksBlock(source, ["- [[Alpha]]"]);
  assert.equal(result.ok, true);
  assert.equal(result.content, [
    "# Note",
    "",
    "```md",
    "## Full Content",
    "```",
    "",
    MANAGED_LINKS_START,
    MANAGED_LINKS_HEADING,
    "- [[Alpha]]",
    MANAGED_LINKS_END,
    "",
  ].join("\n"));
});

test("does not treat tilde fences as closing a backtick fence", () => {
  const source = "# Note\n\n```md\n~~~\n## Full Content\n```\n";
  const result = upsertManagedLinksBlock(source, ["- [[Alpha]]"]);
  assert.equal(result.ok, true);
  assert.equal(result.content, [
    "# Note",
    "",
    "```md",
    "~~~",
    "## Full Content",
    "```",
    "",
    MANAGED_LINKS_START,
    MANAGED_LINKS_HEADING,
    "- [[Alpha]]",
    MANAGED_LINKS_END,
    "",
  ].join("\n"));
});

test("replaces an existing managed block idempotently", () => {
  const source = [
    "# Note",
    "",
    MANAGED_LINKS_START,
    MANAGED_LINKS_HEADING,
    "- [[Old]]",
    MANAGED_LINKS_END,
    "",
    "## Full Content",
    "body",
    "",
  ].join("\n");
  const first = upsertManagedLinksBlock(source, ["- [[New]]"]);
  assert.equal(first.ok, true);
  const second = upsertManagedLinksBlock(first.content, ["- [[New]]"]);
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});

test("fails closed on duplicate markers", () => {
  const source = [
    MANAGED_LINKS_START,
    "- [[One]]",
    MANAGED_LINKS_END,
    "",
    MANAGED_LINKS_START,
    "- [[Two]]",
    MANAGED_LINKS_END,
  ].join("\n");
  const result = upsertManagedLinksBlock(source, ["- [[Alpha]]"]);
  assert.deepEqual(result, {
    ok: false,
    reason: "duplicate-markers",
    message: "Managed links block markers must appear at most once.",
  });
});

test("fails closed on malformed markers", () => {
  const source = `${MANAGED_LINKS_START}\n- [[One]]\n`;
  const result = upsertManagedLinksBlock(source, ["- [[Alpha]]"]);
  assert.deepEqual(result, {
    ok: false,
    reason: "malformed-markers",
    message: "Managed links block markers are incomplete.",
  });
});

test("preserves BOM, CRLF, and trailing newlines", () => {
  const source = "\uFEFF# Note\r\n\r\n## Full Content\r\nbody\r\n\r\n";
  const result = upsertManagedLinksBlock(source, ["- [[Alpha]]"]);
  assert.equal(result.ok, true);
  assert.equal(result.content.startsWith("\uFEFF"), true);
  assert.equal(result.content.includes("\r\n"), true);
  assert.equal(result.content.endsWith("\r\n\r\n"), true);
});

test("summary and links are composed in a stable managed order", () => {
  const source = "# Note\n\nBody\n\n## Full Content\ntext\n";
  const result = upsertManagedEnrichmentBlocks(source, {
    summary: "A concise summary.\n\nSecond paragraph.",
    links: ["- [[Alpha]]"],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.content, [
    "# Note",
    "",
    "Body",
    "",
    MANAGED_SUMMARY_START,
    MANAGED_SUMMARY_HEADING,
    "A concise summary.",
    "",
    "Second paragraph.",
    MANAGED_SUMMARY_END,
    "",
    MANAGED_LINKS_START,
    MANAGED_LINKS_HEADING,
    "- [[Alpha]]",
    MANAGED_LINKS_END,
    "",
    "## Full Content",
    "text",
    "",
  ].join("\n"));
  const repeated = upsertManagedEnrichmentBlocks(result.content, {
    summary: "A concise summary.\n\nSecond paragraph.",
    links: ["- [[Alpha]]"],
  });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.changed, false);
});

test("summary-only insertion preserves BOM, CRLF, and fenced lookalikes", () => {
  const source = `\uFEFF# Note\r\n\r\n\`\`\`md\r\n## Summary\r\n${MANAGED_SUMMARY_START}\r\n\`\`\`\r\n\r\n## Full Content\r\nbody\r\n\r\n`;
  const result = upsertManagedSummaryBlock(source, "中文摘要。\nملخص عربي.");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.content.startsWith("\uFEFF"), true);
  assert.equal(result.content.includes("中文摘要。\r\nملخص عربي."), true);
  assert.equal(result.content.endsWith("\r\n\r\n"), true);
});

test("summary insertion fails closed on an unmanaged Summary section", () => {
  const source = "# Note\n\n## Summary\nUser-authored text.\n\n## Full Content\nBody\n";
  assert.deepEqual(upsertManagedSummaryBlock(source, "Generated text."), {
    ok: false,
    reason: "summary-heading-collision",
    message: "This note already has a Summary section that OMD Home does not manage. Rename it or add the summary manually.",
  });
});

test("summary blocks fail closed on malformed markers and unsafe drafts", () => {
  const malformed = `${MANAGED_SUMMARY_START}\n${MANAGED_SUMMARY_HEADING}\nText\n`;
  assert.deepEqual(upsertManagedSummaryBlock(malformed, "New text"), {
    ok: false,
    reason: "malformed-markers",
    message: "Managed summary block markers are incomplete.",
  });
  assert.equal(validateManagedSummaryText("   ").ok, false);
  assert.equal(validateManagedSummaryText("<script>alert(1)</script>").ok, false);
  assert.equal(validateManagedSummaryText(`unsafe ${MANAGED_LINKS_START}`).ok, false);
  assert.equal(validateManagedSummaryText("a".repeat(1_001)).ok, false);
  assert.deepEqual(validateManagedSummaryText("English 中文 العربية"), {
    ok: true,
    summary: "English 中文 العربية",
  });
});
