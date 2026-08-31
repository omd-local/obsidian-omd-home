import assert from "node:assert/strict";
import test from "node:test";
import {
  discoverOmdExecutable,
  isAutomaticOmdExecutable,
  omdExecutableCandidates,
  omdInstallInstructions,
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
