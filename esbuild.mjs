import esbuild from "esbuild";
import process from "node:process";

const production = process.argv[2] === "production";
const context = await esbuild.context({
  entryPoints: { main: "src/main.ts", styles: "src/styles.css" },
  bundle: true,
  external: ["obsidian", "electron", "node:crypto", "node:fs", "node:fs/promises", "node:path"],
  format: "cjs",
  platform: "browser",
  target: "es2022",
  minify: production,
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
