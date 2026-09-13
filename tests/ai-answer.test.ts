import assert from "node:assert/strict";
import test from "node:test";
import {
  answerSourceCount,
  formatAiAnswerForClipboard,
  formatAnswerElapsedTime,
  scopedAiAnswerText,
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
    "Based on 2 retrieved notes.\n\nTen grounded tips.\n\nSources:\n- [[Sources/Web/tips.md]]\n- [[Sources/Web/mistakes.md]]",
  );
});

test("copies only the answer when no source paths are available", () => {
  assert.equal(formatAiAnswerForClipboard({ text: "  Local answer  ", evidence: [] }), "Local answer");
});

test("copy output never interpolates unsafe vault paths into Markdown structure", () => {
  const answer = {
    text: "Source states:\n- A cited fact. [S1]",
    evidence: [{ path: "safe.md]] injected\n[[evil", title: "", score: 1, evidence: "" }],
  };

  const copied = formatAiAnswerForClipboard(answer);
  assert.doesNotMatch(copied, /injected|evil/u);
  assert.match(copied, /Source 1 \(filename omitted because it contains Markdown link delimiters\)/u);
});

test("scopes one-note answers without implying whole-vault coverage", () => {
  const answer = {
    text: "Source states: The project uses weekly planning. [[Projects/Plan.md]]",
    evidence: [
      { path: "Projects/Plan.md", title: "Plan", score: 9, evidence: "Weekly planning" },
      { path: "Projects/Plan.md", title: "Plan", score: 8, evidence: "Duplicate section" },
    ],
  };
  assert.equal(answerSourceCount(answer), 1);
  assert.equal(
    scopedAiAnswerText(answer),
    "Based on 1 retrieved note.\n\nSource states: The project uses weekly planning. [[Projects/Plan.md]]",
  );
  assert.doesNotMatch(scopedAiAnswerText(answer), /entire vault|whole vault/iu);
});

test("does not duplicate an existing retrieved-note scope", () => {
  const answer = {
    text: "Based on 1 retrieved note.\n\nA cited fact. [[A.md]]",
    evidence: [{ path: "A.md", title: "A", score: 1, evidence: "Fact" }],
  };
  assert.equal(scopedAiAnswerText(answer), answer.text);
});

test("replaces a stale retrieved-note scope with the current unique source count", () => {
  const answer = {
    text: "Based on 2 retrieved notes.\n\nA cited fact. [[A.md]]",
    evidence: [{ path: "A.md", title: "A", score: 1, evidence: "Fact" }],
  };
  assert.equal(
    scopedAiAnswerText(answer),
    "Based on 1 retrieved note.\n\nA cited fact. [[A.md]]",
  );
});
