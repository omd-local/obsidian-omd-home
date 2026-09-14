import assert from "node:assert/strict";
import test from "node:test";
import {
  describeEnrichmentFailure,
  mapOmdErrorKind,
  OmdEnrichmentError,
  toUserFacingEnrichmentMessage,
} from "../src/enrichment/errors.ts";

test("recognized candidate validation maps to fixed safe copy", () => {
  const error = mapOmdErrorKind("invalid_request", "private model", "private terminal text", {
    field: "candidate.evidence", reason: "incompatible_text", evidence: "private candidate text",
  });
  assert.equal(error.code, "invalid_candidate_evidence");
  assert.match(error.message, /candidate note snippet/iu);
  assert.doesNotMatch(error.message, /private|generate again|model|try again/iu);
  assert.equal(toUserFacingEnrichmentMessage(error), error.message);
});

test("unknown or malformed validation categories keep the safe invalid-request fallback", () => {
  const fallback = mapOmdErrorKind("invalid_request");
  for (const validation of [
    undefined, null, "private validation text", [], 3,
    { field: "candidate.evidence" }, { reason: "incompatible_text" },
    { field: "private note field", reason: "incompatible_text" },
    { field: "candidate.evidence", reason: "private reason" },
    { field: { private: "candidate.evidence" }, reason: "incompatible_text" },
  ]) {
    const error = mapOmdErrorKind("invalid_request", undefined, "private terminal text", validation);
    assert.equal(error.code, fallback.code);
    assert.equal(error.message, fallback.message);
    assert.doesNotMatch(error.message, /private/iu);
  }
  assert.equal(mapOmdErrorKind("unknown", undefined, "private terminal text", {
    field: "candidate.evidence", reason: "incompatible_text",
  }).code, "omd_failed");
});

test("candidate validation recovery explains unchanged note without retry or a capture claim", () => {
  const error = new OmdEnrichmentError("invalid_candidate_evidence", "private candidate text");
  const failure = describeEnrichmentFailure(error, "generation");
  assert.equal(failure.phase, "error");
  assert.equal(failure.canRetry, false);
  assert.match(failure.statusText, /candidate note snippet/iu);
  assert.match(failure.detailText, /note is unchanged/iu);
  assert.doesNotMatch(JSON.stringify(failure), /private|capture|generate again|try again|model/iu);
  assert.doesNotMatch(describeEnrichmentFailure(error, "apply").detailText, /unchanged/iu);
});
