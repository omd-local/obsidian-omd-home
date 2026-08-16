import assert from "node:assert/strict";
import test from "node:test";
import {
  capabilitySupportsEnrichNote,
  ENRICH_NOTE_ACTION,
  sha256HexUtf8,
  utf8ByteLength,
  validateEnrichResponse,
  type OmdEnrichRequest,
} from "../src/enrichment/contract.ts";

test("capabilitySupportsEnrichNote accepts additive capability fields", () => {
  assert.equal(capabilitySupportsEnrichNote({
    enrich_note: {
      supported: true,
      schema_versions: [1],
      extra: "ok",
    },
  }), true);
});

test("utf8 helpers hash and count exact bytes", () => {
  assert.equal(utf8ByteLength("本地AI"), Buffer.byteLength("本地AI", "utf8"));
  assert.equal(sha256HexUtf8("hello"), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

test("validateEnrichResponse accepts canonical shape with additive fields", () => {
  const request = sampleRequest();
  const response = validateEnrichResponse({
    schema_version: 1,
    request_id: request.request_id,
    action: ENRICH_NOTE_ACTION,
    note: {
      path: request.note.path,
      content_sha256: request.note.content_sha256,
    },
    proposal: {
      summary: "Summary",
      existing_links: [{
        candidate_id: "candidate-1",
        target_path: "Notes/Local AI.md",
        display: "Local AI",
        reason: "Related",
        evidence: "Local AI workflows",
        recommended: true,
        extra: "ok",
      }],
      new_concepts: [{ label: "Concept", reason: "Potential note" }],
      existing_tags: [{ tag: "workflow", reason: "Matches", recommended: true }],
      new_tags: [{ tag: "knowledge-workflow", reason: "Useful" }],
    },
    warnings: ["fine"],
    generation: {
      provider: "ollama",
      model: "qwen3:4b-instruct",
      endpoint_class: "local_loopback",
    },
    additive: true,
  }, request, candidateMap(request));
  assert.equal(response.proposal.existing_links[0]?.target_path, "Notes/Local AI.md");
});

test("validateEnrichResponse rejects mismatched candidate paths", () => {
  const request = sampleRequest();
  assert.throws(() => validateEnrichResponse({
    schema_version: 1,
    request_id: request.request_id,
    action: ENRICH_NOTE_ACTION,
    note: {
      path: request.note.path,
      content_sha256: request.note.content_sha256,
    },
    proposal: {
      summary: "Summary",
      existing_links: [{
        candidate_id: "candidate-1",
        target_path: "Wrong.md",
        display: "Local AI",
        reason: "Related",
        evidence: "Local AI workflows",
        recommended: true,
      }],
      new_concepts: [],
      existing_tags: [],
      new_tags: [],
    },
    warnings: [],
    generation: {
      provider: "ollama",
      model: "qwen3:4b-instruct",
      endpoint_class: "local_loopback",
    },
  }, request, new Map([["candidate-1", request.candidates[0]!]])), /mismatched path/i);
});

function sampleRequest(): OmdEnrichRequest {
  const content = "Local AI workflows";
  return {
    schema_version: 1,
    request_id: "request-1",
    action: "enrich_note_preview",
    vault_path: "/vault",
    note: {
      path: "Inbox/example.md",
      content,
      content_sha256: sha256HexUtf8(content),
    },
    candidates: [{
      id: "candidate-1",
      path: "Notes/Local AI.md",
      title: "Local AI",
      aliases: [],
      tags: ["workflow"],
      evidence: "Local AI workflows",
    }],
    vault_tags: ["workflow"],
    model: "qwen3:4b-instruct",
    host: "http://localhost:11434",
  };
}

function candidateMap(request: OmdEnrichRequest) {
  return new Map(request.candidates.map((candidate) => [candidate.id, candidate]));
}
