import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverOmdExecutable,
  isAutomaticOmdExecutable,
  omdExecutableCandidates,
  omdInstallInstructions,
  resolveOmdExecutablePath,
} from "../src/omd-discovery.ts";
import { OmdEnrichmentError } from "../src/enrichment/errors.ts";

const macEnvironment = {
  platform: "darwin" as const,
  homeDirectory: "/Users/example",
  condaPrefix: "/Users/example/active-conda",
};

test("automatic OMD discovery includes PATH, environment, package manager, and user locations", () => {
  const candidates = omdExecutableCandidates("omd", macEnvironment);
  assert.equal(candidates[0], "omd");
  assert.ok(candidates.includes("/Users/example/active-conda/bin/omd"));
  assert.ok(candidates.includes("/opt/homebrew/bin/omd"));
  assert.ok(candidates.includes("/opt/homebrew/Caskroom/miniconda/base/bin/omd"));
  assert.ok(candidates.includes("/Users/example/.local/bin/omd"));
  assert.equal(new Set(candidates).size, candidates.length);
});

test("automatic OMD discovery tries an already verified executable before PATH candidates", () => {
  const candidates = omdExecutableCandidates(
    "omd",
    macEnvironment,
    "/Applications/OMD/bin/omd",
  );
  assert.equal(candidates[0], "/Applications/OMD/bin/omd");
  assert.equal(candidates[1], "omd");
  assert.equal(new Set(candidates).size, candidates.length);
});

test("a custom OMD executable is the only discovery candidate", () => {
  assert.deepEqual(
    omdExecutableCandidates(" /custom/omd ", macEnvironment),
    ["/custom/omd"],
  );
});

test("Windows discovery uses Scripts executables for local Python environments", () => {
  const candidates = omdExecutableCandidates("", {
    platform: "win32",
    homeDirectory: "C:\\Users\\example",
    condaPrefix: "C:\\envs\\notes",
  });
  assert.ok(candidates.includes("C:\\envs\\notes\\Scripts\\omd.exe"));
  assert.ok(candidates.includes("C:\\Users\\example\\miniconda3\\Scripts\\omd.exe"));
  assert.doesNotMatch(candidates.join("\n"), /\/bin\/omd/u);
});

test("automatic discovery skips missing and legacy candidates to find a compatible OMD", async () => {
  const attempts: string[] = [];
  const result = await discoverOmdExecutable("omd", macEnvironment, async (executable) => {
    attempts.push(executable);
    if (executable === "omd") {
      throw new OmdEnrichmentError("unsupported_capability", "legacy");
    }
    if (executable === "/Users/example/active-conda/bin/omd") return {};
    throw new OmdEnrichmentError("missing_executable", "missing");
  });
  assert.equal(result.executable, "/Users/example/active-conda/bin/omd");
  assert.equal(result.mode, "automatic");
  assert.deepEqual(result.candidatesTried, attempts);
});

test("automatic discovery probes and returns the same resolved absolute PATH executable", async () => {
  const probed: string[] = [];
  const result = await discoverOmdExecutable(
    "omd",
    macEnvironment,
    async (executable) => { probed.push(executable); },
    async (candidate) => candidate === "omd" ? "/opt/homebrew/bin/omd" : candidate,
  );

  assert.equal(result.executable, "/opt/homebrew/bin/omd");
  assert.deepEqual(probed, ["/opt/homebrew/bin/omd"]);
  assert.deepEqual(result.candidatesTried, ["omd"]);
});

test("automatic discovery falls back to PATH when the verified absolute hint is no longer valid", async () => {
  const stale = "/Applications/OMD/bin/omd";
  const legacy = "/legacy/bin/omd";
  const probed: string[] = [];
  const result = await discoverOmdExecutable(
    "omd",
    macEnvironment,
    async (executable) => {
      probed.push(executable);
      if (executable === stale) throw new OmdEnrichmentError("missing_executable", "removed");
    },
    async (candidate) => candidate === "omd" ? legacy : candidate,
    stale,
  );

  assert.equal(result.executable, legacy);
  assert.deepEqual(result.candidatesTried, [stale, "omd"]);
  assert.deepEqual(probed, [stale, legacy]);
});

test("bare executable resolution uses a shell-free bounded locator on macOS and Windows", async () => {
  const calls: Array<{ command: string; args: string[]; shell?: boolean }> = [];
  const execute = async (command: string, args: string[], options?: { shell?: boolean }) => {
    calls.push({ command, args, shell: options?.shell });
    return {
      stdout: command === "where.exe" ? "C:\\Tools\\omd.exe\r\n" : "/opt/homebrew/bin/omd\n",
      stderr: "",
      code: 0,
    };
  };

  assert.equal(await resolveOmdExecutablePath("omd", "darwin", execute), "/opt/homebrew/bin/omd");
  assert.equal(await resolveOmdExecutablePath("omd.exe", "win32", execute), "C:\\Tools\\omd.exe");
  assert.deepEqual(calls, [
    { command: "which", args: ["omd"], shell: false },
    { command: "where.exe", args: ["omd.exe"], shell: false },
  ]);
});

test("executable resolution preserves an already absolute custom path without spawning", async () => {
  let calls = 0;
  const resolved = await resolveOmdExecutablePath(" /custom/bin/omd ", "linux", async () => {
    calls += 1;
    throw new Error("should not run");
  });
  assert.equal(resolved, "/custom/bin/omd");
  assert.equal(calls, 0);
});

test("cancelling automatic discovery during PATH resolution prevents the capability probe", async () => {
  const controller = new AbortController();
  let probes = 0;
  const discovery = discoverOmdExecutable(
    "omd",
    { platform: "linux", homeDirectory: "" },
    async () => { probes += 1; },
    async (candidate) => await resolveOmdExecutablePath(
      candidate,
      "linux",
      async (_command, _args, options) => await new Promise((resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
      controller.signal,
    ),
  );

  controller.abort();
  await assert.rejects(
    discovery,
    (error: unknown) => error instanceof OmdEnrichmentError && error.code === "cancelled",
  );
  assert.equal(probes, 0);
});

test("automatic discovery reports the most actionable failure after trying every candidate", async () => {
  await assert.rejects(
    discoverOmdExecutable("omd", { platform: "linux", homeDirectory: "" }, async (executable) => {
      if (executable === "/usr/local/bin/omd") {
        throw new OmdEnrichmentError("unsupported_schema", "Update this OMD build.");
      }
      throw new OmdEnrichmentError("missing_executable", "missing");
    }),
    (error: unknown) => error instanceof OmdEnrichmentError
      && error.code === "unsupported_schema"
      && error.message === "Update this OMD build.",
  );
});

test("blank and command-name settings use automatic discovery", () => {
  assert.equal(isAutomaticOmdExecutable(""), true);
  assert.equal(isAutomaticOmdExecutable("omd"), true);
  assert.equal(isAutomaticOmdExecutable("OMD.EXE"), true);
  assert.equal(isAutomaticOmdExecutable("/usr/local/bin/omd"), false);
});

test("install guidance is platform-specific and always ends with an OMD health check", () => {
  const mac = omdInstallInstructions("darwin");
  const linux = omdInstallInstructions("linux");
  const windows = omdInstallInstructions("win32");
  assert.match(mac.commands, /brew install omd-local\/omd\/omd/u);
  assert.match(linux.commands, /python3 -m pip install/u);
  assert.match(windows.commands, /py -m pip install/u);
  for (const instructions of [mac, linux, windows]) {
    assert.match(instructions.commands, /omd doctor$/u);
  }
});
