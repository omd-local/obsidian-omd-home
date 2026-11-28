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
  assert.match(workflow, /--draft/u);
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
  assert.match(readme, /OMD Home does not download models, auto-select models, or auto-switch providers/iu);
  assert.match(readme, /Model installation commands are copied for you to run independently in Terminal/iu);
  assert.match(readme, /OMD Home does not require that setting for local model use, and\s*it never writes the file for you/iu);
  assert.doesNotMatch(readme, /Phase 1a local AI allows only the default local Ollama endpoints|requires Ollama Cloud to be disabled/iu);
  assert.match(readme, /Nothing is written until you explicitly press \*\*Apply\*\*/u);
});


test("Mac installation guides match the plugin and paired backend release", () => {
  const readme = readText("README.md");
  const version = String(readJson<Record<string, unknown>>("manifest.json").version);
  assert.equal(readme.match(/PUBLIC BETA (\d+\.\d+\.\d+)/u)?.[1], version);
  assert.ok(readme.includes(`git clone --branch ${version} --single-branch https://github.com/omd-local/obsidian-omd-home.git`));
  for (const guide of ["docs/getting-started-mac.md", "docs/getting-started-mac.en.md"]) {
    assert.ok(readme.includes(`](${guide})`));
    const content = readText(guide);
    for (const asset of ["main.js", "manifest.json", "styles.css"]) {
      assert.ok(content.includes(`/releases/download/${version}/${asset}`), `${guide} must pin ${asset} to ${version}`);
    }
    assert.match(content, /0\.3\.0b5/u);
    assert.doesNotMatch(content, /iphone-direct-capture\.md|evidence-verification\.md/u);
  }
  assert.match(readme, /markdown-everything\/releases\/tag\/v0\.3\.0b5/u);
  assert.doesNotMatch(readme, /public Homebrew backend currently predates|clear both recognition preferences|iphone-direct-capture\.md|evidence-verification\.md/iu);
  for (const prototype of ["src/direct-capture.ts", "src/evidence-verification.ts", "src/evidence-verification-schema.ts"]) {
    assert.equal(existsSync(path.join(repoRoot, prototype)), false, `${prototype} must stay outside the Mac release`);
  }
});

test("release docs keep social single-source and local-batch boundaries explicit", () => {
  const readme = readText("README.md");
  const captureFlow = readText("docs/assets/omd-home-capture-flow.svg");
  const backlog = readText("docs/ui-backlog.md");
  const releaseChecklist = readText("docs/release-checklist.md");

  assert.match(
    readme,
    /paste a common Douyin or Xiaohongshu \/ Rednote share message that contains\s+exactly one HTTP\(S\) URL/iu,
  );
  assert.match(
    readme,
    /Share-message extraction is deliberately limited to Douyin and Xiaohongshu \/\s+Rednote\. Paste an ordinary webpage URL by itself/iu,
  );
  assert.match(
    readme,
    /saves only these local paths[\s\S]{0,180}Cookie\s+contents are used by local OMD only for matching approved platform HTTPS\s+requests; they are never sent to AI providers/iu,
  );
  assert.match(readme, /Local folder and one-item-per-line batch capture are not connected in OMD Home/iu);
  assert.match(captureFlow, /Check source\/access/iu);
  assert.match(captureFlow, /URL \/ SHARE TEXT/iu);
  assert.match(captureFlow, /LOCAL FILE/iu);

  for (const issue of ["CAPTURE-01", "CAPTURE-02"]) {
    const start = backlog.indexOf(`### ${issue}`);
    assert.notEqual(start, -1, `${issue} must remain in the backlog`);
    const end = backlog.indexOf("\n### ", start + 4);
    const section = backlog.slice(start, end === -1 ? undefined : end);
    assert.match(section, /\*\*状态：[^\n]*(?:待复测|待完成)[^\n]*\*\*/u);
    assert.match(section, /\*\*验收标准：\*\*/u);
  }

  const batchStart = backlog.indexOf("### CAPTURE-03");
  assert.notEqual(batchStart, -1, "CAPTURE-03 must remain in the backlog");
  const batchSection = backlog.slice(batchStart, backlog.indexOf("\n## ", batchStart + 4));
  assert.match(batchSection, /\*\*状态：Deferred。优先级：P2/u);
  assert.match(batchSection, /Local batches/iu);

  assert.match(
    releaseChecklist,
    /Douyin\/XHS share text is accepted only with one HTTP\(S\) URL and the exact advertised provider cookie flag/iu,
  );
  assert.match(releaseChecklist, /Folder\/list batches remain explicitly unsupported/iu);
});

test("deferred Obsidian graph enhancements remain in the P2 backlog", () => {
  const backlog = readText("docs/ui-backlog.md");
  for (const issue of ["UI-07", "UI-08", "UI-09", "UI-10", "UI-11"]) {
    const start = backlog.indexOf(`### ${issue}`);
    assert.notEqual(start, -1, `${issue} must remain in the backlog`);
    const end = backlog.indexOf("\n### ", start + 4);
    const section = backlog.slice(start, end === -1 ? undefined : end);
    assert.match(section, /\*\*状态：Deferred。优先级：P2/u);
    assert.match(section, /\*\*验收标准：\*\*/u);
  }
});

test("Markdown metadata changes refresh Home workflow status", () => {
  const main = readText("src/main.ts");
  assert.match(
    main,
    /metadataCache\.on\("changed", \(file\) => \{[\s\S]*if \(file\.extension === "md"\) this\.refreshHomeViews\(\);[\s\S]*\}\)\)/u,
  );
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
