import assert from "node:assert/strict";
import test from "node:test";
import { buildEnrichmentRequest, isLoopbackHttpUrl } from "../src/enrichment/request-builder.ts";

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
