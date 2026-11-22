import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyMarkdownFormattingPreview,
  FORMATTING_CONFLICT_MESSAGE,
  FORMATTING_TRANSCRIPT_QUALITY_MESSAGE,
  FORMATTING_UNSAFE_OUTPUT_MESSAGE,
  markdownFormattingBlockedReason,
  markdownFormattingMode,
  markdownBodyForFormatting,
  preserveMarkdownFrontmatter,
} from "../src/markdown-formatting.ts";

const bridgeSource = readFileSync(resolve("src/omd-bridge.ts"), "utf8");

const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
const modalSource = readFileSync(resolve("src/markdown-formatting-modal.ts"), "utf8");
const settingsSource = readFileSync(resolve("src/settings.ts"), "utf8");
const styleSource = readFileSync(resolve("src/styles.css"), "utf8");

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

test("an ASR transcript selects punctuation-aware cleanup without changing ordinary notes", () => {
  const transcript = `# Capture\n\n## Transcript\n\n${"中文转录没有标点也没有空格".repeat(30)}\n\n### Timestamped\n\n00:00 中文转录\n`;
  assert.equal(markdownFormattingMode(transcript), "transcript-cleanup");
  assert.equal(markdownFormattingMode("# Ordinary note\n\nA compact paragraph.\n"), "layout-only");
  assert.match(bridgeSource, /mode === "transcript-cleanup"[\s\S]*--polish-md-transcript-cleanup/u);
  assert.match(modalSource, /Clean transcript/u);
  assert.match(modalSource, /punctuation and paragraph breaks/u);
});

