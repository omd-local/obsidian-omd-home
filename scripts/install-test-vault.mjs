import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const config = path.join(root, "test-vault", ".obsidian");
const plugin = path.join(config, "plugins", "omd-home");
await mkdir(plugin, { recursive: true });

for (const file of ["main.js", "styles.css", "manifest.json"]) {
  await copyFile(path.join(root, file), path.join(plugin, file));
}
const eventKitSource = path.join(root, "dist", "omd-eventkit");
const eventKitDestination = path.join(plugin, "omd-eventkit");
if (await isExecutableFile(eventKitSource)) {
  await copyFile(eventKitSource, eventKitDestination);
  console.log(`Installed optional EventKit helper into ${eventKitDestination}`);
} else {
  console.log("Optional EventKit helper not found or not executable; skipping helper install.");
}

const dataPath = path.join(plugin, "data.json");
const siblingOmd = path.resolve(root, "..", "omd", ".venv", "bin", "omd");
try {
  await access(dataPath);
} catch {
  try {
    await access(siblingOmd);
    await writeFile(dataPath, `${JSON.stringify({ omdExecutable: siblingOmd }, null, 2)}\n`, { flag: "wx" });
  } catch {
    // A portable test install still works; the user can choose the OMD executable in settings.
  }
}

const enabledPath = path.join(config, "community-plugins.json");
let enabled = [];
try { enabled = JSON.parse(await readFile(enabledPath, "utf8")); } catch {}
if (!Array.isArray(enabled)) enabled = [];
if (!enabled.includes("omd-home")) enabled.push("omd-home");
await writeFile(enabledPath, `${JSON.stringify(enabled, null, 2)}\n`);
await writeFile(path.join(config, "app.json"), "{}\n", { flag: "wx" }).catch(() => {});
console.log(`Installed OMD Home into ${plugin}`);

async function isExecutableFile(targetPath) {
  try {
    const { constants } = await import("node:fs");
    const { stat } = await import("node:fs/promises");
    const details = await stat(targetPath);
    if (!details.isFile()) return false;
    await access(targetPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
