import assert from "node:assert/strict";
import test from "node:test";
import { createCaptureRequest } from "../src/capture-request.ts";
import {
  captureWorkflowDoneEvent,
  omdCaptureArgs,
  parseOmdEvent,
  sanitizeCaptureProgressEvent,
  shouldSurfaceCaptureEvent,
} from "../src/omd-events.ts";

test("parses versioned OMD progress", () => {
  assert.deepEqual(parseOmdEvent('{"v":1,"ts":1.25,"event":"progress","percent":50}'), {
    v: 1, ts: 1.25, event: "progress", percent: 50,
  });
});

test("capture forwards normalized tags to OMD", () => {
  const request = createCaptureRequest({
    source: "https://example.com",
    tags: ["#research", "calendar/work"],
    polish: false,
    suggest: true,
  });
  assert.deepEqual(omdCaptureArgs(request, "/vault"), [
    "capture", "https://example.com", "--vault", "/vault", "--json-events", "--tags", "research,calendar/work",
  ]);
});

test("capture opts into remembered local Markdown polish", () => {
  const request = createCaptureRequest({
    source: "https://example.com",
    tags: [],
    polish: true,
    suggest: false,
  });
  assert.deepEqual(omdCaptureArgs(
    request,
    "/vault",
    { enabled: true, model: "qwen3:4b-instruct", host: "http://localhost:11434" },
  ), [
    "capture", "https://example.com", "--vault", "/vault", "--json-events",
    "--polish-md", "--polish-md-model", "qwen3:4b-instruct",
    "--polish-md-host", "http://localhost:11434",
  ]);
});

test("capture emits exact OCR and ASR argv only for explicit overrides", () => {
  const inherited = createCaptureRequest({
    source: "image.png",
    tags: [],
    polish: false,
    suggest: false,
  });
  assert.deepEqual(omdCaptureArgs(inherited, "/vault"), [
    "capture", "image.png", "--vault", "/vault", "--json-events",
  ]);

  const mixed = createCaptureRequest({
    ...inherited,
    ocr: { mode: "preset", language: "chi_sim+eng" },
    asr: { mode: "auto-detect" },
  });
  assert.deepEqual(omdCaptureArgs(mixed, "/vault"), [
    "capture", "image.png", "--vault", "/vault", "--json-events",
    "--ocr-lang", "chi_sim+eng", "--whisper-lang", "auto",
  ]);

  const explicit = createCaptureRequest({
    ...inherited,
    asr: { mode: "explicit", language: "zh" },
  });
  assert.deepEqual(omdCaptureArgs(explicit, "/vault"), [
    "capture", "image.png", "--vault", "/vault", "--json-events",
    "--whisper-lang", "zh",
  ]);
});

test("social capture sends only the matching provider cookie path as one shell-free argument", () => {
  const paths = {
    douyinCookiesPath: "/Users/test/抖音 access/cookies $(touch never).txt",
    xhsCookiesPath: "/Users/test/小红书 access/cookies; never.txt",
  };
  const douyin = createCaptureRequest({ source: "复制 https://v.douyin.com/abc/ 打开抖音" });
  const douyinArgs = omdCaptureArgs(douyin, "/vault", undefined, paths);
  assert.deepEqual(douyinArgs.slice(-2), ["--douyin-cookies", paths.douyinCookiesPath]);
  assert.equal(douyinArgs.includes("--xhs-cookies"), false);
  assert.equal(douyinArgs[1], "https://v.douyin.com/abc/");

  const xhs = createCaptureRequest({ source: "复制 https://xhslink.com/a/xyz 打开小红书" });
  const xhsArgs = omdCaptureArgs(xhs, "/vault", undefined, paths);
  assert.deepEqual(xhsArgs.slice(-2), ["--xhs-cookies", paths.xhsCookiesPath]);
  assert.equal(xhsArgs.includes("--douyin-cookies"), false);

  const generic = createCaptureRequest({ source: "https://example.com/article" });
  const genericArgs = omdCaptureArgs(generic, "/vault", undefined, paths);
  assert.equal(genericArgs.includes("--douyin-cookies"), false);
  assert.equal(genericArgs.includes("--xhs-cookies"), false);
});

test("ignores logs and unknown schema versions", () => {
  assert.equal(parseOmdEvent("downloading"), null);
  assert.equal(parseOmdEvent('{"v":2,"ts":1,"event":"progress"}'), null);
});

test("capture progress exposes only bounded fields and redacts local access paths", () => {
  const secret = "/Users/test/抖音 access/cookies.txt";
  const sanitized = sanitizeCaptureProgressEvent({
    v: 1,
    ts: 1,
    event: "progress",
    kind: "download",
    percent: 175,
    label: `Loading ${secret}`,
    name: secret,
    message: `Using ${secret}\n${"x".repeat(300)}`,
    output: secret,
    unexpected: secret,
  } as never, [secret]);

  assert.equal(sanitized.percent, 100);
  assert.equal(sanitized.output, undefined);
  assert.equal((sanitized as unknown as Record<string, unknown>).unexpected, undefined);
  assert.doesNotMatch(JSON.stringify(sanitized), /Users|cookies\.txt/u);
  assert.match(sanitized.label ?? "", /local access file/u);
  assert.ok((sanitized.message?.length ?? 0) <= 240);
});

test("keeps OMD's converter completion internal until the Inbox workflow succeeds", () => {
  assert.equal(shouldSurfaceCaptureEvent({ v: 1, ts: 1, event: "done", output: "/vault/planned.md" }), false);
  assert.equal(shouldSurfaceCaptureEvent({ v: 1, ts: 1, event: "progress", percent: 100 }), true);
  assert.deepEqual(captureWorkflowDoneEvent("Sources/Web/Example.md", 2_500), {
    v: 1,
    event: "done",
    kind: "done",
    ts: 2.5,
    message: "Saved to OMD Inbox",
    output: "Sources/Web/Example.md",
  });
});