test("a transcript quality warning blocks formatting before the local model runs", () => {
  const unreliable = [
    "# Capture",
    "",
    "## Transcript quality warning",
    "",
    "OMD detected possible transcription problems.",
    "",
    "## Transcript",
    "",
    "repeated repeated repeated",
  ].join("\n");
  assert.equal(markdownFormattingBlockedReason(unreliable), FORMATTING_TRANSCRIPT_QUALITY_MESSAGE);
  assert.equal(
    markdownFormattingBlockedReason("# Capture\n\n## Transcript\n\nA verified transcript.\n"),
    null,
  );
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
  assert.match(
    modalSource,
    /text: transcriptCleanup \? "Cleaning transcript…" : "Improving formatting…"[\s\S]*role: "status", "aria-live": "polite", "aria-atomic": "true"/u,
  );
  assert.match(modalSource, /text: "Formatting preview"/u);
  assert.match(modalSource, /role: "region", "aria-labelledby": this\.previewHeadingId/u);
  assert.doesNotMatch(modalSource, /aria-label.*Formatting preview for/u);
  assert.match(modalSource, /setButtonText\("Cancel"\)/u);
  assert.match(
    modalSource,
    /setButtonText\(transcriptCleanup \? "Apply transcript cleanup" : "Apply formatting"\)\.setDisabled\(true\)/u,
  );
  assert.match(modalSource, /private applyButton\?: ButtonComponent/u);
  assert.match(modalSource, /this\.applyButton\.setDisabled\(false\)/u);
  assert.doesNotMatch(modalSource, /this\.applyButton\.disabled\s*=\s*false/u);
  assert.match(mainSource, /decision = modal\.openAndWait\(\)[\s\S]*previewMarkdownFormatting/u);
  assert.match(mainSource, /const body = markdownBodyForFormatting\(baseline\)[\s\S]*previewMarkdownFormatting\([\s\S]*executable,[\s\S]*body,/u);
  assert.match(mainSource, /applyMarkdownFormattingPreview\(this\.app\.vault, file, baseline, preview\)/u);
  assert.match(mainSource, /this\.captureActive = true[\s\S]*this\.captureController = controller/u);
  assert.match(mainSource, /event: cancelled \? "cancelled" : "error"/u);
  assert.match(mainSource, /markdownFormattingModals\.add\(modal\)/u);
  assert.match(mainSource, /this\.markdownFormattingModals\.delete\(modal\)/u);
  assert.match(mainSource, /decision = modal\.openAndWait\(\)/u);
  assert.match(mainSource, /for \(const modal of this\.markdownFormattingModals\) modal\.close\(\)/u);
  assert.match(mainSource, /if \(this\.unloaded\) return;[\s\S]*applyMarkdownFormattingPreview/u);
  assert.match(mainSource, /error\.message === FORMATTING_UNSAFE_OUTPUT_MESSAGE[\s\S]*return error\.message/u);
  assert.match(mainSource, /error\.message === MARKDOWN_FORMATTING_PROTECTED_CONTENT_MESSAGE[\s\S]*return error\.message/u);
  assert.match(styleSource, /\.omd-formatting-modal \{[\s\S]*resize: both;[\s\S]*container: omd-formatting-dialog/u);
  assert.match(styleSource, /@container omd-formatting-dialog \(max-width: 420px\)[\s\S]*flex-direction: column;[\s\S]*button \{ width: 100%; \}/u);

  const formattingMethod = mainSource.slice(
    mainSource.indexOf("async improveNoteFormatting("),
    mainSource.indexOf("async reviewNote("),
  );
  const failureBranch = formattingMethod.slice(
    formattingMethod.indexOf("} catch (error) {"),
    formattingMethod.indexOf("} finally {"),
  );
  assert.match(failureBranch, /modal\.finishGeneration\(\);[\s\S]*modal\.showFailure\(\s*detail/u);
  assert.doesNotMatch(failureBranch, /modal\.close\(\);/u, "a failure must remain readable in the modal");
  assert.doesNotMatch(failureBranch, /new Notice\(detail\)/u, "a persistent modal replaces the short error Notice");
  const applyBranch = formattingMethod.slice(formattingMethod.indexOf("applyMarkdownFormattingPreview"));
  assert.doesNotMatch(applyBranch, /clearIssue\("ai"\)/u, "an old preview must not clear a newer AI failure");
});

test("formatting terminal states stay readable until the user closes them", () => {
  assert.match(modalSource, /showFailure\([\s\S]*?message: string/u);
  assert.match(modalSource, /showNoChanges\(message: string/u);
  assert.match(modalSource, /this\.statusEl\.setAttr\("role", "alert"\)/u);
  assert.match(modalSource, /this\.closeButton\?\.setButtonText\("Close"\)/u);

  const formattingMethod = mainSource.slice(
    mainSource.indexOf("async improveNoteFormatting("),
    mainSource.indexOf("async reviewNote("),
  );
  assert.match(
    formattingMethod,
    /const blockedReason = markdownFormattingBlockedReason\(baseline\)[\s\S]*if \(blockedReason\) throw new Error\(blockedReason\)/u,
  );
  assert.match(formattingMethod, /preview === baseline[\s\S]*modal\.showNoChanges\(FORMATTING_NO_CHANGES_MESSAGE\)/u);
  assert.doesNotMatch(
    formattingMethod,
    /preview === baseline[\s\S]{0,500}new Notice\(FORMATTING_NO_CHANGES_MESSAGE\)/u,
  );
});

test("formatting failures expose one safe recovery path without a stale Apply action", () => {
  assert.match(modalSource, /Your note is unchanged\./u);
  assert.match(modalSource, /setButtonText\("Change local model"\)/u);
  assert.match(modalSource, /setButtonText\("Try again"\)/u);
  assert.match(modalSource, /phase === "apply" \? "Formatting couldn.t be applied" : "Formatting couldn.t be generated"/u);
  assert.match(
    modalSource,
    /private setButtonVisible\([\s\S]*button\.buttonEl\.hidden = !visible;[\s\S]*button\.buttonEl\.style\.display = visible \? "" : "none"/u,
  );

  const failureMethod = modalSource.slice(
    modalSource.indexOf("showFailure("),
    modalSource.indexOf("showNoChanges("),
  );
  assert.match(failureMethod, /this\.setButtonVisible\(this\.applyButton, false\)/u);
  assert.match(failureMethod, /this\.setButtonVisible\(this\.localModelButton, offerLocalModelSettings\)/u);
  assert.doesNotMatch(failureMethod, /this\.applyButton\.buttonEl\.hidden = false/u);

  assert.match(mainSource, /openLocalWritingSettings\(\): void/u);
  assert.match(mainSource, /this\.settingTab\?\.showLocalWritingSettings\(\)/u);
  assert.match(settingsSource, /showLocalWritingSettings\(\): void[\s\S]*localAiAdvancedExpanded = true/u);
  assert.match(settingsSource, /omd-settings-local-writing-model/u);

  const applyBranch = mainSource.slice(mainSource.indexOf("applyMarkdownFormattingPreview"));
  assert.match(applyBranch, /modal\.showFailure\(detail, generateAgain, false, "apply"\)/u);
  assert.match(modalSource, /this\.setElementVisible\(this\.previewSection, false\)/u);
});

test("a stale formatting preview stays open with an actionable Try again control", () => {
  assert.match(modalSource, /setButtonText\("Try again"\)/u);
  assert.match(modalSource, /showConflict\(message: string, onGenerateAgain: \(\) => void\)/u);
  assert.match(modalSource, /setAttr\("role", "alert"\)/u);
  assert.match(modalSource, /this\.setButtonVisible\(this\.generateAgainButton, true\)/u);
  assert.match(modalSource, /this\.setButtonVisible\(this\.applyButton, false\)/u);

  const formattingMethod = mainSource.slice(
    mainSource.indexOf("async improveNoteFormatting("),
    mainSource.indexOf("async reviewNote("),
  );
  const applyHandler = modalSource.slice(
    modalSource.indexOf('setButtonText(transcriptCleanup ? "Apply transcript cleanup" : "Apply formatting")'),
    modalSource.indexOf("actions.settingEl.addClass"),
  );
  assert.doesNotMatch(applyHandler, /this\.close\(\)/u, "Apply must leave the modal open until CAS finishes");
  assert.match(
    formattingMethod,
    /const generateAgain = \(\) => \{[\s\S]*modal\.close\(\);[\s\S]*void this\.improveNoteFormatting\(file\)[\s\S]*result === "conflict"[\s\S]*modal\.showConflict\(FORMATTING_CONFLICT_MESSAGE, generateAgain\)/u,
  );
  assert.doesNotMatch(
    formattingMethod,
    /result === "conflict"[\s\S]{0,160}new Notice\(FORMATTING_CONFLICT_MESSAGE\)/u,
    "a recognized conflict belongs in the open modal, not a transient Notice",
  );
});
