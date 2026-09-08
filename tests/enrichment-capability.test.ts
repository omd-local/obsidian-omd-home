import assert from "node:assert/strict";
import test from "node:test";
import { createCaptureRequest } from "../src/capture-request.ts";
import {
  omdCapabilityIdentityLabel,
  OmdCapabilityService,
} from "../src/enrichment/capability.ts";

test("capability service caches successful enrich-note probes", async () => {
  let calls = 0;
  const service = new OmdCapabilityService(async () => {
    calls += 1;
    return {
      stdout: "{\"enrich_note\":{\"supported\":true,\"schema_versions\":[1]}}",
      stderr: "",
      code: 0,
    };
  });

  await service.requireEnrichNote("/usr/local/bin/omd");
  await service.requireEnrichNote("/usr/local/bin/omd");
  assert.equal(calls, 1);
});

test("capability service rejects unsupported enrich-note versions", async () => {
  const service = new OmdCapabilityService(async () => ({
    stdout: "{\"enrich_note\":{\"supported\":true,\"schema_versions\":[2]}}",
    stderr: "",
    code: 0,
  }));
  await assert.rejects(service.requireEnrichNote("omd"), /does not support enrich-note schema v1/i);
});

test("capability service maps missing executable errors", async () => {
  const service = new OmdCapabilityService(async () => {
    throw new Error("spawn ENOENT");
  });
  await assert.rejects(service.requireEnrichNote("omd"), /could not be found/i);
});

test("capability service explains legacy OMD executables clearly", async () => {
  const service = new OmdCapabilityService(async () => ({
    stdout: "",
    stderr: "error: capabilities not found",
    code: 1,
  }));

  await assert.rejects(
    service.requireEnrichNote("omd"),
    /too old for capabilities\/enrich-note/i,
  );
});

test("capability service caches a failed probe until retry clears it", async () => {
  let calls = 0;
  const service = new OmdCapabilityService(async () => {
    calls += 1;
    return {
      stdout: "{\"enrich_note\":{\"supported\":true,\"schema_versions\":[2]}}",
      stderr: "",
      code: 0,
    };
  });

  await assert.rejects(service.requireEnrichNote("omd"), /schema v1/i);
  await assert.rejects(service.requireEnrichNote("omd"), /schema v1/i);
  assert.equal(calls, 1);
  await assert.rejects(service.retry("omd"), /schema v1/i);
  assert.equal(calls, 2);
});

test("a cancelled capability probe is not retained as a stale rejected cache entry", async () => {
  let calls = 0;
  const service = new OmdCapabilityService(async (_command, _args, options) => {
    calls += 1;
    if (calls === 1) {
      return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
    return {
      stdout: JSON.stringify(languageCapabilities()),
      stderr: "",
      code: 0,
    };
  });
  const request = createCaptureRequest({
    source: "image.png",
    ocr: { mode: "preset", language: "eng" },
  });
  const controller = new AbortController();
  const cancelled = service.requireCaptureLanguages("omd", request, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, /cancelled/iu);

  await service.requireCaptureLanguages("omd", request);
  assert.equal(calls, 2);
});

test("one cancelled waiter does not abort a shared capability probe", async () => {
  let calls = 0;
  let aborts = 0;
  let finish!: (result: { stdout: string; stderr: string; code: number }) => void;
  const pendingResult = new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    finish = resolve;
  });
  const service = new OmdCapabilityService(async (_command, _args, options) => {
    calls += 1;
    options?.signal?.addEventListener("abort", () => { aborts += 1; }, { once: true });
    return await pendingResult;
  });
  const firstController = new AbortController();
  const first = service.requireEnrichNote("omd", firstController.signal);
  const second = service.requireEnrichNote("omd");

  firstController.abort();
  await assert.rejects(first, /cancelled/iu);
  finish({ stdout: JSON.stringify(languageCapabilities()), stderr: "", code: 0 });
  await second;

  assert.equal(calls, 1);
  assert.equal(aborts, 0);
});

test("an aborted waiter does not evict an already-settled capability", async () => {
  let calls = 0;
  const service = new OmdCapabilityService(async () => {
    calls += 1;
    return { stdout: JSON.stringify(languageCapabilities()), stderr: "", code: 0 };
  });
  await service.requireEnrichNote("omd");
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(service.requireEnrichNote("omd", controller.signal), /cancelled/iu);
  await service.requireEnrichNote("omd");
  assert.equal(calls, 1);
});

test("an explicit retry can replace a cached language-contract failure after OMD updates in place", async () => {
  let updated = false;
  let calls = 0;
  const service = new OmdCapabilityService(async () => {
    calls += 1;
    return {
      stdout: JSON.stringify(updated
        ? languageCapabilities()
        : { enrich_note: { supported: true, schema_versions: [1] } }),
      stderr: "",
      code: 0,
    };
  });
  const request = createCaptureRequest({
    source: "image.png",
    ocr: { mode: "preset", language: "eng" },
  });

  await assert.rejects(service.requireCaptureLanguages("/usr/local/bin/omd", request), /newer OMD build/iu);
  updated = true;
  await assert.rejects(service.requireCaptureLanguages("/usr/local/bin/omd", request), /newer OMD build/iu);
  service.clear("/usr/local/bin/omd");
  await service.requireCaptureLanguages("/usr/local/bin/omd", request);
  assert.equal(calls, 2);
});

