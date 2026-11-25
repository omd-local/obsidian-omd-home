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

test("README keeps privacy, dependency, and local and hosted AI disclosures aligned", () => {
  const readme = readText("README.md");
  assert.match(readme, /desktop-only/iu);
  assert.match(readme, /does not install, update,\s*or bundle OMD, Python, Ollama, or the EventKit helper/iu);
  assert.match(readme, /Google Calendar and Outlook Calendar can participate when they have already been added to\s*macOS Calendar/iu);
  assert.match(readme, /Review-first note enrichment sends only bounded note content/iu);
  assert.match(readme, /endpoint may use `localhost`, `127\.0\.0\.1`, or `\[::1\]` with an explicit custom\s*port/iu);
  assert.match(readme, /LAN and\s*remote hosts, credentials, paths, queries, fragments, proxies, and redirects\s*are rejected/iu);
  assert.match(readme, /Local answer mode, note enrichment, Polish Markdown, and local embedding-based\s*retrieval stay on loopback Ollama/iu);
  assert.match(readme, /every cloud answer request shows a preview with the selected provider,\s*model, and bounded evidence excerpts before anything leaves the device/iu);
  assert.match(readme, /sends only the question plus the selected local evidence snippets; it never sends the whole vault/iu);
  assert.match(readme, /there is no silent fallback across providers or auto-switch to another provider/iu);
  assert.match(readme, /\*\*Check setup\*\* for the selected provider, model, and safety boundary/iu);
  assert.match(readme, /\*\*Test semantic search\*\* for local retrieval/iu);
  assert.match(readme, /OMD Home: Refresh local AI models[\s\S]*?without changing the saved selection/iu);
  assert.match(readme, /Opening settings, checking setup, and asking a question never download\s*a model automatically/iu);
  assert.match(readme, /does not download models in the background, auto-select models, or\s*auto-switch providers/iu);
  assert.match(readme, /OMD Home does not require that setting for local model use, and\s*it never writes the file for you/iu);
  assert.doesNotMatch(readme, /Phase 1a local AI allows only the default local Ollama endpoints|requires Ollama Cloud to be disabled/iu);
  assert.match(readme, /Nothing is written until you explicitly press \*\*Apply\*\*/u);
});

test("README distinguishes public installation and backend compatibility from development previews", () => {
  const readme = readText("README.md");
  const publicVersion = readme.match(/PUBLIC BETA (\d+\.\d+\.\d+)/u)?.[1];
  assert.ok(publicVersion, "README must identify the public plugin release");
  assert.match(readme, /\]\(docs\/getting-started-mac\.md\)/u);
  assert.equal(existsSync(path.join(repoRoot, "docs/getting-started-mac.md")), true);
  assert.ok(readme.includes(`git clone --branch ${publicVersion} --single-branch https://github.com/omd-local/obsidian-omd-home.git`));
  assert.match(readme, /public Homebrew backend currently predates some interfaces used by Home/iu);
  assert.match(readme, /Before basic capture, clear both recognition preferences and turn off\s*> \*\*Polish Markdown\*\* and \*\*Review links and tags\*\*/iu);
  assert.match(readme, /public b4 backend does\s*not provide all of them/iu);
  assert.match(readme, /## Development previews\s+These are local development additions after public \*\*[^*]+\*\*, not features in\s*the release downloads or the pinned source-install command/u);
  assert.match(readme, /Actual iPhone-to-Mac\s*acceptance remains pending/iu);
  assert.match(readme, /Answer evidence verification[\s\S]*?native acceptance remain separate, unfinished checks/iu);
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
