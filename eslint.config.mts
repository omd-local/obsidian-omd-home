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
  {
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["OMD", "OMD Home", "Apple Calendar", "EventKit", "Ollama", "OpenAI", "Anthropic", "DeepSeek", "Google", "Outlook", "Markdown", "Obsidian", "macOS", "KiB"],
          acronyms: ["AI", "CNZ", "HTTPS", "OMD", "URL"],
          enforceCamelCaseLower: true,
        },
      ],
    },
  },
  {
    files: ["src/settings.ts"],
    rules: {
      // OMD Home supports Obsidian 1.10. The imperative tab is also needed for
      // the runtime-discovered Calendar list; the declarative API starts at 1.13.
      "@typescript-eslint/no-deprecated": "off",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
);
