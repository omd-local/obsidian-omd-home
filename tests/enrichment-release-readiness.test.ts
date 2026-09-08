import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");

test("release metadata stays synchronized for Marketplace publishing", () => {
  const manifest = readJson<Record<string, unknown>>("manifest.json");
  const packageJson = readJson<Record<string, unknown>>("package.json");
  const versions = readJson<Record<string, string>>("versions.json");

  assert.equal(manifest.version, packageJson.version);
  assert.equal(versions[String(manifest.version)], manifest.minAppVersion);
  assert.equal(manifest.isDesktopOnly, true);
});

test("required Marketplace docs and notices exist", () => {
  for (const relativePath of ["LICENSE", "README.md", "SECURITY.md", "THIRD_PARTY_NOTICES", "docs/release-checklist.md"]) {
    assert.equal(existsSync(path.join(repoRoot, relativePath)), true, `${relativePath} must exist`);
  }
});

test("release artifacts are ignored in git and emitted exactly by the release workflow", () => {
  const gitignore = readText(".gitignore");
  assert.match(gitignore, /^\/main\.js$/mu);
  assert.match(gitignore, /^\/styles\.css$/mu);

  assert.equal(isTracked("main.js"), false);
  assert.equal(isTracked("styles.css"), false);
  assert.equal(isTracked("manifest.json"), true);

  const workflow = readText(".github/workflows/release.yml");
  assert.match(workflow, /tags:\s*\n\s*-\s*"\*"/u);
  assert.match(workflow, /manifest_version="\$\(node -p 'require\("\.\/manifest\.json"\)\.version'\)"/u);
  assert.doesNotMatch(workflow, /node -p \\"/u);
  assert.match(workflow, /test "\$tag" = "\$manifest_version"/u);
  assert.match(workflow, /subject-path:\s*\|\s*\n\s*main\.js\s*\n\s*manifest\.json\s*\n\s*styles\.css/u);
  assert.match(workflow, /gh release create "\$tag"[\s\S]*main\.js manifest\.json styles\.css/u);
  assert.match(workflow, /--verify-tag/u);
  assert.doesNotMatch(workflow, /--draft/u);
  assert.doesNotMatch(workflow, /steps\.styles/u);
});

test("build config externalizes Obsidian and node builtins for release bundles", () => {
  const esbuild = readText("esbuild.mjs");
  assert.match(esbuild, /external:\s*\[[\s\S]*"obsidian"/u);
  assert.match(esbuild, /external:\s*\[[\s\S]*"electron"/u);
  assert.match(esbuild, /external:\s*\[[\s\S]*"node:\*"/u);
  assert.match(esbuild, /loader:\s*\{\s*"\.py":\s*"text"\s*\}/u);
  assert.match(readText("src/main.ts"), /import embeddedPythonBridge from "\.\.\/bridge\/omd_home_bridge\.py"/u);
});

test("production bundles embed the licenses for every shipped third-party runtime", () => {
  const esbuild = readText("esbuild.mjs");
  const notices = readText("THIRD_PARTY_NOTICES");

  assert.match(esbuild, /readFileSync\(new URL\("\.\/node_modules\/fullcalendar\/LICENSE\.md", import\.meta\.url\), "utf8"\)/u);
  assert.match(esbuild, /readFileSync\(new URL\("\.\/node_modules\/preact\/LICENSE", import\.meta\.url\), "utf8"\)/u);
  assert.match(esbuild, /banner:\s*production\s*\?\s*\{\s*js:/u);
  assert.match(esbuild, /https:\/\/polyformproject\.org\/licenses\/shield\/1\.0\.0/u);
  assert.match(esbuild, /Required Notice: Copyright 2026 OMD Local contributors\./u);
  for (const bundledPackage of [
    "fullcalendar",
    "@fullcalendar/core",
    "@full-ui/headless-calendar",
    "temporal-polyfill",
    "temporal-utils",
    "preact",
  ]) {
    assert.match(notices, new RegExp(bundledPackage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  }
  assert.match(notices, /production `main\.js` banner/u);
});

test("README keeps privacy, dependency, and Phase 2 answer-provider disclosures aligned", () => {
  const readme = readText("README.md");
  assert.match(readme, /Obsidian desktop 1\.11\.4 or newer/iu);
  assert.match(readme, /desktop-only/iu);
  assert.match(readme, /does not install, update,\s*or bundle OMD, Python, Ollama, or the EventKit helper/iu);
  assert.match(readme, /Google Calendar and Outlook Calendar can participate when they have already been added to\s*macOS Calendar/iu);
  assert.match(readme, /Review-first note enrichment sends only bounded note content/iu);
  assert.match(readme, /supports explicit answer-provider setup for local Ollama on this computer,\s*Ollama Cloud through the local Ollama app,\s*OpenAI API,\s*Anthropic API,\s*and\s*DeepSeek API/iu);
  assert.match(readme, /Hosted providers are explicit\s+opt-ins: every cloud answer request shows a preview with the selected provider,\s*model, and bounded evidence excerpts before anything leaves the device/iu);
  assert.match(readme, /sends only the question plus the selected local evidence snippets; it never sends the whole vault/iu);
  assert.match(readme, /there is no silent fallback across providers or auto-switch to another provider/iu);
  assert.match(readme, /\*\*Check setup\*\* for the selected provider, model, and safety boundary/iu);
  assert.match(readme, /\*\*Test embeddings\*\* for local hybrid retrieval/iu);
  assert.match(readme, /On macOS, paste the actual API key into the password field and press\s+\*\*Save key\*\* to store it in macOS Keychain\. On Windows and\s+Linux, set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `DEEPSEEK_API_KEY`\s+before starting Obsidian/iu);
  assert.match(readme, /OpenAI API billing\s+stays separate from ChatGPT subscriptions, and Anthropic API billing stays\s+separate from Claude subscriptions/iu);
  assert.match(readme, /OMD Home: Refresh local AI models/iu);
  assert.match(readme, /does not auto-pull, auto-install, auto-select models, or auto-switch\s+providers/iu);
  assert.match(readme, /Capture writes the requested Markdown note immediately; only optional link and tag changes wait for review/iu);
  assert.match(readme, /Ollama API introduction/iu);
  assert.match(readme, /OpenAI API model docs/iu);
  assert.match(readme, /Anthropic API overview/iu);
  assert.match(readme, /DeepSeek API docs/iu);
  assert.match(readme, /Nothing is written until you explicitly press \*\*Apply\*\*/u);
  assert.match(readme, /A local file capture reads only\s+the external path you explicitly submit/iu);
  assert.match(readme, /read the detected OMD launcher's\s+first line only to identify its Python interpreter/iu);
});

test("fixture manifest records the synced upstream OMD contract provenance", () => {
  const manifest = readJson<Record<string, unknown>>("tests/fixtures/enrich-note/v1/manifest.json");
  assert.equal(manifest.schema_version, 1);
  assert.equal(typeof manifest.source, "string");
  assert.equal(typeof manifest.source_version, "string");
  assert.match(String(manifest.source_commit), /^[0-9a-f]{40}$/u);
  assert.equal(typeof manifest.files, "object");
  assert.ok(manifest.files && Object.keys(manifest.files as Record<string, unknown>).length >= 5);
});

test("fixture synchronization is review-gated and refuses unverifiable provenance", () => {
  const script = readText("scripts/sync-omd-contract-fixtures.mjs");
  assert.match(script, /const accept = takeFlag\(args, "--accept"\)/u);
  assert.match(script, /if \(!accept\) \{[\s\S]*No files were written[\s\S]*process\.exit\(1\)/u);
  assert.match(script, /\^\[0-9a-f\]\{40\}\$/u);
  assert.match(script, /replaceDestinationAtomically/u);
  assert.doesNotMatch(script, /sourceCommit = "unknown"/u);
});

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

function readText(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function isTracked(relativePath: string): boolean {
  const result = spawnSync("git", ["-C", repoRoot, "ls-files", "--error-unmatch", relativePath], {
    encoding: "utf8",
  });
  return result.status === 0;
}
