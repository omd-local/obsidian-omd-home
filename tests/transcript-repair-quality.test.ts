import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OmdBridge } from "../src/omd-bridge.ts";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

test("range repair preserves auto detection and normalizes quality-gated bridge results", async () => {
  const bridge = new OmdBridge(() => "omd", () => "python3", () => "");
  const managedBridge = bridge as unknown as {
    callPythonBridge: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  const sentRequests: Array<Record<string, unknown>> = [];
  managedBridge.callPythonBridge = async (request) => {
    sentRequests.push(request);
    return {
      transcript: {
        segments: [{ start: 12, end: 15, text: "Recovered text." }],
        language: "mixed",
        chunk_languages: ["en", "zh"],
        quality_warnings: ["Whisper produced repeated text."],
        suspect_intervals: [{
          start: 30,
          end: 55,
          reasons: ["Whisper produced repeated text."],
        }],
        safe_to_apply: false,
        context_start_seconds: 4,
        context_end_seconds: 63,
      },
    };
  };

  const result = await bridge.retranscribeTranscriptRange(
    { vaultPath: "/vault", configDir: ".obsidian", sessionId: "session" },
    "/vault/.obsidian/plugins/omd-home/transcript-repair-cache/session/source.m4a",
    12,
    55,
    null,
  );

  const sentRequest = sentRequests[0];
  assert.ok(sentRequest);
  assert.equal(sentRequest.language, null, "auto repair must not reuse the earlier detected language");
  assert.equal(sentRequest.chunk_seconds, 25);
  assert.deepEqual(result.chunkLanguages, ["en", "zh"]);
  assert.deepEqual(result.qualityWarnings, ["Whisper produced repeated text."]);
  assert.equal(result.safeToApply, false);
  assert.deepEqual(result.suspectIntervals, [{
    startSeconds: 30,
    endSeconds: 55,
    reasons: ["Whisper produced repeated text."],
  }]);
});

test("Python range repair transcribes bounded chunks and reports suspect intervals", () => {
  const code = [
    "import json, shutil, sys, tempfile, types",
    "from pathlib import Path",
    "import bridge.omd_home_bridge as bridge",
    "root = Path(tempfile.mkdtemp(prefix='omd-home-chunked-range-'))",
    "try:",
    "    (root / '.obsidian').mkdir()",
    "    request = {'vault': str(root), 'config_dir': '.obsidian', 'session_id': 'safe-session'}",
    "    cache = bridge._repair_cache_directory(request, create=True)",
    "    media = cache / 'source.m4a'",
    "    media.write_bytes(b'media')",
    "    omd = types.ModuleType('omd')",
    "    omd.__path__ = []",
    "    audio = types.ModuleType('omd._audio')",
    "    audio.duration_seconds = lambda path: 70.0",
    "    reel = types.ModuleType('omd.reel')",
    "    reel.DEFAULT_MODEL = 'test-model'",
    "    calls = []",
    "    languages = ['en', 'zh', 'en']",
    "    def transcribe(path, workdir, model, language):",
    "        index = int(path.stem.rsplit('-', 1)[-1])",
    "        calls.append({'name': path.name, 'language': language})",
    "        warning = ['Whisper produced repeated text.'] if index == 1 else []",
    "        return {'language': languages[index], 'text': f'chunk {index}', 'quality_warnings': warning, 'segments': [",
    "            {'start': 9, 'end': 11, 'text': f'chunk {index}', 'compression_ratio': 1.0, 'avg_logprob': -0.2},",
    "        ]}",
    "    reel.transcribe = transcribe",
    "    sys.modules['omd'] = omd",
    "    sys.modules['omd._audio'] = audio",
    "    sys.modules['omd.reel'] = reel",
    "    clips = []",
    "    def clip(source, output, start, end):",
    "        clips.append([round(start, 3), round(end, 3)])",
    "        output.write_bytes(b'clip')",
    "    bridge._clip_repair_audio = clip",
    "    result = bridge._retranscribe_transcript_range({**request, 'media_path': str(media), 'start_seconds': 5, 'end_seconds': 65, 'context_seconds': 8, 'chunk_seconds': 25, 'language': None})",
    "    print(json.dumps({'result': result, 'calls': calls, 'clips': clips}, sort_keys=True))",
    "finally:",
    "    shutil.rmtree(root, ignore_errors=True)",
  ].join("\n");
  const execution = spawnSync("python3", ["-c", code], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  assert.equal(execution.status, 0, execution.stderr);
  const value = JSON.parse(execution.stdout) as {
    result: {
      segments: Array<{ start: number; end: number; text: string }>;
      chunk_languages: string[];
      quality_warnings: string[];
      suspect_intervals: Array<{ start: number; end: number; reasons: string[] }>;
      safe_to_apply: boolean;
      language: string;
    };
    calls: Array<{ name: string; language: string | null }>;
    clips: number[][];
  };

  assert.deepEqual(value.calls, [
    { name: "selected-range-000.wav", language: null },
    { name: "selected-range-001.wav", language: null },
    { name: "selected-range-002.wav", language: null },
  ]);
  assert.deepEqual(value.clips, [[0, 38], [22, 63], [47, 70]]);
  assert.deepEqual(value.result.segments, [
    { start: 9, end: 11, text: "chunk 0" },
    { start: 31, end: 33, text: "chunk 1" },
    { start: 56, end: 58, text: "chunk 2" },
  ]);
  assert.deepEqual(value.result.chunk_languages, ["en", "zh", "en"]);
  assert.equal(value.result.language, "mixed");
  assert.deepEqual(value.result.quality_warnings, ["Whisper produced repeated text."]);
  assert.deepEqual(value.result.suspect_intervals, [{
    start: 30,
    end: 55,
    reasons: ["Whisper produced repeated text."],
  }]);
  assert.equal(value.result.safe_to_apply, false);
});

test("repair UI exposes language retry and blocks suspect previews from replacement", () => {
  const modal = readFileSync(new URL("../src/transcript-repair-modal.ts", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(modal, /Recognition language/u);
  assert.match(modal, /Auto-detect per chunk/u);
  assert.match(modal, /Retry with selected language/u);
  assert.match(modal, /qualityWarnings\.length/u);
  assert.match(modal, /is-suspect/u);
  assert.match(styles, /omd-transcript-repair-language/u);
  assert.match(styles, /omd-transcript-repair-preview-line\.is-suspect/u);
  assert.match(styles, /padding-inline-start/u);
});
