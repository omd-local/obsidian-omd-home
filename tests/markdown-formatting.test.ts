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
  markdownFormattingScopeDescription,
  markdownFormattingTarget,
  mergeMarkdownFormattingTarget,
  preserveMarkdownFrontmatter,
} from "../src/markdown-formatting.ts";

const bridgeSource = readFileSync(resolve("src/omd-bridge.ts"), "utf8");

const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
const modalSource = readFileSync(resolve("src/markdown-formatting-modal.ts"), "utf8");
const formattingSource = readFileSync(resolve("src/markdown-formatting.ts"), "utf8");
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

test("rich captures send only editable Body text and preserve media scaffolding byte-for-byte", () => {
  const baseline = [
    "---",
    "omd_home_status: inbox",
    "source: https://www.rednote.com/item/826",
    "---",
    "# Bouldering for beginners",
    "",
    "> [Source](https://www.rednote.com/item/826)",
    "",
    "## Full Content",
    "",
    "Bouldering for beginners",
    "",
    "## Metadata",
    "",
    "- **Note ID**: 826",
    "",
    "## Body",
    "",
    "Muscles take 4 weeks. Tendons take up to 2 years.",
    "",
    "## Images",
    "",
    "![image 1](image_01.jpg)",
    "",
    "**OCR text:**",
    "",
    "```text",
    "## Body",
    "- **Transcript status**: Needs review",
    "```",
    "",
  ].join("\n");
  const target = markdownFormattingTarget(baseline);
  assert.equal(target.scope, "body-section");
  assert.equal(target.mode, "layout-only");
  assert.equal(target.source, "## Body\n\nMuscles take 4 weeks. Tendons take up to 2 years.\n\n");
  assert.doesNotMatch(target.source, /Metadata|image_01|OCR text|rednote/u);

  const formatted = "## Body\n\nMuscles take 4 weeks.\n\nTendons take up to 2 years.\n\n";
  const merged = mergeMarkdownFormattingTarget(baseline, target, formatted);
  assert.equal(merged, baseline.replace(target.source, formatted));
  assert.match(merged, /!\[image 1\]\(image_01\.jpg\)[\s\S]*```text\n## Body\n- \*\*Transcript status\*\*: Needs review\n```/u);
  assert.equal(markdownFormattingBlockedReason(baseline), null, "fenced OCR examples are not live transcript warnings");
});

test("fenced capture examples cannot replace the real Body target", () => {
  const baseline = [
    "# Capture",
    "",
    "## Images",
    "",
    "~~~text",
    "## Body",
    "fenced decoy",
    "~~~",
    "",
    "## Body",
    "",
    "Real editable prose.",
    "",
    "## Images continued",
    "",
    "![kept](kept.png)",
    "",
  ].join("\r\n");
  const target = markdownFormattingTarget(baseline);
  assert.equal(target.scope, "body-section");
  assert.equal(target.source, "## Body\r\n\r\nReal editable prose.\r\n\r\n");

  const formatted = "## Body\r\n\r\nReal editable prose.\r\n\r\n";
  assert.equal(mergeMarkdownFormattingTarget(baseline, target, formatted), baseline);
});

test("fenced astral text preserves UTF-16 offsets for the real Body target", () => {
  const baseline = [
    "# Capture",
    "",
    "```text",
    "🧗🏽‍♀️ ## Body decoy",
    "```",
    "",
    "## Body",
    "",
    "Real editable prose after emoji.",
    "",
    "## Images",
    "",
    "![kept](kept.png)",
    "",
  ].join("\n");
  const target = markdownFormattingTarget(baseline);
  assert.equal(target.source, "## Body\n\nReal editable prose after emoji.\n\n");
  assert.equal(
    mergeMarkdownFormattingTarget(baseline, target, "## Body\n\nReal editable prose after emoji.\n\n"),
    baseline,
  );
});

test("inline backtick code does not hide a following transcript warning", () => {
  const baseline = [
    "# Capture",
    "",
    "```example```",
    "",
    "## Transcript quality warning",
    "",
    "- **Transcript warning**:\tincomplete",
    "",
    "## Transcript",
    "",
    "Partial text.",
  ].join("\n");
  assert.equal(markdownFormattingBlockedReason(baseline), FORMATTING_TRANSCRIPT_QUALITY_MESSAGE);
});

test("tilde fence info may contain tildes without exposing fenced markers", () => {
  const baseline = [
    "# Capture",
    "",
    "~~~text~format",
    "## Transcript quality warning",
    "- **Transcript status**: Needs review",
    "## Body",
    "fenced decoy",
    "~~~",
    "",
    "## Body",
    "",
    "Real editable prose.",
    "",
    "## Images",
    "",
  ].join("\n");
  assert.equal(markdownFormattingBlockedReason(baseline), null);
  assert.equal(markdownFormattingTarget(baseline).source, "## Body\n\nReal editable prose.\n\n");
});

