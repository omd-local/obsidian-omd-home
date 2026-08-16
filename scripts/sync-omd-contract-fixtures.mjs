import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const accept = takeFlag(args, "--accept");
if (takeFlag(args, "--help")) {
  process.stdout.write("Usage: node scripts/sync-omd-contract-fixtures.mjs [OMD_ROOT] [--accept]\n");
  process.exit(0);
}
if (args.some((arg) => arg.startsWith("--")) || args.length > 1) {
  throw new Error("Usage: node scripts/sync-omd-contract-fixtures.mjs [OMD_ROOT] [--accept]");
}

const omdRoot = resolve(args[0] ?? resolve(root, "../omd"));
const source = resolve(omdRoot, "tests/fixtures/enrich_note/v1");
const destination = resolve(root, "tests/fixtures/enrich-note/v1");
const manifestPath = resolve(destination, "manifest.json");
const sourceLabel = "OMD tests/fixtures/enrich_note/v1";

const sourceFiles = await readFixtureDirectory(source);
if (!sourceFiles.size) throw new Error(`No OMD enrichment fixtures found at ${source}`);

const sourceCommit = readSourceCommit(omdRoot);
const sourceVersion = await readSourceVersion(omdRoot);
const nextManifest = {
  schema_version: 1,
  source: sourceLabel,
  source_version: sourceVersion,
  source_commit: sourceCommit,
  files: hashesFor(sourceFiles),
};

const currentFiles = await readFixtureDirectory(destination, true);
const currentManifest = await readCurrentManifest(manifestPath);
const changes = describeChanges(sourceFiles, currentFiles, nextManifest, currentManifest);

if (!changes.length) {
  process.stdout.write(`OMD enrichment fixtures are current at ${sourceVersion} (${sourceCommit}).\n`);
  process.exit(0);
}

process.stderr.write(`OMD enrichment contract fixtures changed:\n${changes.map((change) => `  - ${change}`).join("\n")}\n`);
if (!accept) {
  process.stderr.write("No files were written. Review the upstream contract, then rerun with --accept.\n");
  process.exit(1);
}

await replaceDestinationAtomically(destination, sourceFiles, nextManifest);
process.stdout.write(`Accepted ${sourceFiles.size} OMD enrichment fixtures from ${sourceVersion} (${sourceCommit}).\n`);

function takeFlag(values, flag) {
  const index = values.indexOf(flag);
  if (index === -1) return false;
  values.splice(index, 1);
  return true;
}

async function readFixtureDirectory(directory, allowMissing = false) {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return new Map();
    throw error;
  }
  const fixtureNames = names
    .filter((name) => name.endsWith(".json") && !name.startsWith("._") && name !== "manifest.json" && name !== "fixture-manifest.json")
    .sort();
  const files = new Map();
  for (const name of fixtureNames) files.set(name, await readFile(resolve(directory, name)));
  return files;
}

function readSourceCommit(directory) {
  let commit;
  try {
    commit = execFileSync("git", ["-C", directory, "rev-parse", "--verify", "HEAD^{commit}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().toLowerCase();
  } catch {
    throw new Error("Could not verify the upstream OMD source commit; fixture sync stopped without writing.");
  }
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new Error("The upstream OMD source commit is not a verifiable 40-character Git hash.");
  }
  return commit;
}

async function readSourceVersion(directory) {
  let pyproject;
  try {
    pyproject = await readFile(resolve(directory, "pyproject.toml"), "utf8");
  } catch {
    throw new Error("Could not read the upstream OMD version; fixture sync stopped without writing.");
  }
  const version = pyproject.match(/^\s*version\s*=\s*"([^"]+)"/mu)?.[1]?.trim();
  if (!version || version === "unknown") {
    throw new Error("Could not verify the upstream OMD version; fixture sync stopped without writing.");
  }
  return version;
}

async function readCurrentManifest(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

function hashesFor(files) {
  return Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)]));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function describeChanges(sourceFiles, currentFiles, nextManifest, currentManifest) {
  const changes = [];
  const sourceNames = new Set(sourceFiles.keys());
  const currentNames = new Set(currentFiles.keys());
  for (const name of [...sourceNames].filter((name) => !currentNames.has(name)).sort()) changes.push(`added fixture: ${name}`);
  for (const name of [...currentNames].filter((name) => !sourceNames.has(name)).sort()) changes.push(`removed fixture: ${name}`);
  for (const name of [...sourceNames].filter((entry) => currentNames.has(entry)).sort()) {
    if (sha256(sourceFiles.get(name)) !== sha256(currentFiles.get(name))) changes.push(`changed fixture: ${name}`);
  }
  if (!currentManifest) {
    changes.push("manifest is missing or invalid");
    return changes;
  }
  for (const key of ["schema_version", "source", "source_version", "source_commit"]) {
    if (currentManifest[key] !== nextManifest[key]) changes.push(`manifest ${key}: ${String(currentManifest[key])} -> ${String(nextManifest[key])}`);
  }
  if (JSON.stringify(currentManifest.files) !== JSON.stringify(nextManifest.files)) changes.push("manifest fixture hashes changed");
  return changes;
}

async function replaceDestinationAtomically(directory, files, manifest) {
  const parent = dirname(directory);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(resolve(parent, ".enrich-note-v1-staging-"));
  const backup = resolve(parent, `.enrich-note-v1-backup-${process.pid}-${Date.now()}`);
  let movedCurrent = false;
  try {
    for (const [name, bytes] of files) await writeFile(resolve(staging, name), bytes);
    await writeFile(resolve(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    if (await exists(directory)) {
      await rename(directory, backup);
      movedCurrent = true;
    }
    try {
      await rename(staging, directory);
    } catch (error) {
      if (movedCurrent) await rename(backup, directory);
      throw error;
    }
    if (movedCurrent) await rm(backup, { recursive: true, force: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
