import type { IncomingMessage } from "node:http";
import {
  LocalAiError,
  type LocalAiEmbedResult,
  type LocalAiModelEntry,
  type LocalAiModelInfo,
  type LocalAiSmokeResult,
  type LocalAiStatusInfo,
  type LocalAiVersionInfo,
} from "./ollama-local-types.ts";
import { buildModelEntry, normalizeLocalOllamaHost } from "./local-ai-readiness.ts";

export const OLLAMA_RESPONSE_LIMIT_BYTES = 1_000_000;

interface JsonRequestOptions {
  host: string;
  path: string;
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}

interface HttpResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

type HttpJsonRequest = (options: JsonRequestOptions) => Promise<HttpResponse>;

export interface OllamaLocalClientOptions {
  requestJson?: HttpJsonRequest;
}

export class OllamaLocalClient {
  private readonly requestJson: HttpJsonRequest;

  constructor(options: OllamaLocalClientOptions = {}) {
    this.requestJson = options.requestJson ?? requestJson;
  }

  async version(host: string, signal?: AbortSignal): Promise<LocalAiVersionInfo> {
    const body = await this.getJson(host, "/api/version", 5_000, signal);
    const version = cleanString(body.version);
    if (!version) throw new LocalAiError("version_unavailable", "Ollama is reachable, but `/api/version` returned no version.");
    return { version };
  }

  async status(host: string, signal?: AbortSignal): Promise<LocalAiStatusInfo> {
    const body = await this.getJson(host, "/api/status", 5_000, signal);
    const cloud = body.cloud;
    if (cloud && typeof cloud === "object") {
      const value = cloud as Record<string, unknown>;
      return { cloud: { disabled: typeof value.disabled === "boolean" ? value.disabled : undefined } };
    }
    return { cloud: null };
  }

  async tags(host: string, signal?: AbortSignal): Promise<LocalAiModelEntry[]> {
    const body = await this.getJson(host, "/api/tags", 5_000, signal);
    const models = Array.isArray(body.models) ? body.models : [];
    return models
      .map((entry) => toModelEntry(entry))
      .filter((entry): entry is LocalAiModelEntry => Boolean(entry))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async show(host: string, model: string, signal?: AbortSignal): Promise<LocalAiModelInfo> {
    let body: Record<string, unknown>;
    try {
      body = await this.postJson(host, "/api/show", { model }, 5_000, signal);
    } catch (error) {
      if (error instanceof LocalAiError && /HTTP 404/u.test(error.message)) {
        throw new LocalAiError(
          "selected_model_missing",
          `The selected model ${model} is not installed on this Ollama daemon.`,
        );
      }
      throw error;
    }
    const name = cleanString(body.model) || model;
    return {
      name,
      capabilities: extractCapabilities(body),
      remoteModel: optionalString(body.remote_model),
      remoteHost: optionalString(body.remote_host),
    };
  }

  async smoke(host: string, model: string, signal?: AbortSignal): Promise<LocalAiSmokeResult> {
    const startedAt = Date.now();
    const body = await this.postJson(host, "/api/chat", {
      model,
      stream: false,
      think: false,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
    }, 60_000, signal);
    const message = body.message;
    const responseText = message && typeof message === "object"
      ? cleanString((message as Record<string, unknown>).content)
      : "";
    if (!responseText) throw new LocalAiError("smoke_failed", "Ollama replied, but the smoke test returned no text.");
    return {
      model: cleanString(body.model) || model,
      latencyMs: Date.now() - startedAt,
      responseText,
      remoteModel: optionalString(body.remote_model),
      remoteHost: optionalString(body.remote_host),
    };
  }

  async embed(
    host: string,
    model: string,
    input: string | string[],
    signal?: AbortSignal,
  ): Promise<LocalAiEmbedResult> {
    const startedAt = Date.now();
    const body = await this.postJson(host, "/api/embed", { model, input }, 30_000, signal);
    const embeddings = Array.isArray(body.embeddings) ? body.embeddings : [];
    const expectedCount = Array.isArray(input) ? input.length : 1;
    if (embeddings.length !== expectedCount) {
      throw new LocalAiError("smoke_failed", "Ollama replied, but `/api/embed` returned an unexpected number of vectors.");
    }
    const dimensions = validateEmbeddingVectors(embeddings);
    if (dimensions === 0) {
      throw new LocalAiError("smoke_failed", "Ollama replied, but `/api/embed` returned no usable vectors.");
    }
    return {
      model: cleanString(body.model) || model,
      latencyMs: Date.now() - startedAt,
      vectorCount: embeddings.length,
      dimensions,
    };
  }

  private async getJson(
    host: string,
    path: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = await this.requestJson({ host: normalizeLocalOllamaHost(host), path, timeoutMs, signal });
    return parseJsonResponse(response);
  }

  private async postJson(
    host: string,
    path: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const response = await this.requestJson({
      host: normalizeLocalOllamaHost(host),
      path,
      method: "POST",
      body,
      timeoutMs,
      signal,
    });
    return parseJsonResponse(response);
  }
}

function toModelEntry(input: unknown): LocalAiModelEntry | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const name = cleanString(value.name);
  if (!name) return null;
  const details = value.details && typeof value.details === "object"
    ? value.details as Record<string, unknown>
    : {};
  const capabilities = extractCapabilities({ ...value, ...details });
  return buildModelEntry({
    name,
    digest: optionalString(value.digest),
    capabilities,
    remoteModel: optionalString(value.remote_model),
    remoteHost: optionalString(value.remote_host),
  });
}

