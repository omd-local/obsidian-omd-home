import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  inspectTranscriptRepair,
  repairInvalidTranscriptTail,
  replaceTranscriptRange,
} from "../src/transcript-repair.ts";

const repeatedTail = [
  "- [14:58 → 14:59] 这会影响",
  "- [14:59 → 15:01] 这会影响",
  "- [15:01 → 15:03] 这会影响",
].join("\n");

const unreliableTranscript = [
  "---",
  "omd_home_status: inbox",
  "---",
  "# Capture",
  "",
  "## Metadata",
  "",
  "- **Duration**: 898.5s",
  "- **Language**: zh",
  "- **Transcript status**: Needs review",
  "- **Transcript warning**: Whisper reported unstable repeated-text segments; review the raw transcript.",
  "",
  "## Transcript quality warning",
  "",
  "OMD detected possible transcription problems. The raw transcript is kept below for review.",
  "",
  "## Transcript",
  "",
  "最后一句这会影响这会影响这会影响",
  "",
  "### Timestamped",
  "",
  "- [14:54 → 14:58] 最后一句",
  repeatedTail,
  "",
].join("\n");

test("auto-detected Chinese repetition after media end becomes an actionable tail repair", () => {
  const issue = inspectTranscriptRepair(unreliableTranscript, {
    requested: "auto",
    detected: "zh",
  });

  assert.ok(issue);
  assert.equal(issue.kind, "invalid-tail");
  assert.equal(
    issue.message,
    "Speech language auto-detect succeeded: Chinese. Whisper generated repeated segments after the source ended. Review the transcript tail before cleaning it.",
  );
  assert.equal(issue.sourceDurationSeconds, 898.5);
  assert.equal(issue.transcriptEndSeconds, 903);
  assert.equal(issue.invalidTail?.segmentCount, 3);
  assert.equal(issue.invalidTail?.startSeconds, 898);
});

