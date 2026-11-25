import esbuild from "esbuild";
import { readFileSync } from "node:fs";
import process from "node:process";

const production = process.argv[2] === "production";
const fullcalendarNotice = readFileSync(new URL("./node_modules/fullcalendar/LICENSE.md", import.meta.url), "utf8").trim();
const preactNotice = readFileSync(new URL("./node_modules/preact/LICENSE", import.meta.url), "utf8").trim();
const thirdPartyNotices = [
  "OMD Home is licensed under the PolyForm Shield License 1.0.0:",
  "https://polyformproject.org/licenses/shield/1.0.0",
  "Required Notice: Copyright 2026 OMD Local contributors.",
  "",
  "Third-party notices for the production OMD Home bundle.",
  "",
  "FullCalendar and Temporal runtime packages:",
  "- fullcalendar",
  "- @fullcalendar/core",
  "- @full-ui/headless-calendar",
  "- temporal-polyfill",
  "- temporal-utils",
  "",
  fullcalendarNotice,
  "",
  "Preact runtime package:",
  "- preact",
  "",
  preactNotice,
].join("\n");
const context = await esbuild.context({
  entryPoints: { main: "src/main.ts", styles: "src/styles.css" },
  bundle: true,
  external: ["obsidian", "electron", "node:*"],
  format: "cjs",
  platform: "browser",
  loader: { ".py": "text" },
  target: "es2022",
  minify: production,
  banner: production ? { js: `/*!\n${thirdPartyNotices}\n*/` } : undefined,
  legalComments: production ? "eof" : "none",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outdir: ".",
  entryNames: "[name]",
  logLevel: "info",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
