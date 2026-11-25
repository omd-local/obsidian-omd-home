import assert from "node:assert/strict";
import test from "node:test";
import { describeEnrichmentFailure, mapOmdErrorKind } from "../src/enrichment/errors.ts";

test("duplicate concept failure explains the model's mistake without implying conversion failed", () => {
  const error = mapOmdErrorKind("invalid_model_json", "qwen3:0.6b",
    "model classified an existing note or wikilink as a new concept");
  assert.equal(error.code, "invalid_response");
  assert.match(error.message, /existing note as a new concept/u);
  const failure = describeEnrichmentFailure(error, "generation");
  assert.equal(failure.phase, "error");
  assert.match(failure.detailText, /No proposal changes were written/u);
  assert.doesNotMatch(failure.statusText, /conversion failed|could not validate/u);
});

test("incomplete structured output has specific recovery copy", () => {
  assert.match(mapOmdErrorKind("invalid_model_json", undefined,
    "model output has an invalid object shape").message, /incomplete proposal/u);
});

test("unknown model diagnostics never expose arbitrary note content", () => {
  const error = mapOmdErrorKind("invalid_model_json", undefined,
    "private note title and arbitrary terminal content");
  assert.match(error.message, /could not validate/u);
  assert.doesNotMatch(error.message, /private note|arbitrary terminal/u);
});
