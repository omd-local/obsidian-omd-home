import assert from "node:assert/strict";
import test from "node:test";
import { inferCaptureActive, summarizeProcessingEvents } from "../src/processing-state.ts";

test("processing summary separates active work from completed history", () => {
  const summary = summarizeProcessingEvents([
    { v: 1, ts: 0.1, event: "fetch", percent: 10, label: "Fetch source" },
    { v: 1, ts: 1.2, event: "done", percent: 100, label: "Fetch source" },
    { v: 1, ts: 2.5, event: "index", percent: 40, label: "Index vault" },
  ], true);

  assert.deepEqual(summary.active, {
    label: "Index vault",
    value: "40%",
    tone: "active",
  });
  assert.deepEqual(summary.recent, [{
    label: "Fetch source",
    value: "completed",
    tone: "done",
  }]);
});

test("capture activity falls back to the latest event state", () => {
  assert.equal(inferCaptureActive([
    { v: 1, ts: 0.1, event: "progress", percent: 50 },
  ]), true);
  assert.equal(inferCaptureActive([
    { v: 1, ts: 0.1, event: "done", percent: 100 },
  ]), false);
});
