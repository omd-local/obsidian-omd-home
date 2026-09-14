import assert from "node:assert/strict";
import test from "node:test";
import { buildEnrichmentRequest, isLoopbackHttpUrl } from "../src/enrichment/request-builder.ts";
import { sha256HexUtf8 } from "../src/enrichment/contract.ts";
import { OmdEnrichmentError } from "../src/enrichment/errors.ts";

test("isLoopbackHttpUrl accepts local endpoints only", () => {
  assert.equal(isLoopbackHttpUrl("http://localhost:11434"), true);
  assert.equal(isLoopbackHttpUrl("http://127.0.0.1:11434"), true);
  assert.equal(isLoopbackHttpUrl("https://api.example.com"), false);
});

test("buildEnrichmentRequest trims lowest-priority candidates to fit the request budget", () => {
  const hugeAlias = "a".repeat(244);
  const hugeTag = "t".repeat(116);
  const result = buildEnrichmentRequest({
    requestId: "request-1",
    vaultPath: "/vault",
    target: {
      path: "Inbox/example.md",
      basename: "Example",
      content: "Body",
      aliases: [],
      tags: [],
      outgoingLinks: [],
      incomingLinks: [],
    },
    candidates: Array.from({ length: 200 }, (_, index) => ({
      id: `candidate-${index + 1}`,
      path: `Notes/Candidate-${index + 1}.md`,
      title: `Candidate ${index + 1}`,
      aliases: Array.from({ length: 32 }, (__, aliasIndex) => `${hugeAlias}-${index + 1}-${aliasIndex + 1}`),
      tags: Array.from({ length: 64 }, (__, tagIndex) => `${hugeTag}-${index + 1}-${tagIndex + 1}`),
      evidence: "x".repeat(400),
      relationScore: 200 - index,
      exactMatchScore: 0,
      lexicalOverlapScore: 0,
    })),
    vaultTags: ["workflow"],
    model: "qwen3:4b-instruct",
    host: "http://localhost:11434",
  });
  assert.ok(result.retainedCandidates.length < 200);
  assert.ok(result.retainedCandidates.length > 0);
  assert.equal(result.retainedCandidates[0]?.id, "candidate-1");
  assert.equal(result.request.note.path, "Inbox/example.md");
});

test("buildEnrichmentRequest normalizes multiline evidence into safe single-line text", () => {
  const result = buildEnrichmentRequest({
    requestId: "request-2",
    vaultPath: "/vault",
    target: {
      path: "Inbox/example.md",
      basename: "Example",
      content: "Body",
      aliases: [],
      tags: [],
      outgoingLinks: [],
      incomingLinks: [],
    },
    candidates: [
      {
        id: "candidate-1",
        path: "Notes/Candidate.md",
        title: "Candidate",
        aliases: [],
        tags: [],
        evidence: "line one\nline two\tline three\r\nline four",
        relationScore: 100,
        exactMatchScore: 0,
        lexicalOverlapScore: 0,
      },
    ],
    vaultTags: [],
    model: "qwen3:4b-instruct",
    host: "http://localhost:11434",
  });

  assert.equal(result.request.candidates[0].evidence, "line one line two line three line four");
  assert.equal(result.retainedCandidates[0]?.id, "candidate-1");
});

test("buildEnrichmentRequest truncates oversized evidence after normalization", () => {
  const result = buildEnrichmentRequest({
    requestId: "request-3",
    vaultPath: "/vault",
    target: {
      path: "Inbox/example.md",
      basename: "Example",
      content: "Body",
      aliases: [],
      tags: [],
      outgoingLinks: [],
      incomingLinks: [],
    },
    candidates: [
      {
        id: "candidate-1",
        path: "Notes/Candidate.md",
        title: "Candidate",
        aliases: [],
        tags: [],
        evidence: `alpha ${"beta ".repeat(300)}\n${"gamma ".repeat(300)}`,
        relationScore: 100,
        exactMatchScore: 0,
        lexicalOverlapScore: 0,
      },
    ],
    vaultTags: [],
    model: "qwen3:4b-instruct",
    host: "http://localhost:11434",
  });

  assert.ok(result.request.candidates[0].evidence.length <= 400);
  assert.ok(!result.request.candidates[0].evidence.includes("\n"));
});

test("candidate evidence rejects raw prohibited controls before folding or truncation", () => {
  const controls = Array.from({ length: 32 }, (_, code) => code)
    .filter((code) => ![0x09, 0x0a, 0x0d].includes(code));
  controls.push(0x7f);
  for (const code of controls) {
    for (const prefix of ["", "x".repeat(401)]) {
      const evidence = `${prefix}${String.fromCodePoint(code)}private candidate text`;
      const input = evidenceRequest(evidence);
      const before = structuredClone(input);
      assert.throws(() => buildEnrichmentRequest(input), (error: unknown) => {
        assert.ok(error instanceof OmdEnrichmentError);
        assert.equal(error.code, "invalid_candidate_evidence", `control ${code}`);
        assert.match(error.message, /candidate note snippet/iu);
        assert.doesNotMatch(error.message, /private candidate text|generate again|model/iu);
        return true;
      });
      assert.deepEqual(input, before);
    }
  }
});

test("candidate evidence rejects nonstrings with a safe classified error", () => {
  for (const evidence of [undefined, null, 42, {}, ["private candidate text"]]) {
    assert.throws(() => buildEnrichmentRequest(evidenceRequest(evidence)), (error: unknown) =>
      error instanceof OmdEnrichmentError && error.code === "invalid_candidate_evidence");
  }
});

test("candidate evidence folds Unicode White_Space and preserves the Unicode BOM", () => {
  const whitespace = "\t\n\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000";
  const { request } = buildEnrichmentRequest(evidenceRequest(`${whitespace}alpha${whitespace}beta${whitespace}`));
  assert.equal(request.candidates[0].evidence, "alpha beta");

  const withBom = buildEnrichmentRequest(evidenceRequest(" \ufeff alpha\u0085beta \ufeff "));
  assert.equal(withBom.request.candidates[0].evidence, "\ufeff alpha beta \ufeff");
});

test("candidate evidence truncates Unicode code points and preserves exact note content and hash", () => {
  const evidence = `${"\u{1f680}".repeat(399)}\u0085tail`;
  const input = evidenceRequest(evidence);
  input.target.content = "\ufeffNote\r\n\t\u000b\u0085\u{1f680}";
  const { request } = buildEnrichmentRequest(input);
  assert.equal(request.candidates[0].evidence, `${"\u{1f680}".repeat(399)} `);
  assert.equal([...request.candidates[0].evidence].length, 400);
  assert.equal(request.note.content, input.target.content);
  assert.equal(request.note.content_sha256, sha256HexUtf8(input.target.content));
  assert.equal(input.candidates[0].evidence, evidence);
});

function evidenceRequest(evidence: unknown): Parameters<typeof buildEnrichmentRequest>[0] {
  return {
    requestId: "request-evidence",
    vaultPath: "/vault",
    target: {
      path: "Inbox/example.md", basename: "Example", content: "Body",
      aliases: [], tags: [], outgoingLinks: [], incomingLinks: [],
    },
    candidates: [{
      id: "candidate-1", path: "Notes/Candidate.md", title: "Candidate",
      aliases: [], tags: [], evidence: evidence as string,
      relationScore: 100, exactMatchScore: 0, lexicalOverlapScore: 0,
    }],
    vaultTags: [], model: "qwen3:4b-instruct", host: "http://localhost:11434",
  };
}
