import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { describeEnrichmentFailure, mapOmdErrorKind } from "../src/enrichment/errors.ts";
import {
  canApplyEnrichment,
  emptyReviewState,
  selectedSuggestions,
  type EnrichmentReviewState,
  type EnrichmentSelection,
} from "../src/enrichment/workflow.ts";

const controllerSource = readFileSync(resolve("src/enrichment/controller.ts"), "utf8");
const reviewViewSource = readFileSync(resolve("src/enrichment/review-view.ts"), "utf8");
const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
const stylesSource = readFileSync(resolve("src/styles.css"), "utf8");

test("review uses a registered right sidebar ItemView instead of a blocking modal", () => {
  assert.match(reviewViewSource, /class EnrichmentReviewView extends ItemView/u);
  assert.doesNotMatch(reviewViewSource, /extends Modal|new Modal/u);
  assert.match(mainSource, /registerView\(ENRICHMENT_REVIEW_VIEW_TYPE/u);
  const open = extractMember(controllerSource, "private async open(");
  assert.match(open, /workspace\.openLinkText\(file\.path, "", false\)/u);
  assert.match(open, /workspace\.ensureSideLeaf\([\s\S]*"right"/u);
});

test("Inbox review opens the pane without invoking local AI", () => {
  const review = extractMember(controllerSource, "async review(file: TFile): Promise<void>");
  assert.match(review, /this\.open\(file, false\)/u);
  assert.doesNotMatch(review, /generate|requireReadyOmdExecutable|runLocalAiGated/u);
  assert.match(mainSource, /async reviewNote\(/u);
  assert.match(mainSource, /this\.enrichmentWorkflowController\.review\(file\)/u);
});

test("Suggest links and tags still opens the same pane with automatic generation", () => {
  const start = extractMember(controllerSource, "async start(file: TFile): Promise<void>");
  assert.match(start, /this\.open\(file, true\)/u);
  assert.match(mainSource, /this\.enrichmentWorkflowController\.start\(file\)/u);
});

test("only live suggestion generation is cancellable", () => {
  const canCancel = extractMember(controllerSource, "get canCancel(): boolean");
  assert.match(canCancel, /phase === "capability"/u);
  assert.match(canCancel, /phase === "catalog"/u);
  assert.match(canCancel, /phase === "generating"/u);
  assert.doesNotMatch(canCancel, /phase === "review"|phase === "applying"|phase === "finishing"/u);
});

test("generation releases the OMD mutex when the proposal becomes reviewable", () => {
  const generate = extractMember(controllerSource, "private async generate(");
  const reviewAt = generate.indexOf("active.state = reviewState(");
  const releaseAt = generate.indexOf("this.setBusy(false);", reviewAt);
  assert.ok(reviewAt >= 0 && releaseAt > reviewAt);
});

test("Apply suggestions does not finish review", () => {
  const apply = extractMember(controllerSource, "private async apply(");
  assert.match(apply, /markReviewed: false/u);
  assert.match(apply, /selectedSummary: payload\.selection\.includeSummary \? payload\.selection\.summaryDraft : undefined/u);
  assert.match(apply, /The note remains in Inbox\./u);
  assert.doesNotMatch(apply, /refreshInboxStatus\([^,]+, "reviewed"\)/u);
});

test("Done reviewing is the only controller action that writes Reviewed status", () => {
  const done = extractMember(controllerSource, "private async doneReviewing(");
  assert.match(done, /refreshInboxStatus\(file, "reviewed"\)/u);
  assert.match(done, /getFileByPath\(active\.file\.path\)/u);
  assert.match(done, /file !== active\.file/u, "a replacement file at the same path must not inherit the review decision");
  assert.doesNotMatch(done, /active\.request|originalHash|originalContent|vault\.modify/u);
  assert.equal(controllerSource.match(/refreshInboxStatus\(file, "reviewed"\)/gu)?.length, 1);
});

test("closing the pane clears transient review state without marking the note reviewed", () => {
  const closed = extractMember(controllerSource, "private viewClosed(");
  assert.match(closed, /this\.active = null/u);
  assert.match(closed, /abortController\?\.abort\(\)/u);
  assert.doesNotMatch(closed, /refreshInboxStatus|reviewed/u);
  assert.doesNotMatch(reviewViewSource, /getState\(|setState\(/u, "review data must not be persisted as workspace view state");
});

test("review actions keep Apply suggestions separate from Done reviewing", async () => {
  const idle = renderActions(emptyReviewState("Inbox/example.md", "local-model", "http://localhost:11434"));
  assert.deepEqual(idle.buttons.map((button) => button.label), ["Keep in Inbox", "Generate suggestions", "Done reviewing"]);
  await idle.buttons[2].action();
  assert.equal(idle.done, 1);
  assert.equal(idle.generates, 0);

  const review = renderActions({
    ...emptyReviewState("Inbox/example.md", "local-model", "http://localhost:11434"),
    phase: "review",
    existingTags: [{ id: "tag-1", kind: "existing-tag", label: "#writing", selected: true }],
  }, {
    selectedIds: { "tag-1": true },
    includeSummary: false,
    summaryDraft: "",
    summarySource: "",
  });
  assert.deepEqual(review.buttons.map((button) => button.label), ["Keep in Inbox", "Apply suggestions", "Done reviewing"]);
  await review.buttons[1].action();
  assert.equal(review.applies, 1);
  assert.equal(review.done, 0);
});

test("an edited summary can be applied by itself and stays opt-in", async () => {
  assert.match(reviewViewSource, /text: "Add summary to note"/u);
  assert.match(reviewViewSource, /includeSummary: false/u);
  assert.match(reviewViewSource, /cls: "omd-enrichment-summary-editor"/u);
  assert.match(reviewViewSource, /text: "Copy summary"/u);
  const state = {
    ...emptyReviewState("Inbox/example.md", "local-model", "http://localhost:11434"),
    phase: "review" as const,
    summary: "Model summary",
  };
  const rendered = renderActions(state, {
    selectedIds: {},
    includeSummary: true,
    summaryDraft: "Edited summary",
    summarySource: "Model summary",
  });
  assert.equal(rendered.buttons[1]?.label, "Apply suggestions");
  assert.equal(rendered.buttons[1]?.disabled, false);
  await rendered.buttons[1]?.action();
  assert.equal(rendered.applies, 1);
});

test("invalid edited summaries expose their error state to assistive technology", () => {
  assert.match(reviewViewSource, /syncSummaryError\(summaryError, textarea\)/u);
  assert.match(reviewViewSource, /textarea\?\.setAttribute\("aria-invalid", String\(Boolean\(message\)\)\)/u);
});

test("cancel, error, conflict and applied states remain explicitly finishable", () => {
  for (const phase of ["cancelled", "error", "conflict", "applied"] as const) {
    const rendered = renderActions({
      ...emptyReviewState("Inbox/example.md", "local-model", "http://localhost:11434"),
      phase,
    });
    assert.deepEqual(rendered.buttons.map((button) => button.label), ["Keep in Inbox", "Generate again", "Done reviewing"]);
  }
});

test("an apply error with a retained proposal keeps Copy summary and Open note recovery", async () => {
  const state = {
    ...emptyReviewState("Inbox/example.md", "local-model", "http://localhost:11434"),
    phase: "error" as const,
    summary: "Summary that could not be written.",
  };
  const rendered = renderActions(state);
  assert.deepEqual(rendered.buttons.map((button) => button.label), ["Keep in Inbox", "Open note", "Generate again", "Done reviewing"]);
  await rendered.buttons[1]?.action();
  assert.deepEqual(rendered.openedPaths, ["Inbox/example.md"]);
  assert.match(reviewViewSource, /if \(showsProposal\(this\.state\)\) this\.renderProposal\(scroll\)/u);
  assert.match(reviewViewSource, /Nothing was written\. Copy the summary or open the note, then generate again\./u);
});

test("a retained proposal without summary does not offer a misleading copy instruction", () => {
  assert.match(
    reviewViewSource,
    /state\.summary\.trim\(\)[\s\S]*Nothing was written\. Copy the summary[\s\S]*Nothing was written\. Review the proposal/u,
  );
});

test("candidate evidence failures can disable regeneration without removing Done reviewing", () => {
  const known = mapOmdErrorKind("invalid_request", undefined, "private terminal text", {
    field: "candidate.evidence", reason: "incompatible_text",
  });
  const state = {
    ...emptyReviewState("Inbox/example.md", "local-model", "http://localhost:11434"),
    ...describeEnrichmentFailure(known, "generation"),
  };
  const rendered = renderActions(state);
  assert.deepEqual(rendered.buttons.map((button) => button.label), ["Keep in Inbox", "Done reviewing"]);
});

test("unknown catalog tag omissions have concise user-facing copy", () => {
  assert.match(reviewViewSource, /case "unknown_tag_reference_omitted"[\s\S]*unknown catalog reference and was left out/u);
});

test("generation uses a namespaced non-overlapping progress indicator", () => {
  assert.match(reviewViewSource, /omd-enrichment-status-badge--loading/u);
  assert.match(reviewViewSource, /omd-enrichment-loading-indicator/u);
  assert.doesNotMatch(reviewViewSource, /[" ]is-loading[" ]/u);
  assert.doesNotMatch(stylesSource, /\.omd-enrichment-status-badge\.is-loading/u);
  assert.match(stylesSource, /\.omd-enrichment-status-badge--loading\s*\{[^}]*grid-template-columns:\s*13px minmax\(0, 1fr\)[^}]*gap:\s*6px/su);
  assert.match(stylesSource, /\.omd-enrichment-loading-indicator\s*\{[^}]*align-self:\s*start[^}]*margin-block-start:\s*1px/su);
  assert.match(stylesSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.omd-enrichment-loading-indicator\s*\{[^}]*animation:\s*none/su);
});

function renderActions(state: EnrichmentReviewState, selection: EnrichmentSelection = {
  selectedIds: {},
  includeSummary: false,
  summaryDraft: "",
  summarySource: "",
}): {
  buttons: Array<{ label: string; action: () => void | Promise<void>; disabled: boolean }>;
  generates: number;
  cancels: number;
  applies: number;
  done: number;
  openedPaths: string[];
} {
  const source = ts.createSourceFile("review-view.ts", reviewViewSource, ts.ScriptTarget.Latest, true);
  const member = source.statements
    .flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : [])
    .find((node) => node.name?.getText(source) === "renderActions");
  assert.ok(member, "The production review view must define renderActions");
  const showsProposal = extractMember(reviewViewSource, "function showsProposal(");
  const compiled = ts.transpileModule(`${showsProposal}\nclass Harness { ${member.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const harness = new Function("canApplyEnrichment", "selectedSuggestions", `${compiled}\nreturn new Harness();`)(
    canApplyEnrichment, selectedSuggestions,
  ) as { renderActions: (parent: unknown) => void };
  const result = {
    buttons: [] as Array<{ label: string; action: () => void | Promise<void>; disabled: boolean }>,
    generates: 0,
    cancels: 0,
    applies: 0,
    done: 0,
    openedPaths: [] as string[],
  };
  Object.assign(harness, {
    state,
    selection,
    callbacks: {
      onGenerate() { result.generates += 1; },
      onCancelGeneration() { result.cancels += 1; },
      onApply() { result.applies += 1; },
      onDoneReviewing() { result.done += 1; },
      onOpenPath(path: string) { result.openedPaths.push(path); },
    },
    closeReview() {},
    button(_parent: unknown, label: string, _primary: boolean, action: () => void | Promise<void>) {
      const button = { label, action, disabled: false, setAttribute() {} };
      result.buttons.push(button);
      return button;
    },
  });
  harness.renderActions({});
  return result;
}

function extractMember(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Missing ${signature}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${signature}`);
}
