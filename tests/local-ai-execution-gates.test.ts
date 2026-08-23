import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { executeWithLocalAiGate } from "../src/local-ai-execution.ts";
import { LocalAiError, type LocalAiSnapshot } from "../src/ollama-local-types.ts";

const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
const enrichmentControllerSource = readFileSync(resolve("src/enrichment/controller.ts"), "utf8");

function snapshot(workflow: LocalAiSnapshot["workflow"] = "qa"): LocalAiSnapshot {
  return {
    workflow,
    provider: "ollama",
    host: "http://localhost:11434",
    model: "qwen3:4b-instruct",
    enabled: true,
  };
}

test("executeWithLocalAiGate runs gate before downstream and forwards the exact snapshot", async () => {
  const events: string[] = [];
  const gated = snapshot();
  const value = await executeWithLocalAiGate(
    gated,
    () => gated,
    async () => {
      events.push("gate");
    },
    async (received) => {
      events.push("downstream");
      assert.deepEqual(received, gated);
      return "ok";
    },
  );
  assert.equal(value, "ok");
  assert.deepEqual(events, ["gate", "downstream"]);
});

test("executeWithLocalAiGate blocks downstream when the gate fails", async () => {
  let downstreamCalled = false;
  await assert.rejects(
    executeWithLocalAiGate(
      snapshot(),
      () => snapshot(),
      async () => {
        throw new LocalAiError("cloud_features_enabled", "blocked");
      },
      async () => {
        downstreamCalled = true;
        return "ok";
      },
    ),
    (error: unknown) => error instanceof LocalAiError && error.code === "cloud_features_enabled",
  );
  assert.equal(downstreamCalled, false);
});

test("executeWithLocalAiGate rechecks the snapshot after the awaited gate", async () => {
  const initial = snapshot();
  let current = initial;
  await assert.rejects(
    executeWithLocalAiGate(
      initial,
      () => current,
      async () => {
        current = { ...initial, model: "qwen3:4b" };
      },
      async () => "ok",
    ),
    (error: unknown) => error instanceof LocalAiError && error.code === "snapshot_mismatch",
  );
});

test("askOmd and enrichment controller are wired to the gate seam", () => {
  assert.match(mainSource, /executeWithLocalAiGate\(/u);
  assert.match(enrichmentControllerSource, /this\.plugin\.runLocalAiGated\(/u);
  assert.match(mainSource, /createWorkflowSnapshot\("qa"/u);
  assert.match(enrichmentControllerSource, /createWorkflowSnapshot\("enrichment"/u);
});

test("capture always uses the shared gate seam and binds the invocation polish flag", () => {
  assert.match(mainSource, /createWorkflowSnapshot\("capture", this\.settings, polish\)/u);
  assert.match(mainSource, /const outputPath = await this\.runLocalAiGated\(/u);
  assert.match(mainSource, /enabled: gatedSnapshot\.enabled/u);
  assert.match(mainSource, /model: gatedSnapshot\.model/u);
  assert.match(mainSource, /host: gatedSnapshot\.host/u);
});
