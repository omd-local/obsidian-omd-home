import assert from "node:assert/strict";
import test from "node:test";
import {
  canOpenOllamaDesktopApp,
  openOllamaDesktopApp,
  type OllamaAppExecFile,
  type OllamaAppLaunchOptions,
} from "../src/ollama-app.ts";

test("canOpenOllamaDesktopApp limits the native opener to macOS", () => {
  assert.equal(canOpenOllamaDesktopApp("darwin"), true);
  assert.equal(canOpenOllamaDesktopApp("win32"), false);
  assert.equal(canOpenOllamaDesktopApp("linux"), false);
});

test("openOllamaDesktopApp launches the installed macOS app without a shell", async () => {
  const calls: Array<{ executable: string; args: string[]; options: OllamaAppLaunchOptions }> = [];
  const execFile: OllamaAppExecFile = (executable, args, options, callback) => {
    calls.push({ executable, args, options });
    callback(null);
  };

  await openOllamaDesktopApp(execFile, "darwin");

  assert.deepEqual(calls, [{
    executable: "/usr/bin/open",
    args: ["-a", "Ollama"],
    options: { timeout: 5_000, windowsHide: true },
  }]);
});

test("openOllamaDesktopApp rejects unavailable process APIs and launch failures", async () => {
  await assert.rejects(
    openOllamaDesktopApp(null, "darwin"),
    /process APIs are unavailable/u,
  );
  await assert.rejects(
    openOllamaDesktopApp(() => undefined, "linux"),
    /macOS only/u,
  );
  await assert.rejects(
    openOllamaDesktopApp((_executable, _args, _options, callback) => {
      callback(new Error("missing app"));
    }, "darwin"),
    /could not be opened/u,
  );
});
