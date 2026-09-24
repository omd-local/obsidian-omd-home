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

test("Vault Q&A requires provider-scoped cloud opt-in and a per-request consent preview", () => {
  assert.match(mainSource, /cloudAnswerPermissionEnabled\(this\.settings\)/u);
  assert.match(mainSource, /Enable Allow \$\{aiProviderLabel\(provider\)\} answers in Settings [→-] OMD Home [→-] AI answers/u);
  assert.match(mainSource, /const preview = await this\.previewCloudAnswer\(query, provider, model, requestSignal\);/u);
  assert.match(mainSource, /new CloudAnswerConsentModal\(this\.app/u);
  assert.match(mainSource, /question:\s*query/u);
  assert.match(mainSource, /evidence:\s*preview\.preview\.evidence/u);
  assert.match(mainSource, /Cloud answer cancelled\. No vault evidence was sent\./u);
  assert.match(mainSource, /this\.assertCloudPreviewStillCurrent\(preview\);/u);
  assert.match(mainSource, /answer = await this\.executeCloudAnswer\(query, preview, requestSignal\);/u);
});

test("cloud answers stay pinned to the selected provider and never fall back across providers", () => {
  assert.match(mainSource, /async checkHostedAiConnection\(\): Promise<boolean>/u);
  assert.match(mainSource, /async checkOllamaCloudConnection\(\): Promise<boolean>/u);
  assert.match(mainSource, /const cloudModels = catalog\.filter\(modelIsVerifiedOllamaCloud\)/u);
  assert.match(mainSource, /if \(!modelIsVerifiedOllamaCloud\(inspected\)\)/u);
  assert.match(mainSource, /provider !== preview\.provider[\s\S]+model !== preview\.model[\s\S]+endpoint !== preview\.endpoint/u);
  assert.doesNotMatch(mainSource, /provider === "openai"[\s\S]{0,160}anthropic|provider === "anthropic"[\s\S]{0,160}openai|provider === "deepseek"[\s\S]{0,160}openai/su);
});

test("hybrid retrieval falls back to sparse search when local embedding safety cannot be verified", () => {
  assert.match(mainSource, /const status = await this\.ollamaLocalClient\.status\(host, signal\)/u);
  assert.match(mainSource, /const models = await this\.ollamaLocalClient\.tags\(host, signal\)/u);
  assert.match(mainSource, /const inspected = mergeInspectedModelEntry\([\s\S]+buildModelEntry\(await this\.safeShowModel\(host, embeddingModel, signal\)\)[\s\S]+embeddingModel/u);
  assert.match(mainSource, /if \(modelIsCloudBacked\(inspected\)\)/u);
  assert.match(mainSource, /if \(!modelSupportsEmbedding\(inspected\)\)/u);
  assert.match(mainSource, /hybridRetrievalEnabled:\s*false/u);
  assert.match(mainSource, /semanticRerankEnabled:\s*false/u);
  assert.match(mainSource, /const warning = retrievalWarningForError\(error, requested\.embeddingModel\)/u);
  assert.match(mainSource, /warning,\s*warningModel:/u);
  for (const reason of [
    "hybrid_retrieval_model_not_installed",
    "hybrid_retrieval_daemon_unreachable",
    "hybrid_retrieval_model_unsupported",
  ]) {
    assert.match(mainSource, new RegExp(reason, "u"));
  }
  assert.match(mainSource, /text: "Install model"/u);
  assert.match(mainSource, /if \(this\.settings\.hybridRetrievalEnabled\)/u);
  assert.match(mainSource, /text: "Use keyword search by default"/u);
  assert.match(mainSource, /text: "Open retrieval settings"/u);
});

test("local smoke and embedding gates reject explicit cloud ids even without remote metadata", () => {
  assert.match(mainSource, /modelIsCloudBacked\(\{\s*name: gatedSnapshot\.model,\s*remoteModel: smoke\.remoteModel,\s*remoteHost: smoke\.remoteHost/u);
  assert.match(mainSource, /const catalogEntry = models\.find\(\(entry\) => localModelNamesMatch\(entry\.name, model\)\);/u);
  assert.match(mainSource, /const selectedEntry = mergeInspectedModelEntry\(catalogEntry, buildModelEntry\(selected\), entryName\);/u);
  assert.match(mainSource, /if \(modelIsCloudBacked\(selectedEntry\)\)/u);
  assert.match(mainSource, /const modelEntry = mergeInspectedModelEntry\([\s\S]+snapshot\.model,[\s\S]+const modelCode = deriveLocalAiModelCode\(modelEntry\)/u);
});
