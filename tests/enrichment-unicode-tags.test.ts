import assert from "node:assert/strict";
import test from "node:test";
import { buildEnrichmentRequest } from "../src/enrichment/request-builder.ts";
import { validateEnrichResponse, type OmdEnrichRequest } from "../src/enrichment/contract.ts";

function requestFor(tags: string[]): OmdEnrichRequest {
  return buildEnrichmentRequest({
    requestId: "unicode-tags", vaultPath: "/vault",
    target: { path: "Inbox/中文 العربية.md", basename: "中文 العربية", content: "Multilingual source.", aliases: [], tags: [], outgoingLinks: [], incomingLinks: [] },
    candidates: [{ id: "candidate-1", path: "Notes/한국어.md", title: "한국어", aliases: [], tags, evidence: "Multilingual source.", relationScore: 1, exactMatchScore: 0, lexicalOverlapScore: 1 }],
    vaultTags: tags, model: "qwen3:0.6b", host: "http://localhost:11434",
  }).request;
}

function responseFor(request: OmdEnrichRequest, tag: string) {
  return {
    schema_version: 1, request_id: request.request_id, action: request.action,
    note: { path: request.note.path, content_sha256: request.note.content_sha256 },
    proposal: { summary: "Multilingual source.", existing_links: [], new_concepts: [], existing_tags: [], new_tags: [{ tag, reason: "Source topic." }] },
    warnings: [], generation: { provider: "ollama", model: request.model, endpoint_class: "local_loopback" },
  };
}

test("request retains Unicode letters, marks and numbers in vault and candidate tags", () => {
  const tags = [" #بحث_دلالي ", "#بَحْث/دَلَالِي", "한국어_검색", "CAFE\u0301/ÉTUDES", "语义检索_日本語", "हिन्दी_खोज", "#ＭＬ/１２٣", "safe\u202eunsafe🧪tag", "##topic___name / sub...tag"];
  const expected = ["بحث-دلالي", "بَحْث/دَلَالِي", "한국어-검색", "café/études", "语义检索-日本語", "हिन्दी-खोज", "ｍｌ/１２٣", "safe-unsafe-tag", "topic---name-/-sub-tag"];
  const request = requestFor(tags);
  assert.deepEqual(request.vault_tags, expected);
  assert.deepEqual(request.candidates[0]?.tags, expected);
});

test("request deduplicates NFC-equivalent tags and keeps the existing length bound", () => {
  const request = requestFor(["café", "cafe\u0301", "بحث", "한".repeat(129)]);
  assert.deepEqual(request.vault_tags, ["café", "بحث"]);
});

test("response accepts canonical Unicode generated tags from the backend", () => {
  const request = requestFor([]);
  for (const tag of ["بحث-دلالي", "بَحْث/دَلَالِي", "한국어-검색", "café/études", "हिन्दी-खोज", "ｍｌ/１２٣"]) {
    const response = validateEnrichResponse(responseFor(request, tag), request, new Map());
    assert.equal(response.proposal.new_tags[0]?.tag, tag);
  }
});

test("response still rejects noncanonical Unicode, controls, symbols, and long tags", () => {
  const request = requestFor([]);
  for (const tag of ["cafe\u0301", "بحث_دلالي", "safe\u202eunsafe", "بحث🧪", "한".repeat(129)]) {
    assert.throws(() => validateEnrichResponse(responseFor(request, tag), request, new Map()));
  }
});

test("wire tag identity keeps casefold-expanding spellings distinct", () => {
  const tags = ["straße", "strasse", "οσ", "ος"];
  const request = requestFor(tags);
  assert.deepEqual(request.vault_tags, tags);
  const response = responseFor(request, "unused");
  const parsed = validateEnrichResponse({
    ...response,
    proposal: {
      ...response.proposal,
      new_tags: [],
      existing_tags: tags.map((tag) => ({ tag, reason: "A supported topic label.", recommended: true })),
    },
  }, request, new Map());
  assert.deepEqual(parsed.proposal.existing_tags.map((item) => item.tag), tags);
});
