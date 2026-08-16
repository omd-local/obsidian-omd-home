import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "dist",
    "eventkit-helper/.build",
    "preview",
    "test-vault",
    "tests",
    "versions.json",
    "main.js",
    "styles.css",
    "manifest.json",
    "package.json",
    "package-lock.json",
    "esbuild.mjs",
    "version-bump.mjs",
    "scripts",
    "**/._*",
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mts", "manifest.json"],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...obsidianmd.configs.recommended,
);
