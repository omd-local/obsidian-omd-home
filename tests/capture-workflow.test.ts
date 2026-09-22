import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const mainSource = readFileSync(resolve("src/main.ts"), "utf8");
const modalSource = readFileSync(resolve("src/modals.ts"), "utf8");
const omniboxSource = readFileSync(resolve("src/omnibox.ts"), "utf8");
const stylesSource = readFileSync(resolve("src/styles.css"), "utf8");

test("capture only reports terminal success after the generated note enters Inbox", () => {
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  assert.match(captureBody, /if \(!shouldSurfaceCaptureEvent\(event\)\) return;/u);
  assert.match(captureBody, /await this\.refreshCapturedInboxStatus\(inspection\.normalizedPath\);[\s\S]*const indexedFile = this\.app\.vault\.getFileByPath\(inspection\.normalizedPath\);/u);
  assert.match(captureBody, /await this\.refreshCapturedInboxStatus\(inspection\.normalizedPath\);\s*inboxReady = true;/u);
  assert.match(captureBody, /capturedFile = indexedFile instanceof TFile \? indexedFile : null;/u);
  assert.match(captureBody, /catch \(error\)\s*\{\s*completionWarningShown = true;\s*this\.recordIssue\("inbox", error, inspection\.normalizedPath\);/su);
  assert.match(captureBody, /event: "error",[\s\S]*kind: "inbox_failed"/u);
  assert.match(captureBody, /new Notice\(`Capture completed, but OMD Home could not mark the note as Inbox: \$\{this\.lastError\}`\);/su);
  assert.match(captureBody, /if \(inboxReady\) \{[\s\S]*captureWorkflowDoneEvent\(vaultRelative\)[\s\S]*if \(!completionWarningShown\) new Notice\("OMD capture complete"\);/u);
  assert.match(captureBody, /OMD reported completion, but the generated vault note could not be verified/u);
  assert.match(captureBody, /OMD reported completion, but its generated Markdown file was missing or failed the vault safety check/u);
});

test("capture does not misreport a verified disk file as a failed output path while indexing catches up", () => {
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  const fallbackBody = extractMethodBody(mainSource, "async refreshCapturedInboxStatus(path: string): Promise<void>");
  assert.match(captureBody, /inspection\.ok && inspection\.normalizedPath/u);
  assert.match(fallbackBody, /await waitForCapturedVaultFile\(path,/u);
  assert.match(fallbackBody, /this\.app\.vault\.process\(indexedFile, \(content\) => setOmdHomeStatusInMarkdown\(content, "inbox"\)\)/u);
  assert.match(fallbackBody, /this\.app\.vault\.adapter\.process\(path, \(content\) => setOmdHomeStatusInMarkdown\(content, "inbox"\)\)/u);
  assert.match(fallbackBody, /setOmdHomeStatusInMarkdown\(written, "inbox"\) !== written/u);
  assert.doesNotMatch(captureBody, /its output path could not be verified/u);
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
  assert.match(captureBody, /if \(!cancelled && error instanceof LocalAiError\)/u);
  assert.match(captureBody, /this\.recordIssue\("ai", error\)/u);
  assert.match(captureBody, /if \(!cancelled\) \{\s*const failure = createCaptureFailureRecord/su);
});

test("capture failure publishes its terminal state only after Current task is idle", () => {
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  assert.match(
    captureBody,
    /new Notice\(detail\);\s*\} finally \{\s*this\.captureActive = false;\s*this\.captureCancelable = false;[\s\S]*this\.refreshHomeViews\(\);/u,
  );
  assert.doesNotMatch(
    captureBody,
    /new Notice\(detail\);\s*this\.refreshHomeViews\(\);\s*\} finally/u,
  );
});

test("capture snapshots the full typed request and retains it only for retryable failures", () => {
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  assert.match(captureBody, /const captureRequest = createCaptureRequest\(request\)/u);
  assert.match(captureBody, /createCaptureFailureRecord\([\s\S]*issueId,[\s\S]*issueContext,[\s\S]*this\.lastErrorAt,[\s\S]*this\.lastError,[\s\S]*captureRequest/u);
  assert.match(captureBody, /this\.lastCaptureFailure = failure/u);
});

test("capture executes the exact absolute executable that passed preflight", () => {
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  const requireBody = extractMethodBody(mainSource, "async requireCaptureOmdExecutable(");
  const bridgeBody = extractMethodBody(readFileSync(resolve("src/omd-bridge.ts"), "utf8"), "async capture(");
  assert.match(captureBody, /const executable = await this\.requireCaptureOmdExecutable\(captureRequest, captureController\.signal\)/u);
  assert.match(captureBody, /this\.omdBridge\.capture\(\s*executable,\s*captureRequest,/su);
  assert.match(requireBody, /return result\.executable;/u);
  assert.doesNotMatch(
    requireBody,
    /this\.discoveredOmdExecutable\s*=/u,
    "a capture-compatible legacy binary must not replace the enrichment-capable OMD path",
  );
  assert.doesNotMatch(bridgeBody, /this\.omdExecutable\(\)/u);
  assert.match(bridgeBody, /this\.spawnManagedProcess\(\s*executable,/su);
});

test("capture cancellation spans discovery, Local AI gating, and bridge execution", () => {
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  const requireBody = extractMethodBody(mainSource, "async requireCaptureOmdExecutable(");
  const cancelBody = extractMethodBody(mainSource, "cancelActiveOmd(): void");
  assert.match(captureBody, /const captureController = new AbortController\(\)/u);
  assert.match(captureBody, /this\.captureController = captureController/u);
  assert.match(captureBody, /this\.captureCancelable = true/u);
  assert.match(requireBody, /requireCaptureLanguages\(executable, request, signal\)/u);
  assert.match(requireBody, /probeOmdCaptureExecutable\(executable, signal\)/u);
  assert.match(captureBody, /this\.runLocalAiGated\([\s\S]*captureController\.signal/su);
  assert.match(captureBody, /this\.omdBridge\.capture\([\s\S]*captureController\.signal/su);
  assert.match(captureBody, /captureController\.signal\.throwIfAborted\(\);[\s\S]*this\.captureCancelable = false;[\s\S]*this\.captureController = null;/u);
  assert.ok(
    captureBody.indexOf("captureController.signal.throwIfAborted();") < captureBody.indexOf("completed = true;"),
    "an abort requested before bridge completion must stop success and follow-up work",
  );
  assert.match(cancelBody, /this\.captureController\?\.abort\(\)/u);
  assert.match(cancelBody, /this\.captureCancelable && this\.captureController/u);
  assert.doesNotMatch(cancelBody, /cancelLocalAiRequests|omdBridge\.cancelActive/u);
});

test("shared cancellation follows phase-specific capture and enrichment boundaries", () => {
  const cancelBody = extractMethodBody(mainSource, "cancelActiveOmd(): void");
  const cancellableBody = extractMethodBody(mainSource, "get enrichmentCancelable(): boolean");
  assert.match(cancellableBody, /this\.enrichmentWorkflowController\?\.canCancel/u);
  assert.match(cancelBody, /if \(this\.enrichmentCancelable\)/u);
  assert.doesNotMatch(cancelBody, /if \(this\.enrichmentActive\) \{\s*cancelled = this\.enrichmentWorkflowController\.cancel/u);
  assert.match(cancelBody, /OMD is applying changes and cannot be cancelled\./u);
});

test("retry survives unrelated issue replacement and only clears the issue owned by its successful attempt", () => {
  const retryBody = extractMethodBody(mainSource, "retryFailedCapture(failureId: number): void");
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  const currentBody = extractMethodBody(mainSource, "currentCaptureFailure(): CaptureFailureRecord | null");
  const matchingBody = extractMethodBody(mainSource, "captureFailureForCurrentIssue(): CaptureFailureRecord | null");
  assert.doesNotMatch(retryBody, /lastIssueId/u);
  assert.doesNotMatch(retryBody, /resetEnrichmentCapability/u);
  assert.match(retryBody, /this\.openCaptureModal\(failure\.request, failure\.id\)/u);
  assert.match(currentBody, /return this\.lastCaptureFailure/u);
  assert.match(matchingBody, /captureFailureForIssue\(this\.lastCaptureFailure, this\.lastIssueId\)/u);
  assert.match(captureBody, /if \(retryFailure\) this\.resetEnrichmentCapability\(true\);/u);
  assert.match(captureBody, /this\.clearIssueById\(retryFailure\.issueId\)/u);
  assert.match(captureBody, /this\.lastCaptureFailure\?\.id === retryFailure\.id/u);
});

test("modal and omnibox build requests from vault defaults while capture choices have one clear owner", () => {
  const openModalBody = extractMethodBody(mainSource, "openCaptureModal(initialSource:");
  assert.match(mainSource, /captureRequestFromSettings\(initialSource, this\.settings\)/u);
  assert.match(omniboxSource, /captureRequestFromSettings\(source, this\.plugin\.settings\)/u);
  assert.match(modalSource, /this\.modalEl\.addClass\("omd-capture-modal"\)/u);
  assert.match(modalSource, /summary", \{ text: "Recognition \(optional\)" \}/u);
  assert.match(modalSource, /setName\("Image text language"\)/u);
  assert.match(modalSource, /setName\("Speech language"\)/u);
  assert.match(modalSource, /No language preference/u);
  assert.match(modalSource, /does not translate/iu);
  assert.match(modalSource, /does not translate[^"\n]*(?:scanned.*PDF|PDF.*scanned)/iu);
  assert.match(modalSource, /apply[^"\n]*this capture only/iu);
  assert.match(modalSource, /setName\("Optional local AI"\)\.setHeading\(\)/u);
  assert.match(modalSource, /setName\("Polish Markdown"\)/u);
  assert.match(modalSource, /setName\("Review links and tags"\)/u);
  assert.match(modalSource, /choices[^"\n]*remembered[^"\n]*capture/iu);
  assert.doesNotMatch(modalSource, /Inherit OMD|Inherit adapter default|Use OMD default|Use adapter default/u);
  assert.match(mainSource, /will be validated against the detected OMD build when you press Capture/iu);
  assert.match(modalSource, /languageAvailability\.status === "unsupported"/u);
  assert.match(modalSource, /Saved custom language:/u);
  assert.match(mainSource, /ocrPresets: acceptsHomeOcrArgument\s*\? filterReadyOcrPresets/su);
  assert.doesNotMatch(mainSource, /installed_packs\.slice\(0, 12\)\.join/u);
  assert.match(modalSource, /captureLanguageSelectionError\(request, this\.languageAvailability\)/u);
  assert.match(modalSource, /value === "__vault_custom__" && this\.vaultCustomOcrLanguage/u);
  assert.doesNotMatch(modalSource, /Custom language packs…|setName\("Custom image recognition language packs"\)/u);
  assert.doesNotMatch(modalSource, /onOcrChange|onAsrChange/u);
  assert.doesNotMatch(modalSource, /onPolishChange|onSuggestChange/u);
  assert.match(openModalBody, /async \(request\) => \{[\s\S]*this\.settings\.capturePolish = request\.polish;[\s\S]*this\.settings\.captureSuggestLinksAndTags = request\.suggest;[\s\S]*try \{[\s\S]*await this\.saveSettings\(\);[\s\S]*\} catch[\s\S]*Capture will continue[\s\S]*await this\.captureWithOmd\(request, retryFailureId, true\);/u);
});

test("capture fields share one modal-scoped vertical rhythm", () => {
  assert.match(
    stylesSource,
    /\.omd-capture-modal\s*\{[^}]*--omd-capture-field-block:\s*var\(--size-4-3,\s*12px\);[^}]*--omd-capture-control-gap:\s*var\(--size-4-2,\s*8px\);[^}]*--omd-capture-section-gap:\s*var\(--size-4-4,\s*16px\);/su,
  );
  assert.match(
    stylesSource,
    /\.omd-capture-modal :is\([\s\S]*\.omd-capture-source-setting,[\s\S]*\.omd-capture-tags-setting,[\s\S]*\.omd-capture-recognition > \.setting-item,[\s\S]*\.omd-capture-ai > \.setting-item:not\(\.setting-item-heading\)[\s\S]*\)\s*\{[^}]*gap:\s*var\(--omd-capture-control-gap\);[^}]*padding-block:\s*var\(--omd-capture-field-block\);/su,
  );
  assert.match(
    stylesSource,
    /\.omd-capture-recognition,\s*\.omd-capture-ai\s*\{[^}]*margin:\s*var\(--omd-capture-section-gap\) 0;/su,
  );
  assert.match(
    stylesSource,
    /\.omd-capture-modal \.omd-modal-actions\s*\{[^}]*padding-top:\s*var\(--omd-capture-field-block\);/su,
  );
  assert.match(
    stylesSource,
    /\.modal\.omd-capture-modal :is\(\.omd-capture-recognition, \.omd-capture-ai\)\s*> \.setting-item:not\(\.setting-item-heading\):last-child\s*\{[^}]*padding-block-end:\s*var\(--omd-capture-field-block\);/su,
  );
});

test("a busy Capture is rejected before it can alter preferences or interrupt Local AI", () => {
  const openModalBody = extractMethodBody(mainSource, "openCaptureModal(initialSource:");
  const callbackAt = openModalBody.indexOf("async (request) => {");
  const callbackBody = openModalBody.slice(callbackAt);
  const busyGuardAt = callbackBody.indexOf("if (this.captureActive || this.enrichmentActive)");
  const claimAt = callbackBody.indexOf("this.captureActive = true;");
  const polishAt = callbackBody.indexOf("this.settings.capturePolish = request.polish;");
  const suggestAt = callbackBody.indexOf("this.settings.captureSuggestLinksAndTags = request.suggest;");
  const invalidateAt = callbackBody.indexOf('this.invalidateLocalAiState("capture-polish");');
  const saveAt = callbackBody.indexOf("await this.saveSettings();");

  assert.ok(busyGuardAt >= 0, "the modal submit callback must guard busy work");
  assert.ok(claimAt > busyGuardAt, "the accepted submission must claim capture synchronously");
  for (const [label, index] of [
    ["polish preference", polishAt],
    ["suggestion preference", suggestAt],
    ["Local AI invalidation", invalidateAt],
    ["settings persistence", saveAt],
  ] as const) {
    assert.ok(index > busyGuardAt, `${label} must stay after the busy guard`);
  }
  assert.match(openModalBody, /^\{\s*if \(this\.captureActive \|\| this\.enrichmentActive\) \{/u);
  assert.match(openModalBody, /await this\.captureWithOmd\(request, retryFailureId, true\);/u);
});

test("a modal submission claims capture while choices are being saved, so direct captures cannot overtake it", () => {
  const openModalBody = extractMethodBody(mainSource, "openCaptureModal(initialSource:");
  const captureBody = extractMethodBody(mainSource, "async captureWithOmd(");
  assert.match(openModalBody, /this\.captureActive = true;[\s\S]*await this\.saveSettings\(\);/u);
  assert.match(mainSource, /captureAlreadyClaimed = false/u);
  assert.match(captureBody, /if \(\(this\.captureActive && !captureAlreadyClaimed\) \|\| this\.enrichmentActive\)/u);
  assert.match(openModalBody, /finally \{[\s\S]*if \(this\.captureActive && !this\.captureController\) \{/u);
});

test("capture modal and Home omnibox share modern Electron drop-path resolution", () => {
  assert.match(modalSource, /captureSourceFromDataTransfer\(event\.dataTransfer\)/u);
  assert.match(omniboxSource, /captureSourceFromDataTransfer\(event\.dataTransfer\)/u);
  assert.doesNotMatch(modalSource, /"path" in file/u);
  assert.doesNotMatch(omniboxSource, /"path" in file/u);
});

test("inherited recognition probes the legacy capture command instead of requiring version metadata", () => {
  const probeBody = extractMethodBody(mainSource, "async function probeOmdCaptureExecutable(");
  assert.match(probeBody, /spawnProcess\(executable, \["capture", "--help"\]/u);
  assert.doesNotMatch(probeBody, /\["--version"\]/u);
});

test("successful setup keeps the resolved executable and optional package identity", () => {
  const checkBody = extractMethodBody(mainSource, "private async runOmdCapabilityCheck(");
  assert.match(checkBody, /const detectedCapabilities = await this\.omdCapabilityService\.requireEnrichNote\(result\.executable\)/u);
  assert.match(checkBody, /resolvedExecutable: result\.executable/u);
  assert.match(checkBody, /this\.discoveredOmdExecutable = result\.executable;/u);
  assert.match(checkBody, /packageVersion: detectedCapabilities\.package_version/u);
  assert.match(checkBody, /protocolVersion: detectedCapabilities\.protocol_version/u);
  assert.match(checkBody, /buildRevision: detectedCapabilities\.build_revision/u);
  assert.match(checkBody, /omdReadyMessage\(result\.executable, result\.mode, detectedCapabilities\)/u);
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
