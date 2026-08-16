import assert from "node:assert/strict";
import test from "node:test";
import { sha256HexUtf8, type OmdEnrichRequest } from "../src/enrichment/contract.ts";
import { OmdEnrichmentRunner, parseEnrichEventLine, parseStrictStdout } from "../src/enrichment/runner.ts";

test("parseEnrichEventLine ignores invalid JSON lines", () => {
  assert.equal(parseEnrichEventLine("not json"), null);
  assert.deepEqual(parseEnrichEventLine("{\"event\":\"done\",\"request_id\":\"r1\"}"), {
    event: "done",
    request_id: "r1",
  });
});

test("parseStrictStdout requires one trailing newline and one JSON object", () => {
  assert.throws(() => parseStrictStdout("{\"ok\":true}"), /end with a newline/i);
  assert.throws(() => parseStrictStdout("{\"ok\":true}\n{\"ok\":false}\n"), /more than one line of json/i);
});

test("runner validates stdout and ignores stale stderr events", async () => {
  const request = sampleRequest();
  const runner = new OmdEnrichmentRunner(async (_command, args, options) => {
    assert.deepEqual(args, ["enrich-note", "--request-json", "-", "--json-events"]);
    options?.onStderrLine?.("{\"v\":1,\"ts\":1,\"event\":\"progress\",\"request_id\":\"other\"}");
    options?.onStderrLine?.("{\"v\":1,\"ts\":2,\"event\":\"done\",\"request_id\":\"request-1\"}");
    return {
      code: 0,
      stderr: "",
      stdout: `${JSON.stringify({
        schema_version: 1,
        request_id: request.request_id,
        action: request.action,
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
      })}\n`,
    };
  });

  const result = await runner.run({ executable: "omd", request });
  assert.equal(result.response.proposal.summary, "Summary");
  assert.equal(result.terminalEvent?.event, "done");
});

test("runner maps non-zero exits into process errors", async () => {
  const request = sampleRequest();
  const runner = new OmdEnrichmentRunner(async (_command, _args, options) => {
    options?.onStderrLine?.("{\"v\":1,\"ts\":1,\"event\":\"error\",\"request_id\":\"request-1\",\"message\":\"Model missing\"}");
    return { code: 1, stderr: "", stdout: "" };
  });
  await assert.rejects(runner.run({ executable: "omd", request }), /Model missing/);
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
      tags: [],
      evidence: "Local AI workflows",
    }],
    vault_tags: [],
    model: "qwen3:4b-instruct",
    host: "http://localhost:11434",
  };
}
