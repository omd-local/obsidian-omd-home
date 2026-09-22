import assert from "node:assert/strict";
import test from "node:test";
import {
  canApplyEnrichment,
  createEnrichmentSelection,
  describeEnrichmentPhase,
  reconcileEnrichmentSelection,
  selectedEnrichmentCount,
  toggleEnrichmentSelection,
  updateEnrichmentSummarySelection,
  type EnrichmentReviewState,
} from "../src/enrichment/workflow.ts";

const baseState: EnrichmentReviewState = {
  phase: "review",
  targetPath: "Inbox/article.md",
  model: "qwen3:4b-instruct",
  endpoint: "http://127.0.0.1:11434",
  summary: "Add a vault link and a new tag.",
  existingLinks: [
    { id: "link-1", kind: "existing-link", label: "Calendar workflow", path: "Calendar/workflows.md", evidence: "Mentions recurring sync steps." },
  ],
  existingTags: [
    { id: "tag-1", kind: "existing-tag", label: "project/research", path: "#project/research", evidence: "Used elsewhere in the vault." },
  ],
  newTags: [
    { id: "new-tag-1", kind: "new-tag", label: "#omd/review", evidence: "Best matches the current note." },
  ],
  concepts: [
    { id: "concept-1", kind: "new-concept", label: "Calendar workflow map", evidence: "Concept only." , selectable: false },
  ],
  warnings: ["Candidate list is short."],
};

test("phase copy labels review and generating states distinctly", () => {
  assert.equal(describeEnrichmentPhase("generating").tone, "busy");
  assert.equal(describeEnrichmentPhase("review").canApply, true);
  assert.equal(describeEnrichmentPhase("applied").terminal, false);
  assert.equal(describeEnrichmentPhase("reviewed").terminal, true);
  assert.deepEqual(describeEnrichmentPhase("unavailable"), {
    title: "Note unavailable",
    detail: "The target note or one of its candidates can no longer be read safely.",
    tone: "warning",
    terminal: true,
    canApply: false,
  });
  assert.deepEqual(describeEnrichmentPhase("partial-failure"), {
    title: "Apply incomplete",
    detail: "Some selected content may be present, but the note's Properties were not finalized.",
    tone: "danger",
    terminal: true,
    canApply: false,
  });
});

test("selection defaults existing suggestions on and new tags off", () => {
  const selection = createEnrichmentSelection(baseState);
  assert.equal(selection.selectedIds["link-1"], true);
  assert.equal(selection.selectedIds["tag-1"], true);
  assert.equal(selection.selectedIds["new-tag-1"], false);
  assert.equal(selection.selectedIds["concept-1"], undefined);
  assert.equal(selection.includeSummary, false);
  assert.equal(selection.summaryDraft, baseState.summary);
  assert.deepEqual(selectedEnrichmentCount(baseState, selection), { selected: 2, available: 3 });
  assert.equal(canApplyEnrichment(baseState, selection), true);
});

test("selection toggles immutably", () => {
  const selection = createEnrichmentSelection(baseState);
  const toggled = toggleEnrichmentSelection(selection, "new-tag-1", true);
  assert.notEqual(toggled, selection);
  assert.equal(toggled.selectedIds["new-tag-1"], true);
  assert.equal(selection.selectedIds["new-tag-1"], false);
});

test("summary is optional, editable, and can be the only applied item", () => {
  const emptySuggestions = {
    ...baseState,
    existingLinks: [],
    existingTags: [],
    newTags: [],
  };
  const initial = createEnrichmentSelection(emptySuggestions);
  assert.equal(canApplyEnrichment(emptySuggestions, initial), false);
  const included = updateEnrichmentSummarySelection(initial, {
    includeSummary: true,
    summaryDraft: "Edited 中文 summary.",
  });
  assert.equal(canApplyEnrichment(emptySuggestions, included), true);
  assert.equal(canApplyEnrichment(emptySuggestions, updateEnrichmentSummarySelection(included, { summaryDraft: "   " })), false);
});

test("selection keeps an edited draft across phase renders and resets it for a new proposal", () => {
  const selected = updateEnrichmentSummarySelection(createEnrichmentSelection(baseState), {
    includeSummary: true,
    summaryDraft: "User edit",
  });
  const applying = reconcileEnrichmentSelection({ ...baseState, phase: "applying" }, selected);
  assert.equal(applying.includeSummary, true);
  assert.equal(applying.summaryDraft, "User edit");
  const regenerated = reconcileEnrichmentSelection({ ...baseState, summary: "Fresh model summary" }, applying);
  assert.equal(regenerated.includeSummary, false);
  assert.equal(regenerated.summaryDraft, "Fresh model summary");
});
