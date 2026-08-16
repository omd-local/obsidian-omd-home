import assert from "node:assert/strict";
import test from "node:test";
import { OmdCapabilityService } from "../src/enrichment/capability.ts";

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
