import esbuild from "esbuild";
import { readFileSync } from "node:fs";
import process from "node:process";

const production = process.argv[2] === "production";
const fullcalendarNotice = readFileSync(new URL("./node_modules/fullcalendar/LICENSE.md", import.meta.url), "utf8").trim();
const preactNotice = readFileSync(new URL("./node_modules/preact/LICENSE", import.meta.url), "utf8").trim();
const thirdPartyNotices = [
  "Third-party notices for the production OMD Home bundle.",
  "",
  "FullCalendar runtime packages:",
  "- fullcalendar",
  "- @fullcalendar/core",
  "- @full-ui/headless-calendar",
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
