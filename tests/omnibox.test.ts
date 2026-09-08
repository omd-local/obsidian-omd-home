import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";
import {
  captureSourceFromDataTransfer,
  captureSourceFromDrop,
  isPluginRecordingWrapperCommand,
  isRecordingToggleCommandName,
  looksCapturable,
  normalizeCaptureSource,
  recordingCommandKind,
  recordingQuickActions,
  safeFileName,
} from "../src/omnibox-utils.ts";

test("detects capturable omnibox inputs", () => {
  assert.equal(looksCapturable("https://example.com"), true);
  assert.equal(looksCapturable("/Users/example/file.pdf"), true);
  assert.equal(looksCapturable("~/Downloads/file.pdf"), true);
  assert.equal(looksCapturable("meeting notes"), false);
});

test("sanitizes generated quick note names", () => {
  assert.equal(safeFileName("Plan: sprint/review?"), "Plan- sprint-review-");
  assert.equal(safeFileName("   "), "Quick note");
});

test("normalizes pasted local paths without invoking a shell", () => {
  assert.equal(
    normalizeCaptureSource("~/Desktop/survival analysis.pdf"),
    `${homedir()}/Desktop/survival analysis.pdf`,
  );
  assert.equal(
    normalizeCaptureSource("/Users/example/data\\ science/survival\\ analysis.pdf"),
    "/Users/example/data science/survival analysis.pdf",
  );
  assert.equal(
    normalizeCaptureSource("'/Users/example/My File.pdf'"),
    "/Users/example/My File.pdf",
  );
  assert.equal(
    normalizeCaptureSource("file:///Users/example/My%20File.pdf"),
    "/Users/example/My File.pdf",
  );
  assert.equal(normalizeCaptureSource("https://example.com/a\\ b"), "https://example.com/a\\ b");
});

test("dragged files fall back from Electron paths to file URL data", () => {
  assert.equal(
    captureSourceFromDrop("/Users/example/File.pdf", "", ""),
    "/Users/example/File.pdf",
  );
  assert.equal(
    captureSourceFromDrop("", "# Finder\nfile:///Users/example/My%20File.pdf\n", ""),
    "/Users/example/My File.pdf",
  );
  assert.equal(captureSourceFromDrop("", "", "ordinary text"), "");
});

test("modern Electron drops resolve images and PDFs through webUtils when File.path is absent", () => {
  for (const name of ["IMG_9229.PNG", "Research Paper.pdf"]) {
    const file = { name } as File;
    const expectedPath = `/Users/example/Downloads/${name}`;
    const dataTransfer = {
      files: [file],
      getData: () => "",
    } as unknown as DataTransfer;

    assert.equal(
      captureSourceFromDataTransfer(
        dataTransfer,
        {
          getPathForFile: (droppedFile) => droppedFile === file ? expectedPath : "",
        },
      ),
      expectedPath,
    );
  }
});

test("recording shortcut only accepts Obsidian recorder toggle names", () => {
  assert.equal(isRecordingToggleCommandName("Start/stop recording"), true);
  assert.equal(isRecordingToggleCommandName("Start/stop audio recording"), true);
  assert.equal(isRecordingToggleCommandName("Open recordings folder"), false);
  assert.equal(isRecordingToggleCommandName("Export recording metadata"), false);
  assert.equal(recordingCommandKind("audio-recorder:start", "Start recording audio"), "start");
  assert.equal(recordingCommandKind("audio-recorder:stop", "Stop recording audio"), "stop");
  assert.equal(recordingCommandKind("third-party:recording", "Start/stop recording"), "toggle");
  assert.equal(recordingCommandKind("third-party:recordings", "Open recordings folder"), null);
});

test("recording dispatch can exclude OMD Home wrapper commands", () => {
  assert.equal(isPluginRecordingWrapperCommand("omd-home:toggle-recording", "omd-home"), true);
  assert.equal(isPluginRecordingWrapperCommand("omd-home:start-recording", "omd-home"), true);
  assert.equal(isPluginRecordingWrapperCommand("omd-home:stop-recording", "omd-home"), true);
  assert.equal(isPluginRecordingWrapperCommand("audio-recorder:start", "omd-home"), false);
});

test("recording quick actions prefer an exact toggle command when available", () => {
  assert.deepEqual(
    recordingQuickActions([
      { id: "audio-recorder:start", name: "Start recording audio" },
      { id: "audio-recorder:stop", name: "Stop recording audio" },
      { id: "core:recording-toggle", name: "Start/stop recording" },
    ]),
    [{ id: "core:recording-toggle", label: "Recording", icon: "mic" }],
  );
});

test("recording quick actions expose explicit start and stop actions when no toggle exists", () => {
  assert.deepEqual(
    recordingQuickActions([
      { id: "audio-recorder:start", name: "Start recording audio" },
      { id: "audio-recorder:stop", name: "Stop recording audio" },
      { id: "third-party:recordings", name: "Open recordings folder" },
    ]),
    [
      { id: "audio-recorder:start", label: "Start recording", icon: "mic" },
      { id: "audio-recorder:stop", label: "Stop recording", icon: "square" },
    ],
  );
});

test("recording quick actions keep a single explicit action when Obsidian exposes only one recorder state", () => {
  assert.deepEqual(
    recordingQuickActions([
      { id: "audio-recorder:start", name: "Start recording audio" },
    ]),
    [{ id: "audio-recorder:start", label: "Start recording", icon: "mic" }],
  );
  assert.deepEqual(
    recordingQuickActions([
      { id: "audio-recorder:stop", name: "Stop recording audio" },
    ]),
    [{ id: "audio-recorder:stop", label: "Stop recording", icon: "square" }],
  );
});