test("Body targets stop before H1 and indented H2 section boundaries", () => {
  const beforeH1 = "# Capture\n\n## Body\n\nEditable.\n\n# Appendix\n\nProtected.\n";
  assert.equal(markdownFormattingTarget(beforeH1).source, "## Body\n\nEditable.\n\n");

  const beforeIndentedH2 = "# Capture\n\n ## Body\n\nEditable.\n\n   ## Images\n\n![kept](kept.png)\n";
  assert.equal(markdownFormattingTarget(beforeIndentedH2).source, " ## Body\n\nEditable.\n\n");
});

test("transcript cleanup targets only the live Transcript section", () => {
  const baseline = "---\nstatus: inbox\n---\n# Audio\n\n## Metadata\n\n- **Duration**: 42\n\n## Transcript\n\nraw words\n\n### Detail\n\nkept with transcript\n\n## Images\n\n![wave](wave.png)\n";
  const target = markdownFormattingTarget(baseline);
  assert.equal(target.scope, "transcript-section");
  assert.equal(target.mode, "transcript-cleanup");
  assert.equal(target.source, "## Transcript\n\nraw words\n\n### Detail\n\nkept with transcript\n\n");
  const merged = mergeMarkdownFormattingTarget(
    baseline,
    target,
    "## Transcript\n\nRaw words.\n\n### Detail\n\nkept with transcript\n\n",
  );
  assert.ok(merged.endsWith("- **Duration**: 42\n\n## Transcript\n\nRaw words.\n\n### Detail\n\nkept with transcript\n\n## Images\n\n![wave](wave.png)\n"));
  assert.match(markdownFormattingScopeDescription(target.scope), /Transcript section[\s\S]*images[\s\S]*timestamps/u);
});

test("an ASR transcript selects punctuation-aware cleanup without changing ordinary notes", () => {
  const transcript = `# Capture\n\n## Transcript\n\n${"中文转录没有标点也没有空格".repeat(30)}\n\n### Timestamped\n\n00:00 中文转录\n`;
  assert.equal(markdownFormattingMode(transcript), "transcript-cleanup");
  assert.equal(markdownFormattingMode("# Ordinary note\n\nA compact paragraph.\n"), "layout-only");
  assert.match(bridgeSource, /mode === "transcript-cleanup"[\s\S]*--polish-md-transcript-cleanup/u);
  assert.match(modalSource, /Clean transcript/u);
  assert.match(formattingSource, /punctuation and paragraph breaks/u);
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
    markdownFormattingBlockedReason("# Capture\n\n## Metadata\n\n- **Transcript warning**: incomplete\n\n## Transcript\n\nPartial"),
    FORMATTING_TRANSCRIPT_QUALITY_MESSAGE,
  );
  assert.equal(
    markdownFormattingBlockedReason("# Capture\n\n## Metadata\n\n- **Transcript status**: Needs review\n\n## Transcript\n\nPartial"),
    FORMATTING_TRANSCRIPT_QUALITY_MESSAGE,
  );
  assert.equal(
    markdownFormattingBlockedReason("# Capture\n\n## Metadata\n\n- **Transcript status** \t:\t Needs review\n\n## Transcript\n\nPartial"),
    FORMATTING_TRANSCRIPT_QUALITY_MESSAGE,
  );
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
  assert.match(mainSource, /const formattingTarget = markdownFormattingTarget\(baseline\)[\s\S]*previewMarkdownFormatting\([\s\S]*executable,[\s\S]*formattingTarget\.source,/u);
  assert.match(mainSource, /mergeMarkdownFormattingTarget\(baseline, formattingTarget, formatted\)/u);
  assert.match(mainSource, /modal\.showPreview\(formatted\)/u, "the preview stays focused on the selected text");
  assert.doesNotMatch(mainSource, /modal\.showPreview\(preview\)/u, "rich media outside the target must not clutter the preview");
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
  assert.doesNotMatch(
    failureBranch,
    /if \(!cancelled\) \{\s*modal\.close\(\);/u,
    "a failure must remain readable until the user chooses an action",
  );
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
  assert.doesNotMatch(
    formattingMethod,
    /if \(transcriptRepairIssue\) \{[\s\S]{0,180}openTranscriptRepairModal/u,
    "Improve formatting must not silently switch tools",
  );
  assert.match(formattingMethod, /modal\.showTranscriptReviewRequired\([\s\S]*this\.openTranscriptRepairModal/u);
  assert.match(modalSource, /showTranscriptReviewRequired[\s\S]*setButtonText\("Review transcript"\)/u);
  assert.match(
    formattingMethod,
    /const blockedReason = transcriptRepairIssue[\s\S]*markdownFormattingBlockedReason\(baseline\)[\s\S]*if \(blockedReason\) throw new Error\(blockedReason\)/u,
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
