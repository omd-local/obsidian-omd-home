import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const omdRoot = resolve(process.argv[2] ?? resolve(root, "../omd"));
const source = resolve(omdRoot, "tests/fixtures/enrich_note/v1");
const destination = resolve(root, "tests/fixtures/enrich-note/v1");

const fixtureNames = (await readdir(source))
  .filter((name) => name.endsWith(".json") && !name.startsWith("._") && name !== "fixture-manifest.json")
  .sort();

if (!fixtureNames.length) throw new Error(`No OMD enrichment fixtures found at ${source}`);

await mkdir(destination, { recursive: true });
const hashes = {};
for (const name of fixtureNames) {
  const bytes = await readFile(resolve(source, name));
  await writeFile(resolve(destination, name), bytes);
  hashes[name] = createHash("sha256").update(bytes).digest("hex");
}

let sourceCommit = "unknown";
try {
  sourceCommit = execFileSync("git", ["-C", omdRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // A source archive can still be synchronized; hashes remain authoritative.
}

await writeFile(resolve(destination, "fixture-manifest.json"), `${JSON.stringify({
  schema_version: 1,
  source: "OMD tests/fixtures/enrich_note/v1",
  source_commit: sourceCommit,
  files: hashes,
}, null, 2)}\n`, "utf8");

process.stdout.write(`Synchronized ${fixtureNames.length} OMD enrichment fixtures from ${sourceCommit}.\n`);