test("capability service maps malformed JSON and timeouts", async () => {
  const malformed = new OmdCapabilityService(async () => ({
    stdout: "{",
    stderr: "",
    code: 0,
  }));
  await assert.rejects(malformed.requireEnrichNote("omd"), /invalid capability response/i);

  const timeout = new OmdCapabilityService(async () => {
    throw new Error("process timed out after 5000ms");
  });
  await assert.rejects(timeout.requireEnrichNote("omd"), /timed out after five seconds/i);
});

test("capability identity labels package, protocol, and optional build without inventing legacy metadata", () => {
  assert.equal(
    omdCapabilityIdentityLabel({
      package_version: "0.4.0",
      protocol_version: 1,
      build_revision: "abc123",
    }),
    "package 0.4.0 · protocol v1 · build abc123",
  );
  assert.equal(omdCapabilityIdentityLabel({}), "");
});

test("inherited recognition remains compatible without probing legacy OMD capabilities", async () => {
  let calls = 0;
  const service = new OmdCapabilityService(async () => {
    calls += 1;
    throw new Error("legacy executable should not be probed for language capabilities");
  });
  const request = createCaptureRequest({
    source: "image.png",
    tags: [],
    polish: false,
    suggest: false,
  });

  await service.requireCaptureLanguages("legacy-omd", request);
  assert.equal(calls, 0);
});

test("explicit OCR and ASR overrides require and accept the frozen language contract", async () => {
  let calls = 0;
  const service = new OmdCapabilityService(async () => {
    calls += 1;
    return {
      stdout: JSON.stringify(languageCapabilities()),
      stderr: "",
      code: 0,
    };
  });
  const request = createCaptureRequest({
    source: "media.mp4",
    tags: [],
    polish: false,
    suggest: false,
    ocr: { mode: "preset", language: "chi_sim+eng" },
    asr: { mode: "auto-detect" },
  });

  await service.requireCaptureLanguages("omd", request);
  await service.requireCaptureLanguages("omd", request);
  assert.equal(calls, 1);
});

test("explicit language overrides explain that an older OMD must be updated", async () => {
  const service = new OmdCapabilityService(async () => ({
    stdout: JSON.stringify({ enrich_note: { supported: true, schema_versions: [1] } }),
    stderr: "",
    code: 0,
  }));
  const request = createCaptureRequest({
    source: "image.png",
    tags: [],
    polish: false,
    suggest: false,
    ocr: { mode: "preset", language: "eng" },
  });

  await assert.rejects(
    service.requireCaptureLanguages("old-omd", request),
    /requires a newer OMD build.+choose No language preference or update OMD/iu,
  );
});

test("capture language gating rejects contracts that cannot accept Home's exact argv", async () => {
  const unsupportedOcrFlag = languageCapabilities();
  unsupportedOcrFlag.capture_language_options.ocr.aliases = ["--lang"];
  const ocrService = new OmdCapabilityService(async () => ({
    stdout: JSON.stringify(unsupportedOcrFlag), stderr: "", code: 0,
  }));
  const ocrRequest = createCaptureRequest({
    source: "image.png", tags: [], polish: false, suggest: false,
    ocr: { mode: "preset", language: "eng" },
  });
  await assert.rejects(ocrService.requireCaptureLanguages("omd", ocrRequest), /--ocr-lang/iu);

  const unsupportedAsrMode = languageCapabilities();
  unsupportedAsrMode.capture_language_options.asr.modes = ["inherit-adapter-default", "explicit"];
  const asrService = new OmdCapabilityService(async () => ({
    stdout: JSON.stringify(unsupportedAsrMode), stderr: "", code: 0,
  }));
  const asrRequest = createCaptureRequest({
    source: "audio.mp3", tags: [], polish: false, suggest: false,
    asr: { mode: "auto-detect" },
  });
  await assert.rejects(asrService.requireCaptureLanguages("omd", asrRequest), /auto-detect/iu);
});

function languageCapabilities() {
  return {
    package_version: "0.4.0",
    protocol_version: 1,
    build_revision: null,
    config_schema: { current_version: 1, supported_versions: [1] },
    capture_language_options: {
      ocr: {
        argument: "--ocr-language",
        aliases: ["--ocr-lang", "--lang"],
        composite: true,
        separator: "+",
        presets: [
          { id: "english", label: "English", value: "eng" },
          { id: "simplified-chinese-english", label: "简体中文 + English", value: "chi_sim+eng" },
          { id: "traditional-chinese-english", label: "繁體中文 + English", value: "chi_tra+eng" },
        ],
      },
      asr: {
        argument: "--whisper-lang",
        modes: ["inherit-adapter-default", "auto-detect", "explicit"],
      },
    },
    enrich_note: { supported: true, schema_versions: [1] },
  };
}
