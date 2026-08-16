import assert from "node:assert/strict";
import test from "node:test";
import { looksCapturable, safeFileName } from "../src/omnibox-utils.ts";

test("detects capturable omnibox inputs", () => {
  assert.equal(looksCapturable("https://example.com"), true);
  assert.equal(looksCapturable("/Users/example/file.pdf"), true);
  assert.equal(looksCapturable("~/Downloads/file.pdf"), true);
  assert.equal(looksCapturable("meeting notes"), false);
});

test("sanitizes generated quick note names", () => {
  assert.equal(safeFileName("Plan: sprint/review?"), "Plan- sprint-review-");
  assert.equal(safeFileName("   "), "Quick note");
});
