import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectVaultRelativeMarkdownPath, normalizeRelativeMarkdownPath } from "../src/enrichment/path-safety.ts";

test("normalizeRelativeMarkdownPath rejects hidden, absolute, and non-markdown paths", () => {
  assert.equal(normalizeRelativeMarkdownPath("Inbox/note.md"), "Inbox/note.md");
  assert.equal(normalizeRelativeMarkdownPath("../note.md"), null);
  assert.equal(normalizeRelativeMarkdownPath(".obsidian/note.md"), null);
  assert.equal(normalizeRelativeMarkdownPath("/abs/note.md"), null);
  assert.equal(normalizeRelativeMarkdownPath("Inbox/note.txt"), null);
});

test("inspectVaultRelativeMarkdownPath rejects symlink traversal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omd-home-safety-"));
  await mkdir(path.join(root, "Inbox"));
  await writeFile(path.join(root, "Inbox", "note.md"), "Hello", "utf8");
  await symlink(path.join(root, "Inbox", "note.md"), path.join(root, "Inbox", "alias.md"));
  const result = await inspectVaultRelativeMarkdownPath(root, "Inbox/alias.md");
  assert.equal(result.ok, false);
  assert.match(String(result.reason), /symlink/i);
});

test("inspectVaultRelativeMarkdownPath accepts contained markdown files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omd-home-safety-"));
  await mkdir(path.join(root, "Inbox"));
  await writeFile(path.join(root, "Inbox", "note.md"), "Hello", "utf8");
  const result = await inspectVaultRelativeMarkdownPath(root, "Inbox/note.md");
  assert.equal(result.ok, true);
  assert.equal(result.normalizedPath, "Inbox/note.md");
});
