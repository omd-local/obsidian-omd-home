import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAiAnswerForClipboard,
  formatAnswerElapsedTime,
  guardSparseComparisonAnswer,
} from "../src/ai-answer.ts";

test("formats end-to-end answer timing for quick and longer responses", () => {
  assert.equal(formatAnswerElapsedTime(438), "438ms");
  assert.equal(formatAnswerElapsedTime(4_238), "4.2s");
  assert.equal(formatAnswerElapsedTime(14_700), "15s");
  assert.equal(formatAnswerElapsedTime(Number.NaN), "0ms");
});

test("formats an OMD answer with deduplicated Obsidian source links", () => {
  assert.equal(
    formatAiAnswerForClipboard({
      text: "  Ten grounded tips.  ",
      evidence: [
        { path: "Sources/Web/tips.md", title: "Tips", score: 10, evidence: "Ten tips" },
        { path: "Sources/Web/mistakes.md", title: "Mistakes", score: 9, evidence: "Three mistakes" },
        { path: "Sources/Web/tips.md", title: "Tips", score: 8, evidence: "Duplicate" },
      ],
    }),
    "Ten grounded tips.\n\nSources:\n- [[Sources/Web/tips.md]]\n- [[Sources/Web/mistakes.md]]",
  );
});

test("copies only the answer when no source paths are available", () => {
  assert.equal(formatAiAnswerForClipboard({ text: "  Local answer  ", evidence: [] }), "Local answer");
});

test("fails closed when a sparse comparison answer lists rejected pairs as no-overlap results", () => {
  const answer = guardSparseComparisonAnswer(
    "Across both notes, which recommendations overlap?",
    {
      text: "1. Warm up — no overlap.\nConclusion: zero overlapping recommendations.",
      evidence: [
        { path: "Sources/tips.md", title: "Tips", score: 10, evidence: "Warm up" },
        { path: "Sources/mistakes.md", title: "Mistakes", score: 9, evidence: "Warmups" },
      ],
    },
  );

  assert.match(answer.text, /could not verify a reliable overlap/u);
  assert.match(answer.text, /\[\[Sources\/tips\.md\]\]/u);
  assert.match(answer.text, /\[\[Sources\/mistakes\.md\]\]/u);
  assert.doesNotMatch(answer.text, /zero overlapping/u);
});

test("does not rewrite ordinary answers or supported comparison answers", () => {
  const ordinary = { text: "Ten tips.", evidence: [] };
  assert.equal(guardSparseComparisonAnswer("List all tips", ordinary), ordinary);

  const supported = {
    text: "Plan the sequence: [[A.md]] and [[B.md]].",
    evidence: [
      { path: "A.md", title: "A", score: 2, evidence: "Plan" },
      { path: "B.md", title: "B", score: 1, evidence: "Read" },
    ],
  };
  assert.equal(guardSparseComparisonAnswer("What overlaps across both notes?", supported), supported);
});

test("does not rewrite hybrid answers even when the model says overlap is missing", () => {
  const hybrid = {
    text: "No overlap was verified.",
    retrieval_mode: "hybrid" as const,
    evidence: [
      { path: "A.md", title: "A", score: 2, evidence: "Plan" },
      { path: "B.md", title: "B", score: 1, evidence: "Read" },
    ],
  };
  assert.equal(guardSparseComparisonAnswer("What overlaps across both notes?", hybrid), hybrid);
});
