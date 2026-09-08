import assert from "node:assert/strict";
import test from "node:test";
import { sha256HexUtf8, type OmdEnrichRequest } from "../src/enrichment/contract.ts";
import {
  describeEnrichmentFailure,
  OmdEnrichmentError,
} from "../src/enrichment/errors.ts";
import { OmdEnrichmentRunner, parseEnrichEventLine, parseStrictStdout } from "../src/enrichment/runner.ts";

test("parseEnrichEventLine ignores invalid JSON lines", () => {
  assert.equal(parseEnrichEventLine("not json"), null);
  assert.deepEqual(parseEnrichEventLine("{\"v\":1,\"ts\":1,\"event\":\"done\",\"request_id\":\"r1\"}"), {
    v: 1,
    ts: 1,
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
    options?.onStderrLine?.("{\"v\":1,\"ts\":1,\"event\":\"error\",\"request_id\":\"request-1\",\"kind\":\"model_not_installed\",\"message\":\"untrusted details\"}");
    return { code: 1, stderr: "", stdout: "" };
  });
  await assert.rejects(runner.run({ executable: "omd", request }), /selected Ollama model is not installed/i);
});

test("runner explains a rejected local-model proposal without calling it a setup failure", async () => {
  const request = sampleRequest();
  const runner = new OmdEnrichmentRunner(async (_command, _args, options) => {
    options?.onStderrLine?.(JSON.stringify({
      v: 1,
      ts: 1,
      event: "error",
      request_id: request.request_id,
      kind: "invalid_model_json",
      message: "model selected an unknown vault tag",
    }));
    return { code: 1, stderr: "", stdout: "" };
  });

  await assert.rejects(
    runner.run({ executable: "omd", request }),
    (error: unknown) => error instanceof OmdEnrichmentError
      && error.code === "invalid_response"
      && error.message === "The local model suggested a tag outside the current vault catalog. Generate again or choose another local writing model."
      && !/setup|endpoint/iu.test(error.message),
  );
});

test("runner keeps note availability failures distinct from invalid requests", async () => {
  const request = sampleRequest();
  const runner = new OmdEnrichmentRunner(async (_command, _args, options) => {
    options?.onStderrLine?.(JSON.stringify({
      v: 1,
      ts: 1,
      event: "error",
      request_id: request.request_id,
      kind: "note_not_found",
      message: "selected vault paths changed during generation",
    }));
    return { code: 1, stderr: "", stdout: "" };
  });

  await assert.rejects(
    runner.run({ executable: "omd", request }),
    (error: unknown) => error instanceof OmdEnrichmentError
      && error.code === "note_unavailable"
      && /note or a suggested note is no longer available/iu.test(error.message),
  );
});

test("generation failure presents an unavailable note without offering a stale retry", () => {
  const unavailableInput = describeEnrichmentFailure(new OmdEnrichmentError(
    "note_unavailable",
    "The target note or a suggested note is no longer available.",
  ), "generation");
  assert.deepEqual(unavailableInput, {
    phase: "unavailable",
    statusText: "The target note or a suggested note is no longer available.",
    detailText: "No proposal changes were written. Close this view, then start again from an available Markdown note.",
  });
});

test("enrichment failure presentation gives recovery advice for the actual failure class", () => {
  const rejectedProposal = describeEnrichmentFailure(new OmdEnrichmentError(
    "invalid_response",
    "The local model returned an invalid proposal.",
  ), "generation");
  assert.deepEqual(rejectedProposal, {
    phase: "error",
    statusText: "The local model returned an invalid proposal.",
    detailText: "No proposal changes were written. Generate again. If this repeats, choose another local writing model.",
  });

  const changedNote = describeEnrichmentFailure(new OmdEnrichmentError(
    "note_conflict",
    "The note is no longer available.",
  ), "generation");
  assert.deepEqual(changedNote, {
    phase: "conflict",
    statusText: "The note is no longer available.",
    detailText: "No proposal changes were written. Refresh the note, then generate a new proposal.",
  });

  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(describeEnrichmentFailure(abort, "generation").phase, "cancelled");
});

test("apply failure presentation never claims writes did not occur when an exception escapes", () => {
  const conflict = describeEnrichmentFailure(new OmdEnrichmentError(
    "note_conflict",
    "The note changed while Apply was running.",
  ), "apply");
  assert.deepEqual(conflict, {
    phase: "conflict",
    statusText: "The note changed while Apply was running.",
    detailText: "Review the note, then generate a fresh proposal before applying again.",
  });

  const unexpected = describeEnrichmentFailure(new Error("disk write interrupted"), "apply");
  assert.equal(unexpected.phase, "error");
  assert.match(unexpected.detailText, /review the target note/iu);
  assert.doesNotMatch(unexpected.detailText, /no vault changes were written/iu);
});

test("runner gives a safe, copyable Ollama pull command for a missing configured model", async () => {
  const request = sampleRequest();
  request.model = "qwen3:4b-instruct";
  const runner = new OmdEnrichmentRunner(async (_command, _args, options) => {
    options?.onStderrLine?.(JSON.stringify({
      v: 1,
      event: "error",
      kind: "model_not_installed",
      request_id: request.request_id,
      ts: 1,
    }));
    return { code: 1, stdout: "", stderr: "" };
  });

  await assert.rejects(
    runner.run({ executable: "/usr/local/bin/omd", request }),
    (error: unknown) => error instanceof Error
      && error.message === "The selected Ollama model is not installed. Run: ollama pull qwen3:4b-instruct",
  );
});

test("runner does not surface an unclassified terminal error message", async () => {
  const request = sampleRequest();
  const runner = new OmdEnrichmentRunner(async (_command, _args, options) => {
    options?.onStderrLine?.("{\"v\":1,\"ts\":1,\"event\":\"error\",\"request_id\":\"request-1\",\"message\":\"private note text\"}");
    return { code: 1, stderr: "", stdout: "" };
  });
  await assert.rejects(
    runner.run({ executable: "omd", request }),
    (error: unknown) => error instanceof Error
      && /OMD enrichment failed/u.test(error.message)
      && !error.message.includes("private note text"),
  );
});

test("runner rejects malformed enrichment progress events", async () => {
  const request = sampleRequest();
  const runner = new OmdEnrichmentRunner(async (_command, _args, options) => {
    options?.onStderrLine?.("{\"event\":\"progress\"}");
    return { code: 0, stderr: "", stdout: "{}\n" };
  });
  await assert.rejects(runner.run({ executable: "omd", request }), /event\.v|invalid|unsupported/i);
});

test("runner rejects duplicate terminal events", async () => {
  const request = sampleRequest();
  const runner = new OmdEnrichmentRunner(async (_command, _args, options) => {
    options?.onStderrLine?.("{\"v\":1,\"ts\":1,\"event\":\"done\",\"request_id\":\"request-1\"}");
    options?.onStderrLine?.("{\"v\":1,\"ts\":2,\"event\":\"error\",\"request_id\":\"request-1\",\"message\":\"late failure\"}");
    return { code: 0, stderr: "", stdout: "{}\n" };
  });
  await assert.rejects(runner.run({ executable: "omd", request }), /more than one terminal enrichment event/i);
});

test("runner maps cancellation and overflow errors", async () => {
  const request = sampleRequest();
  const cancelled = new OmdEnrichmentRunner(async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  });
  await assert.rejects(cancelled.run({ executable: "omd", request }), /cancelled/i);

  const overflow = new OmdEnrichmentRunner(async () => {
    throw new Error("stderr exceeded 262144 bytes");
  });
  await assert.rejects(overflow.run({ executable: "omd", request }), /exceeded its safety limit/i);
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
