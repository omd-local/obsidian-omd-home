import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_PROVIDER_VALUES,
  aiProviderDestination,
  aiProviderEnvVar,
  aiProviderLabel,
  isHostedApiProvider,
  isOllamaCloudModel,
  normalizeAiModelMemory,
  selectedAiModel,
} from "../src/ai-provider.ts";

test("provider catalog includes explicit local and cloud destinations", () => {
  assert.deepEqual(AI_PROVIDER_VALUES, [
    "ollama",
    "ollama-cloud",
    "openai",
    "anthropic",
    "deepseek",
  ]);
  assert.equal(isHostedApiProvider("ollama"), false);
  assert.equal(isHostedApiProvider("ollama-cloud"), false);
  assert.equal(isHostedApiProvider("openai"), true);
  assert.equal(isHostedApiProvider("anthropic"), true);
  assert.equal(aiProviderLabel("ollama"), "Ollama on this computer");
  assert.equal(aiProviderDestination("ollama"), "This computer");
  assert.equal(aiProviderDestination("ollama-cloud"), "ollama.com");
  assert.equal(aiProviderDestination("openai"), "api.openai.com");
  assert.equal(aiProviderEnvVar("openai"), "OPENAI_API_KEY");
  assert.equal(aiProviderEnvVar("anthropic"), "ANTHROPIC_API_KEY");
  assert.equal(aiProviderEnvVar("deepseek"), "DEEPSEEK_API_KEY");
});

test("model memory migrates the legacy selected model without inventing cloud choices", () => {
  const memory = normalizeAiModelMemory(undefined, "openai", "gpt-test-user-choice");
  assert.equal(memory.openai, "gpt-test-user-choice");
  assert.equal(memory.ollama, "qwen3:4b-instruct");
  assert.equal(memory["ollama-cloud"], "");
  assert.equal(memory.anthropic, "");
  assert.equal(selectedAiModel({ aiProvider: "openai", aiModel: "", aiModels: memory }), "gpt-test-user-choice");

  const local = normalizeAiModelMemory(undefined, "ollama", "llama3:latest");
  assert.equal(local.ollama, "llama3:latest");
  const explicit = normalizeAiModelMemory({ ollama: "qwen3:8b" }, "ollama", "llama3:latest");
  assert.equal(explicit.ollama, "qwen3:8b");
});

test("selectedAiModel always follows the active provider memory before the legacy field", () => {
  const memory = normalizeAiModelMemory({
    ollama: "qwen3:4b-instruct",
    openai: "gpt-5-mini",
    anthropic: "claude-sonnet-4-5",
  }, "ollama", "legacy-local");

  assert.equal(selectedAiModel({ aiProvider: "openai", aiModel: "legacy-value", aiModels: memory }), "gpt-5-mini");
  assert.equal(selectedAiModel({ aiProvider: "anthropic", aiModel: "legacy-value", aiModels: memory }), "claude-sonnet-4-5");
  assert.equal(selectedAiModel({ aiProvider: "ollama", aiModel: "legacy-value", aiModels: memory }), "qwen3:4b-instruct");
});

test("Ollama Cloud model detection accepts daemon metadata and explicit cloud ids", () => {
  assert.equal(isOllamaCloudModel({ name: "gpt-oss:120b-cloud" }), true);
  assert.equal(isOllamaCloudModel({ name: "custom", remoteHost: "https://ollama.com" }), true);
  assert.equal(isOllamaCloudModel({ name: "qwen3:4b-instruct" }), false);
});
