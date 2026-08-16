import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_LINKS_END,
  MANAGED_LINKS_HEADING,
  MANAGED_LINKS_START,
  upsertManagedLinksBlock,
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
