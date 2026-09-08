import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const controllerSource = readFileSync(resolve("src/enrichment/controller.ts"), "utf8");
const reviewModalSource = readFileSync(resolve("src/enrichment/review-modal.ts"), "utf8");

test("enrichment exposes cancellability only before the Apply write phase", () => {
  const canCancel = extractMember(controllerSource, "get canCancel(): boolean");
  assert.match(canCancel, /phase === "capability"/u);
  assert.match(canCancel, /phase === "catalog"/u);
  assert.match(canCancel, /phase === "generating"/u);
  assert.match(canCancel, /phase === "review"/u);
  assert.doesNotMatch(canCancel, /phase === "applying"/u);
});

test("enrichment cancellation becomes a no-op once Apply begins writing", () => {
  const apply = extractMember(controllerSource, "private async apply(");
  const applyingAt = apply.indexOf('phase: "applying"');
  const writeAt = apply.indexOf("await applyEnrichmentSelection(");
  assert.ok(applyingAt >= 0, "Apply must enter the applying phase");
  assert.ok(writeAt > applyingAt, "Apply must become non-cancellable before any write can start");

  const cancel = extractMember(controllerSource, "cancel(showIdleNotice = true): boolean");
  assert.match(cancel, /if \(!this\.canCancel\) \{[\s\S]*cannot be cancelled[\s\S]*return false;/u);
  assert.match(cancel, /active\.abortController\.abort\(\)/u);
  assert.ok(
    cancel.indexOf("if (!this.canCancel)") < cancel.indexOf("active.abortController.abort()"),
    "Apply must return before it aborts model, runner, or capability work",
  );
});

test("enrichment cancellation leaves unrelated Local AI requests running", () => {
  const active = controllerSource.slice(
    controllerSource.indexOf("interface ActiveEnrichment"),
    controllerSource.indexOf("export class EnrichmentWorkflowController"),
  );
  const start = extractMember(controllerSource, "async start(file: TFile): Promise<void>");
  const cancel = extractMember(controllerSource, "cancel(showIdleNotice = true): boolean");

  assert.match(active, /abortController: AbortController/u);
  assert.match(start, /requireReadyOmdExecutable\(\)/u);
  assert.match(start, /requireEnrichNote\(executable, abortController\.signal\)/u);
  assert.match(start, /this\.plugin\.runLocalAiGated\([\s\S]*abortController\.signal,/u);
  assert.match(cancel, /active\.abortController\.abort\(\)/u);
  assert.match(cancel, /this\.plugin\.omdEnrichmentRunner\.cancel\(\)/u);
  assert.doesNotMatch(cancel, /cancelLocalAiRequests|localAiControllers/u);
  assert.doesNotMatch(cancel, /omdCapabilityService\.cancelActive/u);
});

test("starting another enrichment during Apply preserves the active workflow", () => {
  const start = extractMember(controllerSource, "async start(file: TFile): Promise<void>");
  const applyingGuardAt = start.indexOf('this.active?.state.phase === "applying"');
  assert.ok(applyingGuardAt >= 0, "start must detect an active Apply");

  const guardReturnAt = start.indexOf("return;", applyingGuardAt);
  assert.ok(guardReturnAt > applyingGuardAt, "the Apply guard must refuse the new enrichment");
  const guard = start.slice(applyingGuardAt, guardReturnAt + "return;".length);
  assert.match(guard, /Wait for the active OMD enrichment to finish applying/u);
  assert.doesNotMatch(guard, /this\.active\s*=/u, "the Apply guard must keep ownership with the original workflow");

  for (const operation of [
    "this.cancel(false)",
    "this.active = active",
    "buildEnrichmentRequest(",
    "this.plugin.omdEnrichmentRunner.run(",
  ]) {
    assert.ok(
      start.indexOf(operation) > guardReturnAt,
      `${operation} must remain unreachable when the Apply guard returns`,
    );
  }
});

test("an unavailable note closes instead of retrying a vanished target", () => {
  const actions = extractMember(reviewModalSource, "private renderActions(");
  assert.match(
    actions,
    /if \(phase === "unavailable"\) \{\s*this\.button\(parent, "Close", false, \(\) => this\.closeWithoutCallback\(\)\);\s*return;\s*\}/u,
  );
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
