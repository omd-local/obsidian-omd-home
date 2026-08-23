import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  consumeLocalOllamaResponse,
  OLLAMA_RESPONSE_LIMIT_BYTES,
  OllamaLocalClient,
} from "../src/ollama-local-client.ts";
import { LocalAiError } from "../src/ollama-local-types.ts";
import { normalizeLocalOllamaHost } from "../src/local-ai-readiness.ts";

test("normalizeLocalOllamaHost is shared with the client contract", () => {
  assert.equal(normalizeLocalOllamaHost("http://localhost:11434/"), "http://localhost:11434");
  assert.throws(
    () => normalizeLocalOllamaHost("http://localhost:1234"),
    (error: unknown) => error instanceof LocalAiError && error.code === "invalid_host",
  );
});

test("OllamaLocalClient parses version, status, tags, show, smoke, and embed responses", async () => {
  const client = new OllamaLocalClient({
    requestJson: async ({ path, body }) => {
      switch (path) {
        case "/api/version":
          return { statusCode: 200, headers: {}, body: JSON.stringify({ version: "0.32.5" }) };
        case "/api/status":
          return { statusCode: 200, headers: {}, body: JSON.stringify({ cloud: { disabled: true } }) };
        case "/api/tags":
          return {
            statusCode: 200,
            headers: {},
            body: JSON.stringify({
              models: [{ name: "qwen3:4b-instruct", capabilities: ["completion", "tools"] }],
            }),
          };
        case "/api/show":
          assert.deepEqual(body, { model: "qwen3:4b-instruct" });
          return {
            statusCode: 200,
            headers: {},
            body: JSON.stringify({ model: "qwen3:4b-instruct", capabilities: ["completion", "tools"] }),
          };
        case "/api/chat":
          assert.deepEqual(body, {
            model: "qwen3:4b-instruct",
            stream: false,
            think: false,
            messages: [{ role: "user", content: "Reply with the single word OK." }],
          });
          return {
            statusCode: 200,
            headers: {},
            body: JSON.stringify({ model: "qwen3:4b-instruct", message: { content: "OK" } }),
          };
        case "/api/embed":
          assert.deepEqual(body, { model: "bge-m3", input: ["vault retrieval probe", "多语言检索探针"] });
          return {
            statusCode: 200,
            headers: {},
            body: JSON.stringify({ model: "bge-m3", embeddings: [[0.1, 0.2], [0.3, 0.4]] }),
          };
        default:
          throw new Error(`Unexpected path ${path}`);
      }
    },
  });
  assert.deepEqual(await client.version("http://localhost:11434"), { version: "0.32.5" });
  assert.deepEqual(await client.status("http://localhost:11434"), { cloud: { disabled: true } });
  assert.deepEqual(await client.tags("http://localhost:11434"), [{
    name: "qwen3:4b-instruct",
    digest: undefined,
    capabilities: ["completion", "tools"],
    supportsCompletion: true,
    remoteModel: undefined,
    remoteHost: undefined,
  }]);
  assert.deepEqual(await client.show("http://localhost:11434", "qwen3:4b-instruct"), {
    name: "qwen3:4b-instruct",
    capabilities: ["completion", "tools"],
    remoteModel: undefined,
    remoteHost: undefined,
  });
  const smoke = await client.smoke("http://localhost:11434", "qwen3:4b-instruct");
  assert.equal(smoke.model, "qwen3:4b-instruct");
  assert.equal(smoke.responseText, "OK");
  const embed = await client.embed("http://localhost:11434", "bge-m3", ["vault retrieval probe", "多语言检索探针"]);
  assert.equal(embed.model, "bge-m3");
  assert.equal(embed.vectorCount, 2);
  assert.equal(embed.dimensions, 2);
  assert.ok(embed.latencyMs >= 0);
});

