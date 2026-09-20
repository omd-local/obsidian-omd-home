import assert from "node:assert/strict";
import test from "node:test";
import {
  capturedOutputVaultPath,
  isOmdInboxNote,
  omdHomeStatus,
  setOmdHomeStatusInMarkdown,
  waitForCapturedVaultFile,
} from "../src/inbox.ts";

test("OMD Home exposes only exact persisted workflow statuses", () => {
  assert.equal(omdHomeStatus({ omd_home_status: "inbox" }), "inbox");
  assert.equal(omdHomeStatus({ omd_home_status: "reviewed" }), "reviewed");
  assert.equal(omdHomeStatus({ omd_home_status: "Reviewed" }), null);
  assert.equal(omdHomeStatus({ omd_home_status: "pending" }), null);
  assert.equal(omdHomeStatus(undefined), null);
});

test("Inbox status includes captures anywhere and hides reviewed notes", () => {
  assert.equal(isOmdInboxNote("Sources/Web/article.md", { omd_home_status: "inbox" }), true);
  assert.equal(isOmdInboxNote("Inbox/legacy.md", undefined), true);
  assert.equal(isOmdInboxNote("Inbox/reviewed.md", { omd_home_status: "reviewed" }), false);
  assert.equal(isOmdInboxNote("Notes/ordinary.md", undefined), false);
});

test("capture output resolves only contained Markdown paths", () => {
  assert.equal(
    capturedOutputVaultPath("/Vault/Knowledge/Inbox/article.md", "/Vault/Knowledge"),
    "Inbox/article.md",
  );
  assert.equal(capturedOutputVaultPath("Sources/Web/article.md", "/Vault/Knowledge"), "Sources/Web/article.md");
  assert.equal(capturedOutputVaultPath("/Vault/Knowledge-elsewhere/article.md", "/Vault/Knowledge"), null);
  assert.equal(capturedOutputVaultPath("../outside.md", "/Vault/Knowledge"), null);
  assert.equal(capturedOutputVaultPath(".obsidian/plugins/note.md", "/Vault/Knowledge"), null);
  assert.equal(capturedOutputVaultPath("Inbox/article.html", "/Vault/Knowledge"), null);
});

test("capture output handles Windows paths without case-sensitive root failures", () => {
  assert.equal(
    capturedOutputVaultPath("c:\\Users\\Shion\\Vault\\Inbox\\note.md", "C:\\Users\\Shion\\Vault"),
    "Inbox/note.md",
  );
});

test("capture waits for Obsidian to index an externally-created note", async () => {
  const waits: number[] = [];
  let lookups = 0;
  const file = { path: "Sources/Documents/example.md" };

  const result = await waitForCapturedVaultFile(
    file.path,
    () => ++lookups === 3 ? file : null,
    [0, 25, 50, 100],
    async (delayMs) => { waits.push(delayMs); },
  );

  assert.equal(result, file);
  assert.equal(lookups, 3);
  assert.deepEqual(waits, [25, 50]);
});

test("capture stops waiting after the bounded indexing window", async () => {
  let lookups = 0;
  const result = await waitForCapturedVaultFile(
    "Sources/Documents/missing.md",
    () => { lookups += 1; return null; },
    [0, 10, 20],
    async () => undefined,
  );

  assert.equal(result, null);
  assert.equal(lookups, 3);
});

test("capture can mark Inbox status before Obsidian indexes the note", () => {
  const markdown = [
    "---",
    'title: "Example Domain"',
    'source_type: "webpage"',
    "---",
    "",
    "# Example Domain",
    "",
  ].join("\n");

  assert.equal(setOmdHomeStatusInMarkdown(markdown, "inbox"), [
    "---",
    'title: "Example Domain"',
    'source_type: "webpage"',
    "omd_home_status: inbox",
    "---",
    "",
    "# Example Domain",
    "",
  ].join("\n"));
});

test("capture Inbox status fallback preserves line endings and replaces an existing status", () => {
  const markdown = "\uFEFF---\r\nomd_home_status: reviewed\r\ntitle: Existing\r\n---\r\nBody\r\n";
  assert.equal(
    setOmdHomeStatusInMarkdown(markdown, "inbox"),
    "\uFEFF---\r\nomd_home_status: inbox\r\ntitle: Existing\r\n---\r\nBody\r\n",
  );
});

test("capture Inbox status fallback adds frontmatter without changing note content", () => {
  assert.equal(
    setOmdHomeStatusInMarkdown("# Plain note\n", "inbox"),
    "---\nomd_home_status: inbox\n---\n# Plain note\n",
  );
});

test("capture Inbox status fallback rejects malformed frontmatter", () => {
  assert.throws(
    () => setOmdHomeStatusInMarkdown("---\ntitle: Broken\n", "inbox"),
    /unclosed frontmatter/u,
  );
});
