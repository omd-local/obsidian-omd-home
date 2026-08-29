import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/install-test-vault.mjs");

test("install:test-vault succeeds without a built EventKit helper", () => {
  const root = mkdtempSync(path.join(tmpdir(), "omd-home-install-no-helper-"));
  try {
    writeProjectFiles(root);
    const result = spawnSync("node", [scriptPath], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Optional EventKit helper not found or not executable/u);
    assert.equal(existsSync(path.join(root, "test-vault", ".obsidian", "plugins", "omd-home", "omd-eventkit")), false);
    assert.equal(existsSync(path.join(root, "test-vault", ".obsidian", "plugins", "omd-home", "main.js")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install:test-vault copies a built executable EventKit helper when present", () => {
  const root = mkdtempSync(path.join(tmpdir(), "omd-home-install-with-helper-"));
  try {
    writeProjectFiles(root);
    const helperPath = path.join(root, "dist", "omd-eventkit");
    writeFileSync(helperPath, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(helperPath, 0o755);

    const result = spawnSync("node", [scriptPath], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Installed optional EventKit helper/u);
    const installedHelper = path.join(root, "test-vault", ".obsidian", "plugins", "omd-home", "omd-eventkit");
    assert.equal(existsSync(installedHelper), true);
    assert.equal(readFileSync(installedHelper, "utf8"), "#!/bin/sh\nexit 0\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install:test-vault preserves an existing plugin data file on reinstall", () => {
  const root = mkdtempSync(path.join(tmpdir(), "omd-home-install-preserve-data-"));
  try {
    writeProjectFiles(root);
    const pluginPath = path.join(root, "test-vault", ".obsidian", "plugins", "omd-home");
    mkdirSync(pluginPath, { recursive: true });
    writeFileSync(path.join(pluginPath, "data.json"), "{\"openOnLaunch\":false}\n", "utf8");

    const result = spawnSync("node", [scriptPath], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(pluginPath, "data.json"), "utf8"), "{\"openOnLaunch\":false}\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeProjectFiles(root: string): void {
  mkdirSync(path.join(root, "dist"), { recursive: true });
  mkdirSync(path.join(root, "test-vault", ".obsidian"), { recursive: true });
  for (const relativePath of ["main.js", "styles.css", "manifest.json"]) {
    const targetPath = path.join(root, relativePath);
    writeFileSync(targetPath, `${relativePath}\n`, "utf8");
  }
  writeFileSync(path.join(root, "manifest.json"), "{\"id\":\"omd-home\"}\n", "utf8");
}