function extractCapabilities(input: Record<string, unknown>): string[] {
  const values = input.capabilities;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()))];
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  return cleanString(value) || undefined;
}

function validateEmbeddingVectors(vectors: unknown[]): number {
  let dimensions = 0;
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length === 0) return 0;
    if (!vector.every((value) => typeof value === "number" && Number.isFinite(value))) return 0;
    if (dimensions === 0) dimensions = vector.length;
    if (vector.length !== dimensions) {
      throw new LocalAiError("smoke_failed", "Ollama replied, but `/api/embed` returned mismatched vector dimensions.");
    }
  }
  return dimensions;
}

function parseJsonResponse(response: HttpResponse): Record<string, unknown> {
  if (response.statusCode >= 300 && response.statusCode < 400) {
    throw new LocalAiError("daemon_unreachable", "Ollama returned a redirect. OMD Home requires a direct local daemon response.");
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new LocalAiError("daemon_unreachable", `Ollama responded with HTTP ${response.statusCode}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch (error) {
    throw new LocalAiError("daemon_unreachable", "Ollama returned invalid JSON.", String(error));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalAiError("daemon_unreachable", "Ollama returned an unexpected response body.");
  }
  return parsed as Record<string, unknown>;
}

async function requestJson(options: JsonRequestOptions): Promise<HttpResponse> {
  const { host, path, method = "GET", body, timeoutMs, signal } = options;
  const runtimeWindow = window as Window & { require?: (id: string) => unknown };
  if (!runtimeWindow.require) throw new Error("Desktop HTTP APIs are unavailable");
  const http = runtimeWindow.require("node:http") as typeof import("node:http");
  const { URL } = runtimeWindow.require("node:url") as typeof import("node:url");
  return await new Promise<HttpResponse>((resolve, reject) => {
    const url = new URL(path, host);
    const payload = body ? JSON.stringify(body) : null;
    const request = http.request(url, {
      method,
      headers: payload ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(payload)) } : {},
    }, (response: IncomingMessage) => {
      consumeLocalOllamaResponse(response, resolve, reject);
    });
    const onAbort = () => {
      request.destroy(abortError());
    };
    request.setTimeout(timeoutMs, () => {
      request.destroy(new LocalAiError("daemon_unreachable", `Ollama timed out after ${timeoutMs}ms.`));
    });
    request.on("error", (error: Error) => {
      reject(mapTransportError(error));
    });
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
        request.once("close", () => signal.removeEventListener("abort", onAbort));
      }
    }
    if (payload) request.write(payload);
    request.end();
  });
}

export function consumeLocalOllamaResponse(
  response: IncomingMessage,
  resolve: (value: HttpResponse) => void,
  reject: (reason?: unknown) => void,
): void {
  const statusCode = response.statusCode ?? 0;
  const location = response.headers.location;
  if (statusCode >= 300 && statusCode < 400 && location) {
    response.resume();
    reject(new LocalAiError("daemon_unreachable", "Ollama returned a redirect. OMD Home rejects redirected local AI responses."));
    return;
  }
  let totalBytes = 0;
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer | string) => {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buffer.byteLength;
    if (totalBytes > OLLAMA_RESPONSE_LIMIT_BYTES) {
      response.destroy(new LocalAiError(
        "daemon_unreachable",
        `Ollama returned more than ${OLLAMA_RESPONSE_LIMIT_BYTES} bytes.`,
      ));
      return;
    }
    chunks.push(buffer);
  });
  response.on("error", (error) => reject(mapTransportError(error)));
  response.on("end", () => {
    resolve({
      statusCode,
      headers: response.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    });
  });
}

function mapTransportError(error: unknown): Error {
  if (error instanceof LocalAiError) return error;
  if (error instanceof Error && error.name === "AbortError") return abortError();
  const detail = error instanceof Error ? error.message : String(error);
  return new LocalAiError(
    "daemon_unreachable",
    "Ollama is not reachable at the configured local endpoint. Start the Ollama app or run `ollama serve`.",
    detail,
  );
}

function abortError(): Error {
  const error = new Error("The Local AI request was cancelled.");
  error.name = "AbortError";
  return error;
}
