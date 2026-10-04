import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyMarkdownFormattingPreview,
  FORMATTING_CONFLICT_MESSAGE,
  FORMATTING_UNSAFE_OUTPUT_MESSAGE,
  markdownBodyForFormatting,
  preserveMarkdownFrontmatter,
} from "../src/markdown-formatting.ts";

const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
const modalSource = readFileSync(resolve("src/markdown-formatting-modal.ts"), "utf8");

test("formatting keeps existing frontmatter byte-for-byte around a formatted body", () => {
  const baseline = "---\nomd_home_status: inbox\nsource: https://example.com\n---\n# Note\n\nraw text\n";
  const formatted = "# Note\n\nRaw text.\n";
  assert.equal(
    preserveMarkdownFrontmatter(baseline, formatted),
    "---\nomd_home_status: inbox\nsource: https://example.com\n---\n# Note\n\nRaw text.\n",
  );
});

test("formatting rejects invented frontmatter on an ordinary note", () => {
  assert.throws(
    () => preserveMarkdownFrontmatter("# Note\n\nraw\n", "---\nstatus: reviewed\n---\n# Note\n\nRaw.\n"),
    (error: unknown) => error instanceof Error && error.message === FORMATTING_UNSAFE_OUTPUT_MESSAGE,
  );
});

test("formatting preserves valid empty frontmatter delimiters byte-for-byte", () => {
  assert.equal(
    preserveMarkdownFrontmatter("---\n---\n# Note\n\nraw\n", "# Note\n\nRaw.\n"),
    "---\n---\n# Note\n\nRaw.\n",
  );
});

test("formatting sends only the note body to the local model", () => {
  assert.equal(
    markdownBodyForFormatting("---\nomd_home_status: inbox\n---\n# Note\n\nraw\n"),
    "# Note\n\nraw\n",
  );
  assert.equal(markdownBodyForFormatting("# Ordinary\n\nraw\n"), "# Ordinary\n\nraw\n");
});

test("formatting rejects a malformed model metadata delimiter", () => {
  assert.throws(
    () => preserveMarkdownFrontmatter(
      "---\nomd_home_status: inbox\n---\n# Note\n\nraw\n",
      "---\nomd_home_status: inbox\n--\n# Note\n\nraw\n",
    ),
    (error: unknown) => error instanceof Error && error.message === FORMATTING_UNSAFE_OUTPUT_MESSAGE,
  );
});

test("formatting preserves a legitimate paired thematic-rule block at the start of the body", () => {
  const baseline = "---\nstatus: inbox\n---\n---\nKEEP THIS\n---\nmore\n";
  const body = markdownBodyForFormatting(baseline);
  assert.equal(body, "---\nKEEP THIS\n---\nmore\n");
  assert.equal(preserveMarkdownFrontmatter(baseline, body), baseline);
});

test("formatting rejects a newly introduced paired thematic-rule block instead of deleting its text", () => {
  const baseline = "---\nstatus: inbox\n---\nIntro\n---\nKEEP\n---\nmore\n";
  const formatted = "---\nIntro\n---\nKEEP\n---\nmore\n";
  assert.throws(
    () => preserveMarkdownFrontmatter(baseline, formatted),
    (error: unknown) => error instanceof Error && error.message === FORMATTING_UNSAFE_OUTPUT_MESSAGE,
  );
});

test("applying a preview is serialized and writes only the approved body", async () => {
  let current = "# Note\n\nraw\n";
  let writes = 0;
  const vault = {
    async process(_file: object, transform: (value: string) => string): Promise<string> {
      current = transform(current);
      writes += 1;
      return current;
    },
  };
  assert.equal(
    await applyMarkdownFormattingPreview(vault, {}, "# Note\n\nraw\n", "# Note\n\nRaw.\n"),
    "applied",
  );
  assert.equal(current, "# Note\n\nRaw.\n");
  assert.equal(writes, 1);
});

test("a changed note rejects the preview without a vault write", async () => {
  const baseline = "# Note\n\nraw\n";
  let current = "# Note\n\nuser edit\n";
  let writes = 0;
  const vault = {
    async process(_file: object, transform: (value: string) => string): Promise<string> {
      try {
        const next = transform(current);
        current = next;
        writes += 1;
        return current;
      } catch (error) {
        assert.equal(error instanceof Error ? error.message : "", FORMATTING_CONFLICT_MESSAGE);
        throw error;
      }
    },
  };
  assert.equal(
    await applyMarkdownFormattingPreview(vault, {}, baseline, "# Note\n\nRaw.\n"),
    "conflict",
  );
  assert.equal(current, "# Note\n\nuser edit\n");
  assert.equal(writes, 0);
});

test("an identical preview is a no-op and never enters the vault writer", async () => {
  let calls = 0;
  const vault = {
    async process(): Promise<string> {
      calls += 1;
      return "unexpected";
    },
  };
  assert.equal(await applyMarkdownFormattingPreview(vault, {}, "same", "same"), "no-op");
  assert.equal(calls, 0);
});

test("formatting UI is review-first, cancellable, and announces generation", () => {
  assert.match(modalSource, /text: "Improving formatting…"[\s\S]*role: "status", "aria-live": "polite", "aria-atomic": "true"/u);
  assert.match(modalSource, /text: "Formatting preview"/u);
  assert.match(modalSource, /setButtonText\("Cancel"\)/u);
  assert.match(modalSource, /setButtonText\("Apply formatting"\)\.setDisabled\(true\)/u);
  assert.match(mainSource, /decision = modal\.openAndWait\(\)[\s\S]*previewMarkdownFormatting/u);
  assert.match(mainSource, /const body = markdownBodyForFormatting\(baseline\)[\s\S]*previewMarkdownFormatting\([\s\S]*executable,[\s\S]*body,/u);
  assert.match(mainSource, /applyMarkdownFormattingPreview\(this\.app\.vault, file, baseline, preview\)/u);
  assert.match(mainSource, /this\.captureActive = true[\s\S]*this\.captureController = controller/u);
  assert.match(mainSource, /event: cancelled \? "cancelled" : "error"/u);
  assert.match(mainSource, /markdownFormattingModals\.add\(modal\)/u);
  assert.match(mainSource, /openAndWait\(\)\.finally\(\(\) => this\.markdownFormattingModals\.delete\(modal\)\)/u);
  assert.match(mainSource, /for \(const modal of this\.markdownFormattingModals\) modal\.close\(\)/u);
  assert.match(mainSource, /if \(this\.unloaded\) return;[\s\S]*applyMarkdownFormattingPreview/u);
  assert.match(mainSource, /error\.message === FORMATTING_UNSAFE_OUTPUT_MESSAGE[\s\S]*return error\.message/u);

  const formattingMethod = mainSource.slice(
    mainSource.indexOf("async improveNoteFormatting("),
    mainSource.indexOf("async reviewNote("),
  );
  const applyBranch = formattingMethod.slice(formattingMethod.indexOf("applyMarkdownFormattingPreview"));
  assert.doesNotMatch(applyBranch, /clearIssue\("ai"\)/u, "an old preview must not clear a newer AI failure");
});
