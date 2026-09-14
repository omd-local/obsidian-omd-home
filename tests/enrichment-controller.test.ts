import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { describeEnrichmentFailure, mapOmdErrorKind } from "../src/enrichment/errors.ts";
import {
  canApplyEnrichment,
  emptyReviewState,
  selectedSuggestions,
  type EnrichmentReviewState,
  type EnrichmentSelection,
} from "../src/enrichment/workflow.ts";

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

test("candidate evidence failure renders only Close while unknown errors retain retry", async () => {
  const known = mapOmdErrorKind("invalid_request", undefined, "private terminal text", {
    field: "candidate.evidence", reason: "incompatible_text",
  });
  const state = {
    ...emptyReviewState("Inbox/example.md", "local-model", "http://localhost:11434"),
    ...describeEnrichmentFailure(known, "generation"),
  };
  const blocked = renderActions(state);
  assert.deepEqual(blocked.buttons.map((button) => button.label), ["Close"]);
  await blocked.buttons[0].action();
  assert.equal(blocked.closed, true);
  assert.equal(blocked.retries, 0);

  const unknown = mapOmdErrorKind("invalid_request", undefined, undefined, {
    field: "candidate.evidence", reason: "unknown",
  });
  const retriable = renderActions({
    ...emptyReviewState("Inbox/example.md", "local-model", "http://localhost:11434"),
    ...describeEnrichmentFailure(unknown, "generation"),
  });
  assert.deepEqual(retriable.buttons.map((button) => button.label), ["Close", "Generate again"]);
  await retriable.buttons[1].action();
  assert.equal(retriable.retries, 1);
});

test("review still requires an explicit Apply action before selected suggestions are written", async () => {
  const review = renderActions({
    ...emptyReviewState("Inbox/example.md", "local-model", "http://localhost:11434"),
    phase: "review",
    existingTags: [{ id: "tag-1", kind: "existing-tag", label: "#writing", selected: true }],
  }, { selectedIds: { "tag-1": true } });
  assert.deepEqual(review.buttons.map((button) => button.label), ["Cancel", "Apply"]);
  assert.equal(review.applies, 0);
  await review.buttons[1].action();
  assert.equal(review.applies, 1);
});

function renderActions(state: EnrichmentReviewState, selection: EnrichmentSelection = { selectedIds: {} }): {
  buttons: Array<{ label: string; action: () => void | Promise<void>; disabled: boolean }>;
  closed: boolean;
  retries: number;
  applies: number;
} {
  const source = ts.createSourceFile("review-modal.ts", reviewModalSource, ts.ScriptTarget.Latest, true);
  const member = source.statements
    .flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : [])
    .find((node) => node.name?.getText(source) === "renderActions");
  assert.ok(member, "The production modal must define renderActions");
  const compiled = ts.transpileModule(`class Harness { ${member.getText(source)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const harness = new Function("canApplyEnrichment", "selectedSuggestions", `${compiled}\nreturn new Harness();`)(
    canApplyEnrichment, selectedSuggestions,
  ) as { renderActions: (parent: unknown) => void };
  const result = { buttons: [] as Array<{ label: string; action: () => void | Promise<void>; disabled: boolean }>, closed: false, retries: 0, applies: 0 };
  Object.assign(harness, {
    state, selection,
    callbacks: {
      onRetry() { result.retries += 1; },
      onApply() { result.applies += 1; },
    },
    closeWithoutCallback() { result.closed = true; },
    close() { result.closed = true; },
    button(_parent: unknown, label: string, _primary: boolean, action: () => void | Promise<void>) {
      const button = { label, action, disabled: false, setAttribute() {} };
      result.buttons.push(button);
      return button;
    },
  });
  harness.renderActions({});
  return result;
}

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
