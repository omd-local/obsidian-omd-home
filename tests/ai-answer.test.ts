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
    "Based on 1 retrieved note.\n\nFrom the note: The project uses weekly planning. [[Projects/Plan.md]]",
  );
  assert.doesNotMatch(scopedAiAnswerText(answer), /entire vault|whole vault/iu);
});

test("shows the same facts and interpretation in the answer and clipboard", () => {
  const answer = {
    text: "Source states:\n- Morgan owns the review. [[A.md]]\n- It is on Friday. [[B.md]]\n\nModel inference:\n- Consider coordinating with Morgan. [[A.md]] [[B.md]]",
    evidence: [
      { path: "A.md", title: "A", score: 2, evidence: "The owner is Morgan." },
      { path: "B.md", title: "B", score: 1, evidence: "Friday review" },
    ],
  };
  const expected = "Based on 2 retrieved notes.\n\nFrom your notes:\n- Morgan owns the review. [[A.md]]\n- It is on Friday. [[B.md]]\n\nWhat this may mean:\n- Consider coordinating with Morgan. [[A.md]] [[B.md]]";
  assert.equal(scopedAiAnswerText(answer), expected);
  assert.equal(formatAiAnswerForClipboard(answer), `${expected}\n\nSources:\n- [[A.md]]\n- [[B.md]]`);
});

test("hides an empty inference section and exact placeholders with or without Markdown and citations", () => {
  const fact = "- None. [[A.md]]";
  const evidence = [{ path: "A.md", title: "A", score: 1, evidence: "There are no meetings." }];
  const expected = `Based on 1 retrieved note.\n\nFrom the note:\n${fact}`;

  for (const placeholder of ["", "- None.", "1. N/A", "- Not applicable.", "- No additional inference.", "- 无。", "- 无额外推断。", "- 不适用。", "- **None**. [[A.md]]", "2) _N/A_ [S1].", "- `无。` [[A.md]], [E1]", "- [S1, S2]"]) {
    const answer = { text: `Source states:\n${fact}\n\nModel inference:\n${placeholder}`, evidence };
    assert.equal(scopedAiAnswerText(answer), expected, placeholder);
    assert.equal(formatAiAnswerForClipboard(answer), `${expected}\n\nSources:\n- [[A.md]]`, placeholder);
  }
});

test("preserves cited inference claims with placeholder-like words", () => {
  const inference = "- None of the reviews has a confirmed owner. [[A.md]]\n- No additional inference is needed for the Friday review. [[A.md]]";
  const answer = {
    text: `Source states:\n- The review is Friday. [[A.md]]\n\nModel inference:\n- None.\n${inference}`,
    evidence: [{ path: "A.md", title: "A", score: 1, evidence: "Friday review" }],
  };

  assert.equal(
    scopedAiAnswerText(answer),
    `Based on 1 retrieved note.\n\nFrom the note:\n- The review is Friday. [[A.md]]\n\nWhat this may mean:\n${inference}`,
  );
});

test("presents Markdown headings and preserves substantive non-actionable interpretations", () => {
  const fact = "- Friday is still open. [[A.md]]";
  const inference = "- 无法确定评审日期。 [[A.md]]";
  for (const [source, model] of [
    ["### **Source states:**", "### **Model inference:**"],
    ["**Source states**:", "__Model inference__:"],
    ["## Source states", "- **Model inference:**"],
  ]) {
    const text = `${source}\n${fact}\n\n${model}\n- **None**. [[A.md]]\n${inference}`;
    const evidence = [{ path: "A.md", title: "A", score: 1, evidence: "Friday is still open." }];
    const expected = `Based on 1 retrieved note.\n\nFrom the note:\n${fact}\n\nWhat this may mean:\n${inference}`;
    assert.equal(scopedAiAnswerText({ text, evidence }), expected);
    assert.equal(formatAiAnswerForClipboard({ text, evidence }), `${expected}\n\nSources:\n- [[A.md]]`);
  }
});

test("leaves label-like text inside claims and unstructured answers intact", () => {
  const evidence = [{ path: "Model inference:.md", title: "A", score: 1, evidence: "Example" }];
  const claim = '- The heading reads "Source states:" followed by "Model inference:". [[Model inference:.md]]';
  const answer = { text: `Source states:\n${claim}\n\nModel inference: None.`, evidence };
  assert.equal(scopedAiAnswerText(answer), `Based on 1 retrieved note.\n\nFrom the note:\n${claim}`);
  assert.equal(scopedAiAnswerText({ text: claim, evidence }), `Based on 1 retrieved note.\n\n${claim}`);
});

test("keeps a cited source claim named Model inference in the facts section", () => {
  const answer = {
    text: "Source states:\n- **Model inference**: the paper uses a linear regression. [[Paper.md]]\n\nModel inference:\n- None.",
    evidence: [{ path: "Paper.md", title: "Paper", score: 1, evidence: "The paper uses a linear regression." }],
  };
  assert.equal(
    scopedAiAnswerText(answer),
    "Based on 1 retrieved note.\n\nFrom the note:\n- **Model inference**: the paper uses a linear regression. [[Paper.md]]",
  );
});

test("keeps an inference claim named Model inference inside the interpretation section", () => {
  const answer = {
    text: "Source states:\n- The paper reports a correlation. [[Paper.md]]\n\nModel inference:\n- **Model inference**: the correlation does not prove causation. [[Paper.md]]",
    evidence: [{ path: "Paper.md", title: "Paper", score: 1, evidence: "The paper reports a correlation." }],
  };
  assert.equal(
    scopedAiAnswerText(answer),
    "Based on 1 retrieved note.\n\nFrom the note:\n- The paper reports a correlation. [[Paper.md]]\n\nWhat this may mean:\n- **Model inference**: the correlation does not prove causation. [[Paper.md]]",
  );
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
