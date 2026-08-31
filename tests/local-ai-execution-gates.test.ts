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
  assert.match(mainSource, /await this\.requireReadyOmdExecutable\(\)/u);
  assert.match(enrichmentControllerSource, /const executable = await this\.plugin\.requireReadyOmdExecutable\(\)/u);
  assert.doesNotMatch(enrichmentControllerSource, /executable: this\.plugin\.settings\.omdExecutable/u);
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

test("Vault Q&A stays fail-closed for cloud providers in this build", () => {
  assert.match(mainSource, /if \(this\.settings\.aiProvider !== "ollama"\) \{/u);
  assert.match(mainSource, /const provider = aiProviderLabel\(this\.settings\.aiProvider\);/u);
  assert.match(mainSource, /sending vault evidence to a cloud answer provider is not enabled in this build/u);
  assert.match(mainSource, /Select Ollama on this computer to answer locally\./u);
  assert.match(mainSource, /const preview = await this\.previewLocalAnswer\(query\);/u);
  assert.doesNotMatch(mainSource, /previewCloudAnswer\(query/u);
  assert.doesNotMatch(mainSource, /executeCloudAnswer\(query/u);
});

test("cloud answers stay pinned to the selected provider and never fall back across providers", () => {
  assert.match(mainSource, /async checkHostedAiConnection\(\): Promise<boolean>/u);
  assert.match(mainSource, /async checkOllamaCloudConnection\(\): Promise<boolean>/u);
  assert.doesNotMatch(mainSource, /provider === "openai"[\s\S]{0,160}anthropic|provider === "anthropic"[\s\S]{0,160}openai|provider === "deepseek"[\s\S]{0,160}openai/su);
});

test("hybrid retrieval falls back to sparse search when local embedding safety cannot be verified", () => {
  assert.match(mainSource, /const status = await this\.ollamaLocalClient\.status\(host, signal\)/u);
  assert.match(mainSource, /const models = await this\.ollamaLocalClient\.tags\(host, signal\)/u);
  assert.match(mainSource, /const inspected = buildModelEntry\(await this\.safeShowModel\(host, embeddingModel, signal\)\)/u);
  assert.match(mainSource, /if \(modelHasRemoteMetadata\(inspected\)\)/u);
  assert.match(mainSource, /if \(!modelSupportsEmbedding\(inspected\)\)/u);
  assert.match(mainSource, /hybridRetrievalEnabled:\s*false/u);
  assert.match(mainSource, /semanticRerankEnabled:\s*false/u);
  assert.match(mainSource, /warning:\s*"hybrid_retrieval_local_safety_fallback"/u);
});
