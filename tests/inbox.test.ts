import assert from "node:assert/strict";
import test from "node:test";
import { capturedOutputVaultPath, isOmdInboxNote } from "../src/inbox.ts";

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
