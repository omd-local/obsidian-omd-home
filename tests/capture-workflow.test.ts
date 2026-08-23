import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const mainSource = readFileSync(resolve("src/main.ts"), "utf8");

test("capture keeps inbox status refresh failures out of the fatal capture catch", () => {
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  assert.match(captureBody, /try\s*\{\s*await this\.refreshInboxStatus\(file, "inbox"\);\s*\}\s*catch \(error\)\s*\{\s*this\.recordIssue\("inbox", error, file\.path\);/su);
  assert.match(captureBody, /new Notice\(`Capture completed, but OMD Home could not mark the note as Inbox: \$\{this\.lastError\}`\);/su);
  assert.match(captureBody, /completed = true;\s*new Notice\("OMD capture complete"\);/su);
});

test("successful Inbox marking clears a stale inbox issue context", () => {
  const refreshBody = extractMethodBody(mainSource, "async refreshInboxStatus(file: TFile, status: \"inbox\" | \"reviewed\"): Promise<void>");
  assert.match(refreshBody, /await this\.app\.fileManager\.processFrontMatter\(/u);
  assert.match(refreshBody, /this\.clearIssue\("inbox"\);/u);
});

test("capture binds the invocation polish flag and gates before OMD capture", () => {
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  const snapshotAt = captureBody.indexOf('createWorkflowSnapshot("capture", this.settings, polish)');
  const gateAt = captureBody.indexOf("await this.runLocalAiGated(");
  const downstreamAt = captureBody.indexOf("this.omdBridge.capture(");
  assert.ok(snapshotAt >= 0 && snapshotAt < gateAt, "capture should snapshot before opening the execution seam");
  assert.ok(gateAt < downstreamAt, "the gate seam should own the downstream capture call");
  assert.match(captureBody, /\(\) => createWorkflowSnapshot\("capture", this\.settings, polish\)/u);
  assert.match(captureBody, /enabled: gatedSnapshot\.enabled/u);
  assert.doesNotMatch(captureBody, /polish\s*\?\s*await this\.runLocalAiGated/u);
});

test("capture cancellation is not persisted as a setup failure and Local AI owns gate errors", () => {
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  assert.match(captureBody, /const cancelled = isAbortError\(error\) \|\|/u);
  assert.match(captureBody, /if \(cancelled\) \{\s*this\.clearIssue\("capture"\);/su);
  assert.match(captureBody, /else if \(error instanceof LocalAiError\)/u);
  assert.match(captureBody, /this\.recordIssue\("ai", error\)/u);
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