test("OllamaLocalClient rejects redirect, bad HTTP status, and empty smoke output", async () => {
  const redirecting = new OllamaLocalClient({
    requestJson: async () => ({ statusCode: 302, headers: { location: "/elsewhere" }, body: "" }),
  });
  await assert.rejects(
    redirecting.version("http://localhost:11434"),
    (error: unknown) => error instanceof LocalAiError && error.code === "daemon_unreachable",
  );

  const failing = new OllamaLocalClient({
    requestJson: async () => ({ statusCode: 500, headers: {}, body: JSON.stringify({ error: "boom" }) }),
  });
  await assert.rejects(
    failing.status("http://localhost:11434"),
    (error: unknown) => error instanceof LocalAiError && error.code === "daemon_unreachable",
  );

  const emptySmoke = new OllamaLocalClient({
    requestJson: async ({ path }) => ({
      statusCode: 200,
      headers: {},
      body: path === "/api/chat" ? JSON.stringify({ model: "qwen3:4b-instruct", message: { content: "" } }) : JSON.stringify({ version: "0.32.5" }),
    }),
  });
  await assert.rejects(
    emptySmoke.smoke("http://localhost:11434", "qwen3:4b-instruct"),
    (error: unknown) => error instanceof LocalAiError && error.code === "smoke_failed",
  );
});

test("OllamaLocalClient maps missing models and preserves unknown cloud status", async () => {
  const client = new OllamaLocalClient({
    requestJson: async ({ path }) => {
      if (path === "/api/status") {
        return { statusCode: 200, headers: {}, body: JSON.stringify({ cloud: { disabled: "yes" } }) };
      }
      return { statusCode: 404, headers: {}, body: JSON.stringify({ error: "model not found" }) };
    },
  });
  assert.deepEqual(await client.status("http://localhost:11434"), { cloud: { disabled: undefined } });
  await assert.rejects(
    client.show("http://localhost:11434", "missing:model"),
    (error: unknown) => error instanceof LocalAiError && error.code === "selected_model_missing",
  );
});

test("OllamaLocalClient rejects malformed embedding payloads", async () => {
  const client = new OllamaLocalClient({
    requestJson: async () => ({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({ model: "bge-m3", embeddings: [[0.1, 0.2], [0.3]] }),
    }),
  });
  await assert.rejects(
    client.embed("http://localhost:11434", "bge-m3", ["a", "b"]),
    (error: unknown) => error instanceof LocalAiError && error.code === "smoke_failed",
  );
});

test("the default response reader rejects redirects and oversized bodies", async () => {
  const redirect = fakeResponse(302, { location: "/elsewhere" });
  const redirected = consume(redirect);
  redirect.end();
  await assert.rejects(
    redirected,
    (error: unknown) => error instanceof LocalAiError && error.message.includes("redirect"),
  );

  const oversized = fakeResponse(200);
  const consumed = consume(oversized);
  oversized.end(Buffer.alloc(OLLAMA_RESPONSE_LIMIT_BYTES + 1));
  await assert.rejects(
    consumed,
    (error: unknown) => error instanceof LocalAiError && error.message.includes("more than"),
  );
});

test("OllamaLocalClient forwards AbortSignal cancellation to the transport layer", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const client = new OllamaLocalClient({
    requestJson: async ({ signal }) => await new Promise((_resolve, reject) => {
      receivedSignal = signal;
      signal?.addEventListener("abort", () => {
        const error = new LocalAiError("smoke_failed", "The Local AI request was cancelled.");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    }),
  });
  const pending = client.version("http://localhost:11434", controller.signal);
  controller.abort();
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof LocalAiError && error.message.includes("cancelled"),
  );
  assert.equal(receivedSignal, controller.signal);
});

function fakeResponse(
  statusCode: number,
  headers: Record<string, string> = {},
): IncomingMessage & PassThrough {
  const response = new PassThrough() as IncomingMessage & PassThrough;
  response.statusCode = statusCode;
  response.headers = headers;
  return response;
}

function consume(response: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    consumeLocalOllamaResponse(response, resolve, reject);
  });
}
