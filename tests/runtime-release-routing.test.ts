import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { isLocalImageSource, isPluginRecordingWrapperCommand, looksCapturable, normalizeCaptureSource, recordingQuickActions } from "../src/omnibox-utils.ts";

type Harness = Record<string, any>;

function loadMethods(file: string, names: string[], dependencies: Record<string, unknown> = {}): Harness {
  const source = ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
  const members = source.statements.flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : []);
  const methods = names.map((name) => {
    const member = members.find((node) => node.name?.getText(source) === name);
    assert.ok(member, `Missing production member ${name}`);
    return member.getText(source);
  });
  const compiled = ts.transpileModule(`class Harness { ${methods.join("\n")} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn new Harness();`)(...Object.values(dependencies));
}

test("omnibox captures normalized multilingual PDF paths and file URLs instead of searching them", async () => {
  for (const [input, expected] of [
    ['"/Users/example/研究 计划.pdf"', "/Users/example/研究 计划.pdf"],
    ["file:///Users/example/%E7%A0%94%E7%A9%B6%20%E8%AE%A1%E5%88%92.pdf", "/Users/example/研究 计划.pdf"],
    ["'https://example.com/%E7%A0%94%E7%A9%B6'", "https://example.com/%E7%A0%94%E7%A9%B6"],
    ["/Users/example/研究\\ 计划.pdf", "/Users/example/研究 计划.pdf"],
    ["https://example.com/image.png?download=1", "https://example.com/image.png?download=1"],
  ]) {
    const captured: string[] = [];
    const box = loadMethods("src/omnibox.ts", ["execute"], {
      isLocalImageSource, looksCapturable,
      normalizeCaptureSource,
      captureRequestFromSettings: (source: string) => source,
    });
    Object.assign(box, {
      previewTimer: null,
      input: { value: input },
      beginSubmission() {},
      searchVault() { assert.fail(`Capture input routed to search: ${input}`); },
      plugin: { settings: {}, captureWithOmd: async (source: string) => { captured.push(source); } },
    });
    await box.execute();
    assert.deepEqual(captured, [expected]);
  }
});

test("recognition does not turn ordinary multilingual search terms into captures", () => {
  for (const input of ["稠密向量与稀疏向量", "résumé notes", "C++ resources"]) {
    assert.equal(looksCapturable(input), false);
  }
});

test("an unavailable command explains why it did not run", async () => {
  const notices: string[] = [];
  const box = loadMethods("src/omnibox.ts", ["execute"], {
    looksCapturable,
    Notice: class { constructor(value: string) { notices.push(value); } },
  });
  Object.assign(box, {
    previewTimer: null,
    input: { value: ">unavailable" },
    beginSubmission() {},
    commands: {
      listCommands: () => [{ id: "command:unavailable", name: "Unavailable command" }],
      executeCommandById: () => false,
    },
  });
  await box.execute();
  assert.deepEqual(notices, ["This command is unavailable in the current view."]);
});

test("omnibox offers working start and stop controls for the native recorder without an unavailable toggle", () => {
  const commands = [
    { id: "audio-recorder:start", name: "开始录音" },
    { id: "audio-recorder:stop", name: "停止录音" },
  ];
  const clicks: string[] = [];
  const actions: { label: string; run: () => void }[] = [];
  const box = loadMethods("src/omnibox.ts", ["renderQuickActions"], { recordingQuickActions, isPluginRecordingWrapperCommand });
  Object.assign(box, {
    commands: { listCommands: () => commands },
    actionBar: { empty() { actions.length = 0; } },
    quickAction(_container: unknown, _icon: string, label: string, run: () => void) { actions.push({ label, run }); },
    plugin: {
      manifest: { id: "omd-home" },
      startRecording: () => clicks.push("start"),
      stopRecording: () => clicks.push("stop"),
      toggleRecording: () => assert.fail("The core recorder has no toggle command"),
    },
  });
  box.renderQuickActions();
  actions.find((action) => action.label === "Start recording")?.run();
  actions.find((action) => action.label === "Stop recording")?.run();
  assert.deepEqual(clicks, ["start", "stop"]);
  assert.equal(actions.some((action) => action.label === "Recording"), false);
});

test("search displays pending work and keeps an actionable failure in its result panel", async () => {
  let rejectSearch!: (error: Error) => void;
  const pending = new Promise<never>((_resolve, reject) => { rejectSearch = reject; });
  const notices: string[] = [];
  const text: string[] = [];
  const plugin = loadMethods("src/main.ts", ["searchWithOmd"], {
    Notice: class { constructor(value: string) { notices.push(value); } },
    message: (error: Error) => error.message,
    isAbortError: (error: Error) => error.name === "AbortError",
  });
  Object.assign(plugin, {
    requireReadyOmdExecutable: async () => {},
    vaultPath: () => "/vault",
    omdBridge: { search: async () => pending },
  });
  const output = {
    hidden: true,
    empty() { text.length = 0; },
    createDiv(options: { text: string }) { text.push(options.text); },
  };
  const searching = plugin.searchWithOmd("查找研究资料", output);
  assert.equal(output.hidden, false);
  assert.deepEqual(text, ["Searching your vault…"]);
  rejectSearch(new Error("OMD is unavailable. Check OMD setup in settings."));
  await searching;
  assert.deepEqual(text, ["OMD is unavailable. Check OMD setup in settings."]);
  assert.deepEqual(notices, text);
});

test("enrichment phase is exposed separately from the workflow lock", () => {
  const controller = loadMethods("src/enrichment/controller.ts", ["phase", "canCancel"]);
  controller.active = { state: { phase: "review" } };
  assert.equal(controller.phase, "review");
  assert.equal(controller.canCancel, false);
  controller.active = { state: { phase: "generating" } };
  assert.equal(controller.canCancel, true);
  controller.active = { state: { phase: "applying" } };
  assert.equal(controller.phase, "applying");
  assert.equal(controller.canCancel, false);
  controller.active = null;
  assert.equal(controller.phase, null);

  const plugin = loadMethods("src/main.ts", ["enrichmentPhase"]);
  plugin.enrichmentWorkflowController = { phase: "review" };
  assert.equal(plugin.enrichmentPhase, "review");
});


test("pasted local images open recognition options before any capture starts", async () => {
  for (const input of [
    '/Users/example/中文 图片.png',
    '"/Users/example/中文 图片.PNG"',
    'file:///Users/example/%E4%B8%AD%E6%96%87%20%E5%9B%BE%E7%89%87.png',
    '~/Pictures/中文 图片.jpeg',
    '/Users/example/a#b.webp',
    '/Users/example/picture.tiff',
    '/Users/example/picture.bmp',
  ]) {
    const opened: string[] = [];
    const box = loadMethods("src/omnibox.ts", ["execute"], {
      isLocalImageSource, looksCapturable, normalizeCaptureSource,
      captureRequestFromSettings: (source: string) => source,
    });
    Object.assign(box, {
      previewTimer: null, input: { value: input }, beginSubmission() {},
      plugin: {
        settings: {},
        openCaptureModal: (source: string) => { opened.push(source); },
        captureWithOmd: async () => { assert.fail("Image capture bypassed recognition options"); },
      },
    });
    await box.execute();
    assert.deepEqual(opened, [normalizeCaptureSource(input)]);
  }
});
