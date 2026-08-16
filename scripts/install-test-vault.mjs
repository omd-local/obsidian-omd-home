import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const config = path.join(root, "test-vault", ".obsidian");
const plugin = path.join(config, "plugins", "omd-home");
await mkdir(path.join(plugin, "bridge"), { recursive: true });

for (const file of ["main.js", "styles.css", "manifest.json"]) {
  await copyFile(path.join(root, file), path.join(plugin, file));
}
await copyFile(path.join(root, "bridge", "omd_home_bridge.py"), path.join(plugin, "bridge", "omd_home_bridge.py"));
await copyFile(path.join(root, "dist", "omd-eventkit"), path.join(plugin, "omd-eventkit"));

const enabledPath = path.join(config, "community-plugins.json");
let enabled = [];
try { enabled = JSON.parse(await readFile(enabledPath, "utf8")); } catch {}
if (!Array.isArray(enabled)) enabled = [];
if (!enabled.includes("omd-home")) enabled.push("omd-home");
await writeFile(enabledPath, `${JSON.stringify(enabled, null, 2)}\n`);
await writeFile(path.join(config, "app.json"), "{}\n", { flag: "wx" }).catch(() => {});
console.log(`Installed OMD Home into ${plugin}`);
