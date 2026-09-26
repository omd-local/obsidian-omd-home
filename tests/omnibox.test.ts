import assert from "node:assert/strict";
import { homedir } from "node:os";
import test from "node:test";
import {
  MAX_CAPTURE_SOURCE_INPUT_CHARS,
  captureSourceFromDataTransfer,
  captureSourceFromDrop,
  localAccessPathError,
  normalizeLocalAccessPath,
  parseCaptureSourceInput,
  isXhsShortlinkSource,
  isPluginRecordingWrapperCommand,
  isRecordingToggleCommandName,
  looksCapturable,
  normalizeCaptureSource,
  recordingCommandKind,
  recordingQuickActions,
  safeFileName,
  socialCaptureProvider,
} from "../src/omnibox-utils.ts";

test("detects capturable omnibox inputs", () => {
  assert.equal(looksCapturable("https://example.com"), true);
  assert.equal(looksCapturable("open ftp://example.com/file"), true);
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

test("extracts one supported social URL from common pasted share text", () => {
  const douyin = "9.74 hoD:/ w@S.YZ :9pm 08/06 9.17 深度理解沃什在议息会议后的发言 # 沃什 # 美联储议息会议 # 预期管理 # 美元 # 黄金 https://v.douyin.com/t6DOaFdc39Q/ 复制此链接，打开Dou音搜索，直接观看视频！";
  assert.deepEqual(parseCaptureSourceInput(douyin), {
    source: "https://v.douyin.com/t6DOaFdc39Q/",
    submittedSource: douyin,
  });

  const xhs = "32 复制本条信息，打开【小红书】App查看精彩内容！http://xhslink.com/a/abcDEF/";
  assert.deepEqual(parseCaptureSourceInput(xhs), {
    source: "http://xhslink.com/a/abcDEF/",
    submittedSource: xhs,
  });
});

test("share text rejects generic, multiple, non-HTTP, null, and overlong inputs deterministically", () => {
  assert.throws(
    () => parseCaptureSourceInput("read this https://example.com/article"),
    /Paste other web links by themselves/u,
  );
  assert.throws(
    () => parseCaptureSourceInput("https://v.douyin.com/one https://xhslink.com/two"),
    /more than one HTTP\(S\) URL/u,
  );
  assert.throws(() => parseCaptureSourceInput("open ftp://example.com/file"), /Only HTTP\(S\)/u);
  assert.throws(() => parseCaptureSourceInput("https://v.douyin.com/a\0tail"), /null character/u);
  assert.throws(() => parseCaptureSourceInput("x".repeat(MAX_CAPTURE_SOURCE_INPUT_CHARS + 1)), /too long/u);
});

test("social host matching accepts exact subdomains and rejects lookalikes", () => {
  assert.equal(socialCaptureProvider("https://douyin.com/video/1"), "douyin");
  assert.equal(socialCaptureProvider("https://v.douyin.com/a"), "douyin");
  assert.equal(socialCaptureProvider("https://www.iesdouyin.com/share/video/1"), "douyin");
  assert.equal(socialCaptureProvider("https://www.xiaohongshu.com/explore/1"), "xhs");
  assert.equal(socialCaptureProvider("https://xhslink.com/a/1"), "xhs");
  assert.equal(socialCaptureProvider("https://rednote.com/post/1"), "xhs");
  assert.equal(socialCaptureProvider("https://douyin.com.evil.example/a"), null);
  assert.equal(socialCaptureProvider("https://evilxiaohongshu.com/a"), null);
  assert.equal(socialCaptureProvider("javascript:https://douyin.com/a"), null);
  assert.equal(isXhsShortlinkSource("https://xhslink.com/a/1"), true);
  assert.equal(isXhsShortlinkSource("https://sub.xhslink.com/a/1"), true);
  assert.equal(isXhsShortlinkSource("https://xhslink.com.evil.example/a"), false);
  assert.equal(isXhsShortlinkSource("https://www.xiaohongshu.com/explore/1"), false);
});

test("local cookie paths preserve spaces and Unicode while rejecting unsafe values", () => {
  assert.equal(
    normalizeLocalAccessPath("  '/Users/test/社交 访问/小红书 cookies.txt'  "),
    "/Users/test/社交 访问/小红书 cookies.txt",
  );
  assert.equal(localAccessPathError("relative/cookies.txt"), "Choose an absolute local cookies.txt path.");
  assert.match(localAccessPathError("/tmp/a\0cookies.txt") ?? "", /null character/u);
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
