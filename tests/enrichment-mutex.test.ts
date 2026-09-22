import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const controllerSource = readFileSync(resolve("src/enrichment/controller.ts"), "utf8");
const mainSource = readFileSync(resolve("src/main.ts"), "utf8");

test("a pending non-modal review releases the workflow mutex while writes still block capture", () => {
  const generate = extractMember(controllerSource, "private async generate(");
  const busyAt = generate.indexOf("this.setBusy(true);");
  const reviewAt = generate.indexOf("active.state = reviewState(");
  const releaseAt = generate.indexOf("this.setBusy(false);", reviewAt);

  assert.ok(busyAt >= 0 && busyAt < reviewAt, "generation must claim ownership before setup");
  assert.ok(releaseAt > reviewAt, "review must release ownership so capture can continue beside the pane");

  const openCapture = extractMember(mainSource, "openCaptureModal(initialSource:");
  const submitAt = openCapture.indexOf("async (request) => {");
  assert.match(openCapture, /^openCaptureModal[^\{]*\{\s*if \(this\.captureActive \|\| this\.enrichmentActive\)/u);
  assert.match(
    openCapture.slice(submitAt),
    /if \(this\.captureActive \|\| this\.enrichmentActive\)[\s\S]*return;[\s\S]*this\.captureActive = true;/u,
  );

  const directCapture = extractMember(mainSource, "async captureWithOmd(");
  assert.match(
    directCapture,
    /if \(\(this\.captureActive && !captureAlreadyClaimed\) \|\| this\.enrichmentActive\)[\s\S]*return;/u,
  );
});

test("Apply and Capture claim mutually exclusive ownership before either can await", () => {
  const apply = extractMember(controllerSource, "private async apply(");
  const captureGuardAt = apply.indexOf("if (this.plugin.captureActive)");
  const captureGuardReturnAt = apply.indexOf("return;", captureGuardAt);
  const applyingAt = apply.indexOf('phase: "applying"');
  const writeAt = apply.indexOf("await applyEnrichmentSelection(");

  assert.ok(captureGuardAt >= 0, "Apply must recheck capture ownership");
  assert.ok(captureGuardReturnAt > captureGuardAt && captureGuardReturnAt < applyingAt);
  assert.ok(applyingAt > captureGuardAt && applyingAt < writeAt);

  const openCapture = extractMember(mainSource, "openCaptureModal(initialSource:");
  const submitAt = openCapture.indexOf("async (request) => {");
  const submit = openCapture.slice(submitAt);
  const claimAt = submit.indexOf("this.captureActive = true;");
  const firstAwaitAt = submit.indexOf("await this.saveSettings();");
  assert.ok(claimAt >= 0 && claimAt < firstAwaitAt, "Capture must claim ownership synchronously");
});

function extractMember(source: string, signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Missing ${signature}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${signature}`);
}