test("invalid tail repair removes only previewed tail text and records the repair", () => {
  const issue = inspectTranscriptRepair(unreliableTranscript, {
    requested: "auto",
    detected: "zh",
  });
  assert.ok(issue?.invalidTail);

  const repaired = repairInvalidTranscriptTail(unreliableTranscript, issue.invalidTail);

  assert.match(repaired, /最后一句\n\n### Timestamped/u);
  assert.doesNotMatch(repaired, /这会影响/u);
  assert.doesNotMatch(repaired, /^## Transcript quality warning$/mu);
  assert.doesNotMatch(repaired, /Transcript warning/u);
  assert.match(repaired, /- \*\*Transcript status\*\*: Repaired after review/u);
  assert.match(repaired, /- \*\*Transcript repair\*\*: Removed 3 invalid tail segments beyond the 898\.5s source duration\./u);
  assert.match(repaired, /^omd_home_status: inbox$/mu, "repair must preserve review status");
});

test("a generic transcript warning is reviewable but never receives an unsafe automatic repair", () => {
  const markdown = [
    "# Capture",
    "",
    "## Metadata",
    "",
    "- **Language**: en",
    "- **Transcript warning**: The transcript covers much less time than the source duration and may be incomplete.",
    "",
    "## Transcript quality warning",
    "",
    "Review this transcript.",
    "",
    "## Transcript",
    "",
    "Partial transcript",
  ].join("\n");

  const issue = inspectTranscriptRepair(markdown, { requested: "auto", detected: "en" });
  assert.ok(issue);
  assert.equal(issue.kind, "quality-warning");
  assert.equal(issue.invalidTail, null);
  assert.equal(issue.suggestedRange, null);
  assert.match(issue.message, /auto-detect succeeded: English/u);
  assert.match(issue.message, /incomplete/u);
});

test("an incomplete timestamped transcript suggests the missing tail without inventing text", () => {
  const markdown = [
    "---",
    "omd_home_status: inbox",
    "---",
    "# Local audio repair fixture",
    "",
    "## Metadata",
    "",
    "- **Duration**: 113.855s",
    "- **Language**: en",
    "- **Transcript status**: Needs review",
    "- **Transcript warning**: The transcript covers much less time than the source duration and may be incomplete.",
    "",
    "## Transcript quality warning",
    "",
    "Review the missing tail.",
    "",
    "## Transcript",
    "",
    "The blue lantern is beside the window.",
    "",
    "### Timestamped",
    "",
    "- [00:00 → 00:04] The blue lantern is beside the window.",
    "",
  ].join("\n");

  const issue = inspectTranscriptRepair(markdown, { requested: "auto", detected: "en" });

  assert.equal(issue?.kind, "quality-warning");
  assert.deepEqual(issue?.suggestedRange, {
    startSeconds: 4,
    endSeconds: 113.855,
    reason: "incomplete-tail",
  });
  assert.equal(issue?.segments.length, 1);
});

test("range replacement changes only selected transcript bytes and timestamped rows", () => {
  const markdown = [
    "---",
    "omd_home_status: inbox",
    "---",
    "# Range repair",
    "",
    "## Metadata",
    "",
    "- **Duration**: 12s",
    "- **Transcript status**: Needs review",
    "- **Transcript warning**: The captured speech may be incomplete.",
    "",
    "## Transcript quality warning",
    "",
    "Review this transcript.",
    "",
    "## Transcript",
    "",
    "Keep before. wrong middle Keep after.",
    "",
    "### Timestamped",
    "",
    "- [00:00 → 00:03] Keep before.",
    "- [00:03 → 00:07] wrong middle",
    "- [00:07 → 00:12] Keep after.",
    "",
    "## Notes",
    "",
    "UNCHANGED-AFTER-TRANSCRIPT",
    "",
  ].join("\n");

  const repaired = replaceTranscriptRange(
    markdown,
    { startSeconds: 3, endSeconds: 7, reason: "manual-review" },
    [{ start: 3.1, end: 6.8, text: "correct middle" }],
  );

  assert.match(repaired, /Keep before\. correct middle Keep after\./u);
  assert.doesNotMatch(repaired, /wrong middle/u);
  assert.match(repaired, /- \[00:03 → 00:06\] correct middle/u);
  assert.match(repaired, /- \[00:00 → 00:03\] Keep before\./u);
  assert.match(repaired, /- \[00:07 → 00:12\] Keep after\./u);
  assert.match(repaired, /UNCHANGED-AFTER-TRANSCRIPT/u);
  assert.match(repaired, /^omd_home_status: inbox$/mu);
  assert.match(repaired, /Transcript repair/u);
});

test("range replacement refuses to consume text outside a partial timestamp row", () => {
  const markdown = [
    "# Boundary repair",
    "",
    "## Metadata",
    "",
    "- **Duration**: 8s",
    "- **Transcript status**: Needs review",
    "- **Transcript warning**: The captured speech may be incomplete.",
    "",
    "## Transcript",
    "",
    "Keep this whole row. Replace this row.",
    "",
    "### Timestamped",
    "",
    "- [00:00 → 00:04] Keep this whole row.",
    "- [00:04 → 00:08] Replace this row.",
    "",
  ].join("\n");

  assert.throws(
    () => replaceTranscriptRange(
      markdown,
      { startSeconds: 2, endSeconds: 8, reason: "manual-review" },
      [{ start: 2, end: 8, text: "Unsafe replacement." }],
    ),
    /timestamp row boundaries/u,
  );
  assert.match(markdown, /Keep this whole row/u);
});

test("missing-tail repair appends new text and segments without rewriting the existing transcript", () => {
  const markdown = [
    "# Missing tail",
    "",
    "## Metadata",
    "",
    "- **Duration**: 10s",
    "- **Transcript status**: Needs review",
    "- **Transcript warning**: The transcript covers much less time than the source duration and may be incomplete.",
    "",
    "## Transcript quality warning",
    "",
    "Review this transcript.",
    "",
    "## Transcript",
    "",
    "Existing exact prefix.",
    "",
    "### Timestamped",
    "",
    "- [00:00 → 00:03] Existing exact prefix.",
    "",
  ].join("\n");

  const repaired = replaceTranscriptRange(
    markdown,
    { startSeconds: 3, endSeconds: 10, reason: "incomplete-tail" },
    [
      { start: 3.2, end: 6, text: "Recovered middle." },
      { start: 6, end: 9.8, text: "Recovered ending." },
    ],
  );

  assert.match(repaired, /Existing exact prefix\. Recovered middle\. Recovered ending\./u);
  assert.match(repaired, /- \[00:03 → 00:06\] Recovered middle\./u);
  assert.match(repaired, /- \[00:06 → 00:09\] Recovered ending\./u);
  assert.doesNotMatch(repaired, /covers much less time/u);
  assert.match(repaired, /- \*\*Transcript status\*\*: Repaired after review/u);
});

test("a partial missing-tail repair keeps the incomplete warning visible", () => {
  const markdown = [
    "# Partial missing tail",
    "",
    "## Metadata",
    "",
    "- **Duration**: 20s",
    "- **Transcript status**: Needs review",
    "- **Transcript warning**: The captured speech may be incomplete.",
    "",
    "## Transcript quality warning",
    "",
    "Review this transcript.",
    "",
    "## Transcript",
    "",
    "Existing prefix.",
    "",
    "### Timestamped",
    "",
    "- [00:00 → 00:03] Existing prefix.",
    "",
  ].join("\n");

  const repaired = replaceTranscriptRange(
    markdown,
    { startSeconds: 3, endSeconds: 8, reason: "manual-review" },
    [{ start: 3.1, end: 7.8, text: "Recovered only part." }],
  );

  assert.match(repaired, /Transcript warning.*incomplete/u);
  assert.match(repaired, /- \*\*Transcript status\*\*: Needs review/u);
  assert.match(repaired, /^## Transcript quality warning$/mu);
});

test("metadata-only transcript warnings still expose review without inventing an automatic repair", () => {
  const markdown = [
    "# Capture",
    "",
    "## Metadata",
    "",
    "- **Transcript status**: Needs review",
    "- **Transcript warning**: The captured speech may be incomplete.",
    "",
    "## Transcript",
    "",
    "Partial transcript",
  ].join("\n");

  const issue = inspectTranscriptRepair(markdown, { requested: "auto", detected: "en" });
  assert.equal(issue?.kind, "quality-warning");
  assert.equal(issue?.invalidTail, null);
});

test("a repair preview cannot remove a tail after its timestamp evidence changes", () => {
  const issue = inspectTranscriptRepair(unreliableTranscript, { requested: "auto", detected: "zh" });
  const tail = issue?.invalidTail;
  assert.ok(tail);
  const changed = unreliableTranscript.replace("- [15:01 → 15:03] 这会影响", "- [15:01 → 15:03] 手工修正");

  assert.throws(
    () => repairInvalidTranscriptTail(changed, tail),
    /changed after the repair preview/u,
  );
});

test("verified transcripts do not expose repair controls", () => {
  assert.equal(
    inspectTranscriptRepair("# Capture\n\n## Transcript\n\nVerified text.\n", {
      requested: "auto",
      detected: "en",
    }),
    null,
  );
});

test("standalone note views expose AI tools and conditionally add transcript repair", () => {
  const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
  const modalSource = readFileSync(resolve("src/transcript-repair-modal.ts"), "utf8");
  const bridgeSource = readFileSync(resolve("src/omd-bridge.ts"), "utf8");

  assert.match(mainSource, /addAction\("sparkles", "AI tools"/u);
  assert.match(mainSource, /setTitle\("Improve formatting"\)[\s\S]*setTitle\("Generate suggestions · summary, links, tags"\)/u);
  assert.match(mainSource, /inspectTranscriptRepair\(/u);
  assert.match(mainSource, /addAction\("wrench", "Review and repair transcript"/u);
  assert.match(mainSource, /omd-note-view-action-label", text: "Review and repair transcript"/u);
  assert.match(mainSource, /active-leaf-change/u);
  assert.match(mainSource, /file-open/u);
  assert.match(modalSource, /Review and repair transcript/u);
  assert.match(modalSource, /Remove invalid tail/u);
  assert.match(modalSource, /Keep original/u);
  assert.match(modalSource, /Close/u);
  assert.match(modalSource, /Apply repair/u);
  assert.match(modalSource, /From here to end/u);
  assert.match(modalSource, /Re-transcribe selected range/u);
  assert.match(modalSource, /8 seconds of local context/u);
  assert.match(modalSource, /Current text/u);
  assert.match(modalSource, /New local transcript/u);
  assert.match(modalSource, /Replace selected range/u);
  assert.match(modalSource, /omd-transcript-repair-comparison-host/u);
  assert.match(modalSource, /if \(!lockAfterConflict\) this\.setRangeButtonsDisabled\(false\)/u);
  assert.match(mainSource, /saveTranscriptRepairBackup/u);
  assert.match(mainSource, /transcript-backups/u);
  assert.match(mainSource, /replaceTranscriptRange\(baseline, range, segments\)/u);
  assert.match(bridgeSource, /prepareTranscriptRepairMedia/u);
  assert.match(bridgeSource, /retranscribeTranscriptRange/u);
});
