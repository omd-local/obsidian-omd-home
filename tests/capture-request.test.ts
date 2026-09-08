import assert from "node:assert/strict";
import test from "node:test";
import {
  captureFailureForIssue,
  captureRequestFromSettings,
  createCaptureFailureRecord,
  createCaptureRequest,
  captureLanguageSelectionError,
  filterReadyOcrPresets,
  missingInstalledOcrPacks,
  normalizeOcrLanguageSet,
  hasCaptureLanguageOverrides,
  ocrLanguageValue,
  whisperLanguageValue,
} from "../src/capture-request.ts";

test("vault capture defaults preserve OMD language defaults", () => {
  const request = captureRequestFromSettings(" https://example.com ", {
    capturePolish: false,
    captureSuggestLinksAndTags: true,
    captureOcrLanguage: "",
    captureAsrLanguage: "inherit-adapter-default",
  });

  assert.equal(request.source, "https://example.com");
  assert.deepEqual(request.ocr, { mode: "inherit" });
  assert.deepEqual(request.asr, { mode: "inherit-adapter-default" });
  assert.equal(hasCaptureLanguageOverrides(request), false);
  assert.equal(ocrLanguageValue(request.ocr), null);
  assert.equal(whisperLanguageValue(request.asr), null);
});

test("capture settings map OCR presets and all three ASR modes", () => {
  const simplified = captureRequestFromSettings("image.png", {
    capturePolish: true,
    captureSuggestLinksAndTags: false,
    captureOcrLanguage: "chi_sim+eng",
    captureAsrLanguage: "auto-detect",
  });
  assert.deepEqual(simplified.ocr, { mode: "preset", language: "chi_sim+eng" });
  assert.deepEqual(simplified.asr, { mode: "auto-detect" });
  assert.equal(whisperLanguageValue(simplified.asr), "auto");

  const explicit = captureRequestFromSettings("audio.mp3", {
    capturePolish: false,
    captureSuggestLinksAndTags: true,
    captureOcrLanguage: "deu+eng",
    captureAsrLanguage: "zh",
  });
  assert.deepEqual(explicit.ocr, { mode: "custom", language: "deu+eng" });
  assert.deepEqual(explicit.asr, { mode: "explicit", language: "zh" });
  assert.equal(ocrLanguageValue(explicit.ocr), "deu+eng");
  assert.equal(whisperLanguageValue(explicit.asr), "zh");
  assert.equal(hasCaptureLanguageOverrides(explicit), true);
});

test("capture snapshots clone and freeze mutable caller data", () => {
  const tags = [" research "];
  const request = createCaptureRequest({
    source: " image.png ",
    tags,
    polish: true,
    suggest: true,
    ocr: { mode: "preset", language: "eng" },
    asr: { mode: "explicit", language: "en" },
  });
  tags.push("mutated");

  assert.deepEqual(request.tags, ["research"]);
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.tags), true);
  assert.equal(Object.isFrozen(request.ocr), true);
  assert.equal(Object.isFrozen(request.asr), true);
  assert.throws(() => {
    (request.tags as string[]).push("blocked");
  }, TypeError);
});

test("a failed capture retry belongs only to the issue created by that attempt", () => {
  const request = createCaptureRequest({ source: "image.png", polish: true });
  const failure = createCaptureFailureRecord(4, 17, "ai", 1_725_000_000_000, "Model unavailable.", request);

  assert.equal(Object.isFrozen(failure), true);
  assert.notEqual(failure.request, request);
  assert.equal(failure.failedAt, 1_725_000_000_000);
  assert.equal(failure.detail, "Model unavailable.");
  assert.deepEqual(captureFailureForIssue(failure, 17), failure);
  assert.equal(captureFailureForIssue(failure, 18), null);
  assert.equal(captureFailureForIssue(null, 17), null);
});

test("capture failure snapshots normalize invalid display metadata", () => {
  const failure = createCaptureFailureRecord(
    5,
    18,
    "capture",
    Number.NaN,
    "   ",
    createCaptureRequest({ source: "missing.pdf" }),
  );

  assert.equal(failure.failedAt, 0);
  assert.equal(failure.detail, "Capture did not finish.");
});

test("custom OCR packs are bounded and cannot become command arguments", () => {
  assert.throws(() => createCaptureRequest({
    source: "image.png",
    tags: [],
    polish: false,
    suggest: false,
    ocr: { mode: "custom", language: "eng --output /tmp/file" },
    asr: { mode: "inherit-adapter-default" },
  }), /language pack ids/i);
  assert.throws(() => createCaptureRequest({
    source: "image.png",
    tags: [],
    polish: false,
    suggest: false,
    ocr: { mode: "custom", language: "a+b+c+d+e+f+g+h+i" },
    asr: { mode: "inherit-adapter-default" },
  }), /up to eight/i);
});

test("custom OCR normalization matches OMD's bounded Tesseract grammar", () => {
  assert.equal(normalizeOcrLanguageSet(" script/HanS + eng + script/HanS "), "script/HanS+eng");
  assert.equal(normalizeOcrLanguageSet("script/../../etc+eng"), null);
  assert.equal(normalizeOcrLanguageSet("eng++deu"), null);
  assert.deepEqual(missingInstalledOcrPacks("script/HanS+eng", ["eng"]), ["script/HanS"]);
  assert.deepEqual(missingInstalledOcrPacks("script/HanS+eng", null), []);
});

test("only installed OCR presets remain selectable and submit validation fails closed", () => {
  const availability = {
    status: "supported" as const,
    message: "",
    ocrPresets: [
      { label: "English", value: "eng" as const },
      { label: "简体中文 + English", value: "chi_sim+eng" as const },
    ],
    customOcr: true,
    ocrBackendAvailable: true,
    ocrInstalledPacks: ["eng"],
    asrAutoDetect: true,
    asrExplicit: true,
  };
  const ready = filterReadyOcrPresets(
    availability.ocrPresets,
    availability.ocrBackendAvailable,
    availability.ocrInstalledPacks,
  );
  assert.deepEqual(ready.map((preset) => preset.value), ["eng"]);
  const unavailableRequest = createCaptureRequest({
    source: "image.png",
    ocr: { mode: "preset", language: "chi_sim+eng" },
  });
  assert.match(captureLanguageSelectionError(unavailableRequest, availability) ?? "", /Missing.*chi_sim/iu);
});
