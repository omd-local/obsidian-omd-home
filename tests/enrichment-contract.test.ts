import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  capabilitySupportsEnrichNote,
  ENRICH_NOTE_ACTION,
  ensureLoopbackHost,
  sha256HexUtf8,
  utf8ByteLength,
  validateEnrichEvent,
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

test("validateEnrichEvent requires v=1 and ts while allowing additive fields", () => {
  assert.deepEqual(validateEnrichEvent({
    v: 1,
    ts: 1_723_456_789,
    event: "progress",
    stage: "generate",
    request_id: "request-1",
    extra: true,
  }), {
    v: 1,
    ts: 1_723_456_789,
    event: "progress",
    stage: "generate",
    request_id: "request-1",
    extra: true,
  });
  assert.throws(() => validateEnrichEvent({ event: "done", ts: 1 }), /event\.v/i);
  assert.throws(() => validateEnrichEvent({ v: 1, event: "done" }), /event\.ts/i);
});

test("ensureLoopbackHost accepts only credential-free loopback base URLs", () => {
  assert.equal(ensureLoopbackHost("http://localhost:11434"), "http://localhost:11434");
  assert.equal(ensureLoopbackHost("http://127.0.0.1:11434/"), "http://127.0.0.1:11434");
  assert.equal(ensureLoopbackHost("http://[::1]:11434"), "http://[::1]:11434");
  assert.throws(() => ensureLoopbackHost("http://localhost:11434/api"), /without a path, query, or fragment/i);
  assert.throws(() => ensureLoopbackHost("http://user:pass@localhost:11434"), /without embedded credentials/i);
  assert.throws(() => ensureLoopbackHost("https://example.com"), /loopback Ollama endpoint/i);
});

test("fixture manifest stays in sync with copied OMD contract fixtures", () => {
  const fixtureDir = path.resolve(import.meta.dirname, "fixtures/enrich-note/v1");
  const manifest = JSON.parse(readFileSync(path.join(fixtureDir, "manifest.json"), "utf8")) as {
    source_version: string;
    source_commit: string;
    files: Record<string, string>;
  };

  assert.equal(manifest.source_version, "0.3.0b2");
  assert.equal(manifest.source_commit, "a4c7aa7209de66844bc5c23e5ad341ecc05f2a9a");

  for (const [name, expectedHash] of Object.entries(manifest.files)) {
    const bytes = readFileSync(path.join(fixtureDir, name));
    const actual = createHash("sha256").update(bytes).digest("hex");
    assert.equal(actual, expectedHash, `${name} hash drifted`);
  }
});

test("validateEnrichResponse accepts the copied canonical OMD fixture", () => {
  const request = localizedFixtureRequest();
  const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "fixtures/enrich-note/v1/valid-response.json"), "utf8"));
  const response = validateEnrichResponse(fixture, request, candidateMap(request));
  assert.equal(response.generation.endpoint_class, "local_loopback");
  assert.equal(response.proposal.existing_links[0]?.display, "Local AI");
});

test("validateEnrichResponse rejects unknown candidate IDs from fixture payloads", () => {
  const request = sampleRequest();
  const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "fixtures/enrich-note/v1/unknown-candidate-id.json"), "utf8"));
  assert.throws(() => validateEnrichResponse({
    schema_version: 1,
    request_id: request.request_id,
    action: request.action,
    note: {
      path: request.note.path,
      content_sha256: request.note.content_sha256,
    },
    proposal: fixture,
    warnings: [],
    generation: {
      provider: "ollama",
      model: request.model,
      endpoint_class: "local_loopback",
    },
  }, request, candidateMap(request)), /unknown candidate/i);
});

test("validateEnrichResponse rejects missing warnings and remote generation classes", () => {
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
      existing_links: [],
      new_concepts: [],
      existing_tags: [],
      new_tags: [],
    },
    generation: {
      provider: "ollama",
      model: request.model,
      endpoint_class: "remote_https",
    },
  }, request, candidateMap(request)), /response\.warnings|non-loopback/i);
});

test("validateEnrichResponse bounds warning count and length", () => {
  const request = sampleRequest();
  const response = {
    schema_version: 1,
    request_id: request.request_id,
    action: request.action,
    note: {
      path: request.note.path,
      content_sha256: request.note.content_sha256,
    },
    proposal: {
      summary: "Summary",
      existing_links: [],
      new_concepts: [],
      existing_tags: [],
      new_tags: [],
    },
    warnings: Array.from({ length: 17 }, () => "warning"),
    generation: {
      provider: "ollama",
      model: request.model,
      endpoint_class: "local_loopback",
    },
  };

  assert.throws(() => validateEnrichResponse(response, request, candidateMap(request)), /too many enrichment warnings/i);
  response.warnings = ["x".repeat(161)];
  assert.throws(() => validateEnrichResponse(response, request, candidateMap(request)), /at most 160 characters/i);
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

function localizedFixtureRequest(): OmdEnrichRequest {
  const content = "本地 AI 可以辅助个人知识工作流。";
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
      aliases: ["本地 AI"],
      tags: ["ai/local", "research"],
      evidence: "本地 AI 与个人知识工作流。",
    }],
    vault_tags: ["ai/local", "research", "workflow"],
    model: "qwen3:4b-instruct",
    host: "http://localhost:11434",
  };
}

function candidateMap(request: OmdEnrichRequest) {
  return new Map(request.candidates.map((candidate) => [candidate.id, candidate]));
}
