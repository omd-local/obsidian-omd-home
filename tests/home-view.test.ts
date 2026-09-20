import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { inferCaptureActive, summarizeProcessingEvents } from "../src/processing-state.ts";

const homeSource = readFileSync(resolve("src/home-view.ts"), "utf8");
const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
const omniboxSource = readFileSync(resolve("src/omnibox.ts"), "utf8");
const enrichmentControllerSource = readFileSync(resolve("src/enrichment/controller.ts"), "utf8");
const stylesSource = readFileSync(resolve("src/styles.css"), "utf8");

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

test("processing actions only offer Cancel while the active phase is cancellable", () => {
  assert.match(
    homeSource,
    /const canCancel = this\.plugin\.captureCancelable \|\| this\.plugin\.enrichmentCancelable/u,
  );
  assert.match(homeSource, /if \(canCancel\) \{[\s\S]*text: "Cancel"/u);
  assert.doesNotMatch(homeSource, /if \(activity\.active\) \{\s*const controls = body\.createDiv[\s\S]*text: "Cancel"/u);
});

test("a failed capture keeps a dedicated Retry after another issue replaces it", () => {
  assert.match(homeSource, /const captureFailure = this\.plugin\.currentCaptureFailure\(\)/u);
  assert.match(homeSource, /const captureFailureForIssue = this\.plugin\.captureFailureForCurrentIssue\(\)/u);
  assert.match(homeSource, /this\.renderIndependentCaptureFailure\(body, captureFailure\)/u);
  const lastIssueBody = extractMethodBody(homeSource, "private renderLastIssue");
  assert.match(lastIssueBody, /captureFailureForCurrentIssue\(\)/u);
  const independentBody = extractMethodBody(homeSource, "private renderIndependentCaptureFailure");
  assert.match(independentBody, /formatIssueTime\(failure\.failedAt\)/u);
  assert.match(independentBody, /text: failure\.detail/u);
  assert.match(independentBody, /retryFailedCapture\(failure\.id\)/u);
});

test("capture activity falls back to the latest event state", () => {
  assert.equal(inferCaptureActive([
    { v: 1, ts: 0.1, event: "progress", percent: 50 },
  ]), true);
  assert.equal(inferCaptureActive([
    { v: 1, ts: 0.1, event: "done", percent: 100 },
  ]), false);
});

test("Current task shows startup work before OMD emits its first progress event", () => {
  assert.deepEqual(summarizeProcessingEvents([], true).active, {
    label: "Starting OMD",
    value: "working",
    tone: "active",
  });
  assert.deepEqual(summarizeProcessingEvents([
    { v: 1, ts: 0.1, event: "done", percent: 100, label: "Previous capture" },
  ], true).active, {
    label: "Starting OMD",
    value: "working",
    tone: "active",
  });
});

test("failed enrichment ends Current task and moves the actionable error to Needs attention", () => {
  const failed = summarizeProcessingEvents([
    { v: 1, ts: 0.1, event: "stage_state", label: "Local AI proposal" },
    { v: 1, ts: 2, event: "error", kind: "generation_timeout", message: "Local AI timed out" },
  ], false);
  assert.equal(failed.active, null);
  assert.deepEqual(failed.recent[0], {
    label: "Local AI timed out",
    value: "error",
    tone: "error",
  });
  assert.doesNotMatch(extractMethodBody(homeSource, "private get captureActive"), /inferCaptureActive/);
  assert.match(enrichmentControllerSource, /reportEnrichmentIssue\(error, file\.path\)/);
  assert.match(enrichmentControllerSource, /event: cancelled \? "cancelled" : "error"/);
});

test("backgrounding or closing the Home view does not cancel plugin-owned capture work", () => {
  const onClose = extractMethodBody(homeSource, "async onClose()");
  assert.doesNotMatch(onClose, /cancelActive|cancelActiveOmd|this\.plugin\.[\s\S]*dispose\(/u);
  assert.match(mainSource, /onunload\(\): void[\s\S]*this\.omdBridge\?\.dispose|this\.omdBridge\?\.dispose/);
});

test("closing Home disposes only its Omnibox-owned requests", () => {
  const onClose = extractMethodBody(homeSource, "async onClose()");
  assert.match(onClose, /this\.omnibox\?\.dispose\(\)/u);
  assert.doesNotMatch(onClose, /cancelActive|cancelActiveOmd/u);
});

test("Current task and Needs attention do not render the same terminal capture error", () => {
  assert.doesNotMatch(homeSource, /renderProcessingSection\(body,[\s\S]{0,120}activity\.recent/);
  assert.match(homeSource, /lastErrorAt/);
  assert.match(homeSource, /formatIssueTime/);
  assert.match(homeSource, /enrichmentCapability\.status === "unavailable"/);
  assert.match(homeSource, /if \(context === "inbox"\) return "Inbox update failed";/);
  assert.match(homeSource, /const failure = this\.plugin\.captureFailureForCurrentIssue\(\)/u);
  assert.match(homeSource, /retryFailedCapture\(failure\.id\)/u);
  assert.match(homeSource, /if \(this\.plugin\.lastErrorContext === "inbox" && this\.plugin\.lastErrorSource\)/);
});

test("Home exposes unchecked Local AI recovery without duplicating owned AI failures", () => {
  assert.match(homeSource, /statusLine\(body, "Local AI", this\.plugin\.localAiState\.daemonCode\)/u);
  assert.match(homeSource, /text: "Check setup"|\? "Checking…" : "Check setup"/u);
  assert.match(homeSource, /this\.plugin\.aiSetupBusy\(\)/u);
  assert.match(homeSource, /const localAiOwnsLastError = localAiNeedsAttention && this\.plugin\.lastErrorContext === "ai"/u);
  assert.match(
    homeSource,
    /if \(this\.plugin\.lastError && !localAiOwnsLastError\) this\.renderLastIssue\(body, this\.plugin\.currentIssueId\(\)\)/u,
  );
  assert.match(homeSource, /formatIssueTime\(this\.plugin\.localAiState\.catalogCheckedAt\)/u);
  assert.match(homeSource, /workflow\.code === this\.plugin\.localAiState\.daemonCode/u);
  assert.match(homeSource, /canOpenOllamaDesktopApp\(\)/u);
  assert.match(homeSource, /text: "Open Ollama"/u);
  assert.match(homeSource, /this\.plugin\.openOllamaApp\(\)/u);
});

test("hosted AI attention stays disabled while a credential child is still draining", () => {
  const hostedAttention = extractMethodBody(homeSource, "private renderHostedAiAttention");
  assert.match(hostedAttention, /const aiSetupBusy = this\.plugin\.aiSetupBusy\(\)/u);
  assert.match(hostedAttention, /check\.disabled = aiSetupBusy/u);
});

test("maintenance actions are available through Obsidian commands", () => {
  assert.match(mainSource, /id: "check-omd-setup"/u);
  assert.match(mainSource, /id: "open-omd-install-guide"/u);
  assert.match(mainSource, /id: "refresh-local-models"/u);
  assert.match(mainSource, /id: "check-local-ai"/u);
  assert.match(mainSource, /id: "smoke-local-ai-qa"/u);
  assert.match(mainSource, /id: "smoke-local-ai-enrichment"/u);
  assert.match(mainSource, /id: "smoke-local-ai-capture"/u);
  assert.match(mainSource, /id: "open-ollama-app"/u);
  assert.match(mainSource, /id: "refresh-calendars"/u);
});

test("missing OMD has guided recovery on Home without running an installer", () => {
  assert.match(homeSource, /text: "Copy install steps"/u);
  assert.match(homeSource, /text: this\.plugin\.enrichmentCapability\.code === "missing_executable" \? "Install guide" : "Update guide"/u);
  assert.match(homeSource, /text: "Check again"/u);
  assert.match(mainSource, /navigator\.clipboard\.writeText\(instructions\.commands\)/u);
  assert.match(mainSource, /window\.open\(OMD_INSTALL_GUIDE_URL/u);
  assert.doesNotMatch(mainSource, /brew install[\s\S]{0,120}spawnProcess|spawnProcess[\s\S]{0,120}brew install/u);
});

test("omnibox answers reserve an owned surface and note rows stay left aligned", () => {
  assert.match(stylesSource, /\.omd-omnibox-result-panel\s*\{/u);
  assert.doesNotMatch(stylesSource, /\.omd-omnibox-results\s*\{[^}]*position:\s*absolute/su);
  assert.match(stylesSource, /\.omd-result-row,\s*\.omd-note-row\s*\{[^}]*justify-items:\s*stretch/su);
  assert.match(stylesSource, /\.omd-note-title[^}]*text-align:\s*left/su);
  assert.match(stylesSource, /\.has-omnibox-results \.omd-widget-omnibox[^}]*min-height/su);
});

test("Home note surfaces and vault search results expose the shared pin action", () => {
  assert.match(extractMethodBody(homeSource, "private renderInbox("), /this\.createPinButton\(row, file\)/u);
  assert.match(extractMethodBody(homeSource, "private renderFileList("), /this\.createPinButton\(row, file\)/u);
  assert.match(omniboxSource, /action: \(\) => void this\.app\.workspace\.openLinkText\(file\.path,[\s\S]{0,100}file,/u);
  assert.match(extractMethodBody(omniboxSource, "private showRows("), /if \(row\.file\) this\.createPinButton\(parent, row\.file\)/u);
  assert.match(mainSource, /onClick\(\(\) => void this\.toggleNotePinned\(file\.path\)\)/u);
  assert.match(stylesSource, /\.omd-inbox-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--omd-pin-column\) var\(--omd-suggest-column\)/su);
  assert.match(stylesSource, /\.omd-pin-action\s*\{[^}]*border-left:\s*1px solid var\(--omd-line\)/su);
  assert.match(stylesSource, /\.omd-pin-action:focus-visible/u);
});

test("widget move and resize are locked while omnibox results temporarily own the layout", () => {
  assert.match(homeSource, /private allowLayoutEditing\(\): boolean/u);
  assert.match(extractMethodBody(homeSource, "private bindPointerTransform("), /if \(!this\.allowLayoutEditing\(\)\) return;/u);
  assert.match(extractMethodBody(homeSource, "private bindKeyboardResize("), /if \(!this\.allowLayoutEditing\(\)\) return;/u);
});

test("model settings keep labels stable while their controls reflow", () => {
  assert.match(stylesSource, /\.omd-settings-model\s*\{[^}]*grid-template-columns:/su);
  assert.match(stylesSource, /\.omd-settings-model \.setting-item-control\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/su);
  assert.match(stylesSource, /\.omd-settings-model \.setting-item-control :is\(select, input\[type="text"\], input\[type="password"\]\)\s*\{[^}]*flex:\s*1 1 210px/su);
  assert.match(stylesSource, /@media \(max-width: 900px\)[\s\S]*\.omd-settings-model\s*\{[^}]*grid-template-columns:\s*1fr/su);
});

test("Home stacks by content width before a narrow workspace clips its second column", () => {
  assert.match(stylesSource, /\.omd-home-view\s*\{[^}]*container:\s*omd-home\s*\/\s*inline-size/su);
  assert.match(stylesSource, /@container omd-home \(max-width: 1024px\)[\s\S]*\.omd-widget-grid\s*\{[^}]*display:\s*flex/su);
  assert.match(stylesSource, /@media \(max-width: 1100px\)[\s\S]*\.omd-widget-grid\s*\{[^}]*display:\s*flex/su);
});

function extractMethodBody(fileSource: string, signature: string): string {
  const start = fileSource.indexOf(signature);
  if (start < 0) throw new Error(`Missing ${signature}`);
  const bodyStart = fileSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === "{") depth += 1;
    if (fileSource[index] === "}") depth -= 1;
    if (depth === 0) return fileSource.slice(bodyStart, index + 1);
  }
  throw new Error(`Unclosed ${signature}`);
}
