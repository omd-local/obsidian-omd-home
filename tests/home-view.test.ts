import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { inferCaptureActive, summarizeProcessingEvents } from "../src/processing-state.ts";

const homeSource = readFileSync(resolve("src/home-view.ts"), "utf8");
const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
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
  assert.doesNotMatch(onClose, /cancelActive|cancelActiveOmd|dispose\(/);
  assert.match(mainSource, /onunload\(\): void[\s\S]*this\.omdBridge\?\.dispose|this\.omdBridge\?\.dispose/);
});

test("Current task and Needs attention do not render the same terminal capture error", () => {
  assert.doesNotMatch(homeSource, /renderProcessingSection\(body,[\s\S]{0,120}activity\.recent/);
  assert.match(homeSource, /lastErrorAt/);
  assert.match(homeSource, /formatIssueTime/);
  assert.match(homeSource, /enrichmentCapability\.status === "unavailable"/);
  assert.match(homeSource, /if \(context === "inbox"\) return "Inbox update failed";/);
  assert.match(homeSource, /if \(this\.plugin\.lastErrorContext === "capture"\)/);
  assert.match(homeSource, /if \(this\.plugin\.lastErrorContext === "inbox" && this\.plugin\.lastErrorSource\)/);
});

test("Home exposes unchecked Local AI recovery without duplicating owned AI failures", () => {
  assert.match(homeSource, /statusLine\(body, "Local AI", this\.plugin\.localAiState\.daemonCode\)/u);
  assert.match(homeSource, /text: "Check connection"|\? "Checking…" : "Check connection"/u);
  assert.match(homeSource, /const localAiOwnsLastError = localAiNeedsAttention && this\.plugin\.lastErrorContext === "ai"/u);
  assert.match(homeSource, /if \(this\.plugin\.lastError && !localAiOwnsLastError\) this\.renderLastIssue\(body\)/u);
  assert.match(homeSource, /formatIssueTime\(this\.plugin\.localAiState\.catalogCheckedAt\)/u);
  assert.match(homeSource, /workflow\.code === this\.plugin\.localAiState\.daemonCode/u);
});

test("maintenance actions are available through Obsidian commands", () => {
  assert.match(mainSource, /id: "refresh-local-models"/u);
  assert.match(mainSource, /id: "check-local-ai"/u);
  assert.match(mainSource, /id: "refresh-calendars"/u);
});

test("omnibox answers reserve an owned surface and note rows stay left aligned", () => {
  assert.match(stylesSource, /\.omd-omnibox-result-panel\s*\{/u);
  assert.doesNotMatch(stylesSource, /\.omd-omnibox-results\s*\{[^}]*position:\s*absolute/su);
  assert.match(stylesSource, /\.omd-result-row,\s*\.omd-note-row\s*\{[^}]*justify-items:\s*stretch/su);
  assert.match(stylesSource, /\.omd-note-title[^}]*text-align:\s*left/su);
  assert.match(stylesSource, /\.has-omnibox-results \.omd-widget-omnibox[^}]*min-height/su);
});

test("widget move and resize are locked while omnibox results temporarily own the layout", () => {
  assert.match(homeSource, /private allowLayoutEditing\(\): boolean/u);
  assert.match(extractMethodBody(homeSource, "private bindPointerTransform("), /if \(!this\.allowLayoutEditing\(\)\) return;/u);
  assert.match(extractMethodBody(homeSource, "private bindKeyboardResize("), /if \(!this\.allowLayoutEditing\(\)\) return;/u);
});

test("model settings keep labels stable while their controls reflow", () => {
  assert.match(stylesSource, /\.omd-settings-model\s*\{[^}]*grid-template-columns:/su);
  assert.match(stylesSource, /\.omd-settings-model \.setting-item-control\s*\{[^}]*grid-template-columns:/su);
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
