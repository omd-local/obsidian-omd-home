import assert from "node:assert/strict";
import test from "node:test";
import { omdCaptureArgs, parseOmdEvent } from "../src/omd-events.ts";

test("parses versioned OMD progress", () => {
  assert.deepEqual(parseOmdEvent('{"v":1,"ts":1.25,"event":"progress","percent":50}'), {
    v: 1, ts: 1.25, event: "progress", percent: 50,
  });
});

test("capture forwards normalized tags to OMD", () => {
  assert.deepEqual(omdCaptureArgs("https://example.com", "/vault", ["#research", "calendar/work"]), [
    "capture", "https://example.com", "--vault", "/vault", "--json-events", "--tags", "research,calendar/work",
  ]);
});

test("capture opts into remembered local Markdown polish", () => {
  assert.deepEqual(omdCaptureArgs(
    "https://example.com",
    "/vault",
    [],
    { enabled: true, model: "qwen3:4b-instruct", host: "http://localhost:11434" },
  ), [
    "capture", "https://example.com", "--vault", "/vault", "--json-events",
    "--polish-md", "--polish-md-model", "qwen3:4b-instruct",
    "--polish-md-host", "http://localhost:11434",
  ]);
});

test("ignores logs and unknown schema versions", () => {
  assert.equal(parseOmdEvent("downloading"), null);
  assert.equal(parseOmdEvent('{"v":2,"ts":1,"event":"progress"}'), null);
});
