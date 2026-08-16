import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  omdCaptureArgs,
  parsePythonShebang,
  prependExecutableDirectoryToPath,
} from "../src/omd-events.ts";
import { bridgeErrorMessage, captureErrorMessage, parseBridgeResponse, spawnProcess } from "../src/omd-bridge.ts";

const bridgeScript = new URL("../bridge/omd_home_bridge.py", import.meta.url);
const nodeRequire = createRequire(import.meta.url);

test("uses OMD's vault-capture subcommand instead of standalone conversion", () => {
  assert.deepEqual(omdCaptureArgs("https://example.com", "/tmp/vault"), [
    "capture", "https://example.com", "--vault", "/tmp/vault", "--json-events",
  ]);
});

test("discovers OMD's isolated Python from its launcher", () => {
  assert.equal(parsePythonShebang("#!/opt/homebrew/Cellar/omd/libexec/bin/python\nimport sys\n"), "/opt/homebrew/Cellar/omd/libexec/bin/python");
  assert.equal(parsePythonShebang("#!/bin/sh\n"), null);
});

test("makes tools bundled beside OMD visible to GUI-launched child processes", () => {
  assert.equal(
    prependExecutableDirectoryToPath(
      "/Volumes/Apps/omd/.venv/bin/omd",
      "/usr/bin:/bin",
      ":",
    ),
    "/Volumes/Apps/omd/.venv/bin:/usr/bin:/bin",
  );
});

test("does not duplicate OMD's executable directory in PATH", () => {
  assert.equal(
    prependExecutableDirectoryToPath(
      "/Volumes/Apps/omd/.venv/bin/omd",
      "/Volumes/Apps/omd/.venv/bin:/usr/bin:/bin",
      ":",
    ),
    "/Volumes/Apps/omd/.venv/bin:/usr/bin:/bin",
  );
});

test("preserves structured bridge error messages", () => {
  assert.equal(
    bridgeErrorMessage({ message: "vault path does not exist", type: "ValueError" }, "fallback"),
    "vault path does not exist",
  );
  assert.equal(
    bridgeErrorMessage('{"message":"loopback only","type":"ValueError"}', "fallback"),
    "loopback only",
  );
});

test("preserves structured OMD capture error events", () => {
  assert.equal(captureErrorMessage('{"v":1,"event":"fatal","ts":1,"message":"Playwright could not load the page"}'), "Playwright could not load the page");
});

test("parses JSON bridge responses from stdout", () => {
  assert.deepEqual(parseBridgeResponse('log line\n{"ok":false,"error":{"message":"boom"}}\n'), {
    ok: false,
    error: { message: "boom" },
  });
});

test("fallback bridge search keeps common short acronyms", async () => {
  const vault = await mkdtemp(join(tmpdir(), "omd-home-bridge-"));
  try {
    await mkdir(join(vault, "Notes"), { recursive: true });
    await writeFile(join(vault, "Notes", "AI Notes.md"), "AI planning\nMachine learning and AI systems\n", "utf8");
    const response = runBridge({ action: "search", vault, query: "AI", limit: 10 });
    assert.equal(response.ok, true);
    assert.equal(Array.isArray(response.hits), true);
    assert.equal(response.hits[0]?.path, "Notes/AI Notes.md");
    assert.match(String(response.hits[0]?.evidence ?? ""), /\bAI\b/);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("bridge emits structured JSON errors for invalid requests", () => {
  const response = runBridge({ action: "search", vault: "/definitely/missing", query: "AI", limit: 10 });
  assert.equal(response.ok, false);
  assert.deepEqual(response.error, {
    message: "vault path does not exist",
    type: "ValueError",
  });
});

test("spawnProcess times out runaway children", async () => {
  await withNodeRequire(async () => {
    await assert.rejects(
      spawnProcess(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], { timeoutMs: 25 }),
      /timed out/,
    );
  });
});

test("spawnProcess aborts when the signal is cancelled", async () => {
  await withNodeRequire(async () => {
    const controller = new AbortController();
    const pending = spawnProcess(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending, /aborted/);
  });
});

test("spawnProcess enforces stdout bounds", async () => {
  await withNodeRequire(async () => {
    await assert.rejects(
      spawnProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(128))"], { maxStdoutChars: 32 }),
      /stdout exceeded 32 characters/,
    );
  });
});

function runBridge(request: Record<string, unknown>): Record<string, any> {
  const result = spawnSync("python3", [bridgeScript.pathname], {
    encoding: "utf8",
    input: JSON.stringify(request),
  });
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  assert.ok(output, `bridge produced no stdout: ${result.stderr}`);
  return JSON.parse(output) as Record<string, any>;
}

async function withNodeRequire<T>(run: () => Promise<T>): Promise<T> {
  const runtime = globalThis as typeof globalThis & { window?: unknown };
  const previous = runtime.window;
  Object.defineProperty(runtime, "window", {
    value: { ...(typeof previous === "object" && previous ? previous : {}), require: nodeRequire },
    configurable: true,
    writable: true,
  });
  try {
    return await run();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(runtime, "window");
    else Object.defineProperty(runtime, "window", { value: previous, configurable: true, writable: true });
  }
}
