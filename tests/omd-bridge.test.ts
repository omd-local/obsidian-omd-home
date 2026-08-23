import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  appendCommonExecutableDirectoriesToPath,
  omdCaptureArgs,
  parsePythonShebang,
  prependExecutableDirectoryToPath,
} from "../src/omd-events.ts";
import {
  bridgeErrorMessage,
  bridgeProcessFailureMessage,
  bridgeTimeoutMs,
  captureErrorMessage,
  OmdBridge,
  parseBridgeResponse,
  pythonBridgeArgs,
  pythonBridgeStdin,
  spawnProcess,
} from "../src/omd-bridge.ts";

const bridgeScript = new URL("../bridge/omd_home_bridge.py", import.meta.url);
const nodeRequire = createRequire(import.meta.url);

test("Python bridge prefers an override and otherwise runs the bundled bootstrap", () => {
  assert.deepEqual(pythonBridgeArgs(" /custom/bridge.py ", "embedded"), ["/custom/bridge.py"]);
  const bundled = pythonBridgeArgs("", "print('embedded')");
  assert.equal(bundled[0], "-c");
  assert.match(bundled[1] ?? "", /json\.loads\(sys\.stdin\.readline\(\)\)/u);
  assert.match(bundled[1] ?? "", /compile\(s,'<omd-home-bridge>'/u);
  assert.throws(() => pythonBridgeArgs("", ""), /bridge is unavailable/u);
});

test("bundled bridge stdin carries source separately from the request payload", () => {
  const stdin = pythonBridgeStdin("", "print('embedded')", { action: "search", query: "calendar" });
  const [sourceEnvelope, payload] = stdin.split("\n", 2);
  assert.deepEqual(JSON.parse(sourceEnvelope), { source: "print('embedded')" });
  assert.deepEqual(JSON.parse(payload), { action: "search", query: "calendar" });
  assert.equal(
    pythonBridgeStdin("/custom/bridge.py", "ignored", { action: "search" }),
    JSON.stringify({ action: "search" }),
  );
});

test("hybrid Vault Q&A gets a longer bounded bridge timeout", () => {
  assert.equal(bridgeTimeoutMs({ action: "search" }), 95_000);
  assert.equal(bridgeTimeoutMs({ action: "preview_ai", hybrid_retrieval_enabled: false }), 95_000);
  assert.equal(bridgeTimeoutMs({ action: "preview_ai", hybrid_retrieval_enabled: true }), 5 * 60_000);
  assert.equal(bridgeTimeoutMs({ action: "execute_ai", hybrid_retrieval_enabled: true }), 5 * 60_000);
});

test("uses OMD's vault-capture subcommand instead of standalone conversion", () => {
  assert.deepEqual(omdCaptureArgs("https://example.com", "/tmp/vault"), [
    "capture", "https://example.com", "--vault", "/tmp/vault", "--json-events",
  ]);
});

test("discovers OMD's isolated Python from its launcher", () => {
  assert.equal(parsePythonShebang("#!/opt/homebrew/Cellar/omd/libexec/bin/python\nimport sys\n"), "/opt/homebrew/Cellar/omd/libexec/bin/python");
  assert.equal(parsePythonShebang("#!/bin/sh\n"), null);
});

test("makes tools bundled beside OMD visible to GUI-launched child processes", () => {
  assert.equal(
    prependExecutableDirectoryToPath(
      "/Volumes/Apps/omd/.venv/bin/omd",
      "/usr/bin:/bin",
      ":",
    ),
    "/Volumes/Apps/omd/.venv/bin:/usr/bin:/bin",
  );
});

test("does not duplicate OMD's executable directory in PATH", () => {
  assert.equal(
    prependExecutableDirectoryToPath(
      "/Volumes/Apps/omd/.venv/bin/omd",
      "/Volumes/Apps/omd/.venv/bin:/usr/bin:/bin",
      ":",
    ),
    "/Volumes/Apps/omd/.venv/bin:/usr/bin:/bin",
  );
});

test("makes Homebrew OMD visible to Finder-launched Obsidian on macOS", () => {
  assert.equal(
    appendCommonExecutableDirectoriesToPath(
      "/usr/bin:/bin:/usr/sbin:/sbin",
      "/Users/example",
      ":",
      "darwin",
    ),
    "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/Users/example/.local/bin",
  );
});

test("does not duplicate standard executable directories", () => {
  assert.equal(
    appendCommonExecutableDirectoriesToPath(
      "/usr/bin:/opt/homebrew/bin:/Users/example/.local/bin",
      "/Users/example/",
      ":",
      "darwin",
    ),
    "/usr/bin:/opt/homebrew/bin:/Users/example/.local/bin:/usr/local/bin:/opt/local/bin",
  );
});

test("leaves Windows PATH discovery unchanged", () => {
  assert.equal(
    appendCommonExecutableDirectoriesToPath("C:\\Windows\\System32", "C:\\Users\\example", ";", "win32"),
    "C:\\Windows\\System32",
  );
});

test("preserves structured bridge error messages", () => {
  assert.equal(
    bridgeErrorMessage({ message: "vault path does not exist", type: "ValueError" }, "fallback"),
    "The selected vault could not be read by OMD Home.",
  );
  assert.equal(
    bridgeErrorMessage({ message: "retrieval root must be an existing directory", type: "ValueError" }, "fallback"),
    "The selected vault could not be read by OMD Home.",
  );
  assert.equal(
    bridgeErrorMessage('{"message":"loopback only","type":"ValueError"}', "fallback"),
    "OMD Home bridge failed. Check the local bridge setup and try again.",
  );
});

test("sanitizes structured bridge errors before surfacing them", () => {
  assert.equal(
    bridgeErrorMessage(
      { message: "Ollama is not reachable at http://localhost:11434. Start the Ollama app or run `ollama serve`. ([Errno 61] Connection refused)" },
      "fallback",
    ),
    "Ollama is not reachable at the configured local endpoint. Start Ollama and try again.",
  );
  assert.equal(
    bridgeErrorMessage(
      { message: "Ollama rejected the request: {\"error\":\"model 'secret-model' not found\"}" },
      "fallback",
    ),
    "Ollama rejected the request. Check the selected local model and try again.",
  );
  assert.equal(
    bridgeErrorMessage(
      { message: "ollama task exceeds OMD's 4096-token context budget", type: "AIServiceError" },
      "fallback",
    ),
    "The retrieved vault evidence exceeded the local model context budget. OMD Home reduced the evidence selection; try again or ask a narrower question.",
  );
  assert.equal(
    bridgeErrorMessage(
      { message: "ollama returned an incomplete response", type: "AIServiceError" },
      "fallback",
    ),
    "The local model ran out of answer space before finishing. Try again; if it repeats, ask a narrower question or choose a larger local model.",
  );
  assert.equal(
    bridgeErrorMessage("Traceback: /Users/shion/private/vault.md", "OMD Home bridge failed"),
    "OMD Home bridge failed. Check the local bridge setup and try again.",
  );
});

test("surfaces actionable Python bridge startup failures without leaking local paths", () => {
  assert.equal(
    bridgeProcessFailureMessage(
      "Traceback (most recent call last): ModuleNotFoundError: No module named 'omd'",
      1,
    ),
    "The Python environment used by OMD Home is missing a required module. Point the OMD executable to the current OMD environment, then try again.",
  );
  assert.equal(
    bridgeProcessFailureMessage("Traceback: /Users/example/private/vault.md", 7),
    "OMD Home's Python bridge exited before returning a result (exit 7). Check the configured OMD executable and Python environment, then try again.",
  );
});

test("sanitizes structured OMD capture error events", () => {
  assert.equal(
    captureErrorMessage('{"v":1,"event":"fatal","ts":1,"message":"Playwright could not load the page"}'),
    "OMD could not load the page. Check the local browser capture setup and try again.",
  );
  assert.equal(
    captureErrorMessage("{\"v\":1,\"event\":\"error\",\"kind\":\"source_missing\",\"ts\":1,\"message\":\"ENOENT: no such file or directory, open \\\"/private/path.txt\\\"\"}"),
    "OMD could not read that source. Check the URL or file path and try again.",
  );
  assert.equal(
    captureErrorMessage("Traceback: /Users/shion/secrets.txt"),
    "OMD capture failed. Check the OMD setup and try again.",
  );
  assert.equal(
    captureErrorMessage([
      '{"v":1,"event":"stage_state","state":"failed","stage_id":"convert","ts":1}',
      "markitdown._exceptions.FileConversionException: File conversion failed after 1 attempts:",
      "PdfConverter threw MissingDependencyException. Install MarkItDown with [pdf].",
    ].join("\n")),
    "OMD cannot convert PDFs because MarkItDown PDF support is missing. Install markitdown[pdf] in the configured OMD environment, then retry.",
  );
});

test("parses JSON bridge responses from stdout", () => {
  assert.deepEqual(parseBridgeResponse('log line\n{"ok":false,"error":{"message":"boom"}}\n'), {
    ok: false,
    error: { message: "boom" },
  });
});

test("fallback bridge search keeps common short acronyms", async () => {
  const vault = await mkdtemp(join(tmpdir(), "omd-home-bridge-"));
  try {
    await mkdir(join(vault, "Notes"), { recursive: true });
    await writeFile(join(vault, "Notes", "AI Notes.md"), "AI planning\nMachine learning and AI systems\n", "utf8");
    const response = runBridge({ action: "search", vault, query: "AI", limit: 10 });
    assert.equal(response.ok, true);
    assert.equal(Array.isArray(response.hits), true);
    assert.equal(response.hits[0]?.path, "Notes/AI Notes.md");
    assert.match(String(response.hits[0]?.evidence ?? ""), /\bAI\b/);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("fallback bridge search favors topical notes and returns numbered section evidence", async () => {
  const vault = await mkdtemp(join(tmpdir(), "omd-home-rag-"));
  try {
    await writeFile(
      join(vault, "noise.md"),
      `# Survival analysis\n\n${"how many for you summarise and list them all ".repeat(200)}`,
      "utf8",
    );
    await writeFile(join(vault, "partial.md"), "# Transfer learning\n\nA beginner tutorial.\n", "utf8");
    const headings = [
      "Strength comes with time",
      "Learn efficient technique",
      "Let your legs work",
      "Keep long arms",
      "Try harder problems",
      "Warm up",
      "Take breaks and eat",
      "Choose smart gear",
      "Manage your mindset",
      "Follow safety rules",
    ];
    const sections = headings
      .map((heading, index) => `## **${index + 1}. ${heading}**\n\nBeginner bouldering advice for ${heading.toLowerCase()}.`)
      .join("\n\n");
    await writeFile(
      join(vault, "bouldering.md"),
      `---\ntitle: Bouldering tips for beginners\n---\n\n# Bouldering tips for beginners\n\n> [Source](https://example.com/bouldering-tips-for-beginners)\n\nThis guide contains 10 tips.\n\n${sections}`,
      "utf8",
    );
    const duplicate = "# Bouldering duplicate\n\nBeginner bouldering tips with duplicate context.\n";
    await writeFile(join(vault, "z-copy-one.md"), duplicate, "utf8");
    await writeFile(join(vault, "z-copy-two.md"), duplicate, "utf8");

    const response = runBridge({
      action: "search",
      vault,
      query: "how many beginner tips for bouldering, could you summarise and list them all",
      limit: 10,
    });

    assert.equal(response.ok, true);
    assert.equal(response.hits[0]?.path, "bouldering.md");
    assert.equal(response.hits.some((hit: { path?: string }) => hit.path === "noise.md"), false);
    assert.equal(
      response.hits.filter((hit: { path?: string }) => hit.path?.startsWith("z-copy-")).length,
      1,
    );
    const evidence = String(response.hits[0]?.evidence ?? "");
    assert.doesNotMatch(evidence, /title:/u);
    assert.doesNotMatch(evidence, /https:\/\//u);
    for (const [index, heading] of headings.entries()) {
      assert.match(evidence, new RegExp(`${index + 1}\\. ${heading}`, "u"));
    }
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("bridge emits structured JSON errors for invalid requests", () => {
  const response = runBridge({ action: "search", vault: "/definitely/missing", query: "AI", limit: 10 });
  assert.equal(response.ok, false);
  assert.deepEqual(response.error, {
    message: "retrieval root must be an existing directory",
    type: "ValueError",
  });
});

test("bundled bridge bootstrap stays argv-safe and executes the embedded source", () => {
  const source = readFileSync(bridgeScript, "utf8");
  const args = pythonBridgeArgs("", source);
  assert.ok(Buffer.byteLength(args[1] ?? "", "utf8") < 1_024, "bridge bootstrap must stay below the portable argv budget");
  const result = spawnSync("python3", args, {
    encoding: "utf8",
    input: pythonBridgeStdin("", source, { action: "search", vault: "/definitely/missing", query: "AI", limit: 10 }),
  });
  const output = result.stdout.trim().split(/\r?\n/u).at(-1);
  assert.ok(output, `embedded bridge produced no stdout: ${result.stderr}`);
  const response = JSON.parse(output) as Record<string, unknown>;
  assert.equal(response.ok, false);
  assert.deepEqual(response.error, { message: "retrieval root must be an existing directory", type: "ValueError" });
});

test("Ask AI runs through the real Python bridge with bounded evidence blocks", async () => {
  const root = await mkdtemp(join(tmpdir(), "omd-home-bridge-stub-"));
  const vault = join(root, "vault");
  const stubRoot = join(root, "stubs");
  const packageRoot = join(stubRoot, "omd");
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  try {
    await mkdir(vault, { recursive: true });
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "__init__.py"), "");
    await writeFile(join(packageRoot, "retrieval.py"), `
from dataclasses import dataclass
from pathlib import Path

@dataclass
class SearchHit:
    path: str
    title: str
    score: float
    evidence: str

@dataclass
class EvidenceBlock:
    path: str
    title: str
    heading: str
    kind: str
    score: float
    text: str

@dataclass
class AnswerContext:
    hits: list[SearchHit]
    blocks: list[EvidenceBlock]
    candidate_count: int
    retrieval_mode: str = "hybrid"
    warnings: tuple[str, ...] = ()

@dataclass
class SemanticRecallConfig:
    host: str
    model: str
    rerank: bool = False
    model_revision: str = ""

def search_notes(root, query, limit=10):
    return [SearchHit(path="legacy.md", title="Legacy", score=1.0, evidence="legacy evidence")]

def build_answer_context(root, query, hit_limit=8, block_limit=8, semantic_config=None):
    if not Path(root).is_dir():
        raise ValueError("retrieval root must be an existing directory")
    if query == "sparse only":
        assert semantic_config is None
    else:
        assert semantic_config == SemanticRecallConfig(
            host="http://localhost:11434",
            model="bge-m3",
            rerank=True,
            model_revision="sha256:current",
        )
    hits = [
        SearchHit(path="Sources/Web/bouldering-tips.md", title="Bouldering Tips", score=18.0, evidence="outline"),
        SearchHit(path="Calendar/Events/linked-event.md", title="Linked Event", score=12.0, evidence="event"),
    ]
    blocks = [
        EvidenceBlock(
            path="Sources/Web/bouldering-tips.md" if index <= 6 else "Calendar/Events/linked-event.md",
            title="Bouldering Tips" if index <= 6 else "Linked Event",
            heading=f"Section {index}",
            kind="outline" if index <= 6 else "detail",
            score=float(100 - index),
            text=f"Evidence block {index}",
        )
        for index in range(1, 13)
    ]
    return AnswerContext(
        hits=hits[:hit_limit],
        blocks=blocks[:block_limit],
        candidate_count=24,
        retrieval_mode="sparse" if query == "sparse only" else "hybrid",
    )
`.trimStart());
    await writeFile(join(packageRoot, "ai_service.py"), `
from dataclasses import dataclass

@dataclass
class AIConsentGrant:
    approved: bool = True

@dataclass
class AITextTask:
    provider: str
    model: str
    capability: str
    operation: str
    system_prompt: str
    max_output_tokens: int
    endpoint: str | None = None
    temperature: float | None = None
    timeout_seconds: float = 60.0
    stream: bool = True

@dataclass
class Preview:
    provider: str
    model: str
    privacy_mode: str
    destination_domain: str
    character_count: int
    estimated_input_tokens: int
    policy_url: str | None
    data_handling_summary: str

@dataclass
class Result:
    text: str
    provider: str
    actual_model: str
    usage: dict[str, int]
    timing: dict[str, int]

def prepare_text_task(task, source_text):
    return Preview(
        provider=task.provider,
        model=task.model,
        privacy_mode="local_only",
        destination_domain=task.endpoint or "local",
        character_count=len(source_text),
        estimated_input_tokens=max(1, len(source_text) // 4),
        policy_url=None,
        data_handling_summary=source_text,
    )

def create_text_task_consent(task, source_text):
    return AIConsentGrant()

def execute_text_task(task, source_text, consent_granted, consent_grant):
    return Result(
        text=source_text + "\\nValid [S1], valid [[S2]], blocks [E1] [[E8]], unknown [[S9]] [[E9]].",
        provider=task.provider,
        actual_model=f"{task.model}:stub",
        usage={"input_tokens": 42, "output_tokens": 7},
        timing={"total_ms": 3},
    )
`.trimStart());

    const env = {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${stubRoot}${pathDelimiter}${process.env.PYTHONPATH}`
        : stubRoot,
    };
    const payload = {
      vault,
      query: "what have I written about calendar workflows?",
      provider: "ollama",
      model: "qwen3:4b-instruct",
      endpoint: "http://localhost:11434",
      limit: 8,
      hybrid_retrieval_enabled: true,
      embedding_model: "bge-m3",
      embedding_model_revision: "sha256:current",
      semantic_rerank_enabled: true,
    };

    const preview = runBridge({ action: "preview_ai", ...payload }, env);
    const execute = runBridge({ action: "execute_ai", ...payload, consent_grant: null }, env);

    assert.equal(preview.ok, true);
    assert.equal(execute.ok, true);
    assert.equal(preview.retrieval_mode, "hybrid");
    assert.equal(preview.retrieval_model, "bge-m3");
    assert.deepEqual(preview.warnings, []);
    assert.equal(execute.retrieval_mode, "hybrid");
    assert.equal(execute.retrieval_model, "bge-m3");
    assert.deepEqual(execute.warnings, []);
    assert.deepEqual(
      preview.evidence.map((hit: { path: string }) => hit.path),
      ["Sources/Web/bouldering-tips.md", "Calendar/Events/linked-event.md"],
    );
    assert.deepEqual(
      execute.evidence.map((hit: { path: string }) => hit.path),
      ["Sources/Web/bouldering-tips.md", "Calendar/Events/linked-event.md"],
    );
    assert.notEqual(preview.evidence[0]?.path, "legacy.md");

    const previewContext = String(preview.preview?.data_handling_summary ?? "");
    const executeContext = String(execute.text ?? "");
    assert.match(previewContext, /EVIDENCE BLOCKS/u);
    assert.match(previewContext, /BLOCK E1/u);
    assert.match(previewContext, /BLOCK E8/u);
    assert.doesNotMatch(previewContext, /BLOCK E9/u);
    assert.match(previewContext, /SOURCE CATALOG/u);
    assert.match(previewContext, /\[S1\] Sources\/Web\/bouldering-tips\.md/u);
    assert.match(previewContext, /\[S2\] Calendar\/Events\/linked-event\.md/u);
    assert.match(previewContext, /Source: \[S1\]/u);
    assert.match(previewContext, /Source: \[S2\]/u);
    assert.doesNotMatch(previewContext, /\[\[Sources\/Web\/bouldering-tips\.md\]\]/u);
    assert.doesNotMatch(previewContext, /\[\[Calendar\/Events\/linked-event\.md\]\]/u);
    assert.doesNotMatch(previewContext, /VAULT EVIDENCE/u);
    assert.doesNotMatch(previewContext, /SOURCE \[\[/u);
    assert.match(previewContext, /Kind: outline/u);
    assert.match(previewContext, /Kind: detail/u);

    assert.match(executeContext, /\[\[Sources\/Web\/bouldering-tips\.md\]\]/u);
    assert.match(executeContext, /\[\[Calendar\/Events\/linked-event\.md\]\]/u);
    assert.doesNotMatch(executeContext, /\[\[S1\]\]/u);
    assert.doesNotMatch(executeContext, /\[\[S2\]\]/u);
    assert.match(executeContext, /unknown \[S9\]/u);
    assert.doesNotMatch(executeContext, /\[\[S9\]\]/u);
    assert.match(executeContext, /blocks \[\[Sources\/Web\/bouldering-tips\.md\]\] \[\[Calendar\/Events\/linked-event\.md\]\]/u);
    assert.match(executeContext, /\[E9\]/u);
    assert.doesNotMatch(executeContext, /\[\[E9\]\]/u);
    for (const context of [previewContext, executeContext]) {
      assert.match(context, /EVIDENCE BLOCKS/u);
      assert.match(context, /BLOCK E1/u);
      assert.match(context, /BLOCK E8/u);
      assert.doesNotMatch(context, /BLOCK E9/u);
      assert.match(context, /Kind: outline/u);
      assert.match(context, /Kind: detail/u);
    }
    assert.equal(execute.model, "qwen3:4b-instruct:stub");

    const sparse = runBridge({
      action: "preview_ai",
      ...payload,
      query: "sparse only",
      hybrid_retrieval_enabled: false,
    }, env);
    assert.equal(sparse.ok, true);
    assert.equal(sparse.retrieval_mode, "sparse");
    assert.equal(sparse.retrieval_model, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Ask AI validates the local hybrid endpoint before retrieval starts", () => {
  const response = runBridge({
    action: "preview_ai",
    vault: "/definitely/missing",
    query: "calendar workflows",
    provider: "ollama",
    model: "qwen3:4b-instruct",
    endpoint: "http://localhost:9999",
    limit: 8,
    hybrid_retrieval_enabled: true,
    embedding_model: "bge-m3",
    semantic_rerank_enabled: false,
  });
  assert.equal(response.ok, false);
  assert.match(String(response.error?.message ?? ""), /loopback Ollama endpoint/u);
});

test("Ask AI keeps hybrid compatibility with OMD builds before model revisions", () => {
  const code = [
    "import json",
    "import bridge.omd_home_bridge as bridge",
    "class LegacySemanticRecallConfig:",
    "    def __init__(self, host, model, rerank=False):",
    "        self.host = host",
    "        self.model = model",
    "        self.rerank = rerank",
    "bridge.SemanticRecallConfig = LegacySemanticRecallConfig",
    "config = bridge._semantic_config({",
    "    'hybrid_retrieval_enabled': True,",
    "    'endpoint': 'http://localhost:11434',",
    "    'embedding_model': 'bge-m3',",
    "    'embedding_model_revision': 'sha256:current',",
    "    'semantic_rerank_enabled': True,",
    "})",
    "print(json.dumps({'host': config.host, 'model': config.model, 'rerank': config.rerank}))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", code], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    host: "http://localhost:11434",
    model: "bge-m3",
    rerank: true,
  });
});

test("Ask AI reports sparse fallback when the connected OMD build cannot accept semantic retrieval", async () => {
  const root = await mkdtemp(join(tmpdir(), "omd-home-bridge-legacy-"));
  const vault = join(root, "vault");
  const stubRoot = join(root, "stubs");
  const packageRoot = join(stubRoot, "omd");
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  try {
    await mkdir(vault, { recursive: true });
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "__init__.py"), "");
    await writeFile(join(packageRoot, "retrieval.py"), `
from dataclasses import dataclass

@dataclass
class SearchHit:
    path: str
    title: str
    score: float
    evidence: str

@dataclass
class EvidenceBlock:
    path: str
    title: str
    heading: str
    kind: str
    score: float
    text: str

@dataclass
class AnswerContext:
    hits: list[SearchHit]
    blocks: list[EvidenceBlock]
    candidate_count: int
    warnings: tuple[str, ...] = ("semantic_recall_unavailable", "semantic_recall_unavailable")

def search_notes(root, query, limit=10):
    return [SearchHit(path="legacy.md", title="Legacy", score=1.0, evidence="legacy evidence")]

def build_answer_context(root, query, hit_limit=8, block_limit=8):
    hits = [SearchHit(path="legacy.md", title="Legacy", score=1.0, evidence="legacy evidence")]
    blocks = [EvidenceBlock(path="legacy.md", title="Legacy", heading="Section 1", kind="note", score=1.0, text="legacy evidence")]
    return AnswerContext(hits=hits[:hit_limit], blocks=blocks[:block_limit], candidate_count=1)
`.trimStart());
    const env = {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${stubRoot}${pathDelimiter}${process.env.PYTHONPATH}`
        : stubRoot,
    };
    const response = runBridge({
      action: "preview_ai",
      vault,
      query: "calendar workflows",
      provider: "ollama",
      model: "qwen3:4b-instruct",
      endpoint: "http://localhost:11434",
      limit: 8,
      hybrid_retrieval_enabled: true,
      embedding_model: "bge-m3",
      semantic_rerank_enabled: true,
    }, env);
    assert.equal(response.ok, true);
    assert.equal(response.retrieval_mode, "sparse");
    assert.equal(response.retrieval_model, null);
    assert.deepEqual(response.warnings, [
      "hybrid_retrieval_unsupported_by_omd",
      "semantic_recall_unavailable",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Ask AI keeps hybrid disabled and reports a missing embedding model explicitly", async () => {
  const root = await mkdtemp(join(tmpdir(), "omd-home-bridge-missing-embed-"));
  const vault = join(root, "vault");
  const stubRoot = join(root, "stubs");
  const packageRoot = join(stubRoot, "omd");
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  try {
    await mkdir(vault, { recursive: true });
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "__init__.py"), "");
    await writeFile(join(packageRoot, "retrieval.py"), `
from dataclasses import dataclass
from pathlib import Path

@dataclass
class SearchHit:
    path: str
    title: str
    score: float
    evidence: str

@dataclass
class EvidenceBlock:
    path: str
    title: str
    heading: str
    kind: str
    score: float
    text: str

@dataclass
class AnswerContext:
    hits: list[SearchHit]
    blocks: list[EvidenceBlock]
    candidate_count: int
    retrieval_mode: str = "sparse"
    warnings: tuple[str, ...] = ()

def search_notes(root, query, limit=10):
    return [SearchHit(path="legacy.md", title="Legacy", score=1.0, evidence="legacy evidence")]

def build_answer_context(root, query, hit_limit=8, block_limit=8, semantic_config=None):
    if not Path(root).is_dir():
        raise ValueError("retrieval root must be an existing directory")
    assert semantic_config is None
    hits = [SearchHit(path="legacy.md", title="Legacy", score=1.0, evidence="legacy evidence")]
    blocks = [EvidenceBlock(path="legacy.md", title="Legacy", heading="Section 1", kind="note", score=1.0, text="legacy evidence")]
    return AnswerContext(hits=hits[:hit_limit], blocks=blocks[:block_limit], candidate_count=1)
`.trimStart());
    const env = {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH
        ? `${stubRoot}${pathDelimiter}${process.env.PYTHONPATH}`
        : stubRoot,
    };
    const response = runBridge({
      action: "preview_ai",
      vault,
      query: "calendar workflows",
      provider: "ollama",
      model: "qwen3:4b-instruct",
      endpoint: "http://localhost:11434",
      limit: 8,
      hybrid_retrieval_enabled: true,
      embedding_model: "   ",
      semantic_rerank_enabled: true,
    }, env);
    assert.equal(response.ok, true);
    assert.equal(response.retrieval_mode, "sparse");
    assert.equal(response.retrieval_model, null);
    assert.deepEqual(response.warnings, ["hybrid_retrieval_model_missing"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Ask AI restores exact wiki paths with spaces without rewriting block labels", () => {
  const code = [
    "from types import SimpleNamespace",
    "import bridge.omd_home_bridge as bridge",
    "hit = SimpleNamespace(path='Sources/Web/3 Simple Bouldering Tips for Beginner to Intermediate Climbers.md')",
    "source = 'BLOCK E1\\nSource: [S1]\\nContent:\\nBeta recall'",
    "print(bridge._restore_exact_source_paths('BLOCK E1 cites [E1] and [S1].', [hit], source))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", code], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^BLOCK E1 cites /u);
  assert.equal(
    result.stdout.match(/\[\[Sources\/Web\/3 Simple Bouldering Tips for Beginner to Intermediate Climbers\.md\]\]/gu)?.length,
    2,
  );
});

test("fallback bridge keeps Ollama requests loopback-only, no-redirect, and bounded", () => {
  const source = readFileSync(bridgeScript, "utf8");
  assert.match(source, /OLLAMA_RESPONSE_LIMIT\s*=\s*1_000_000/u);
  assert.match(source, /"think": False/u);
  assert.match(source, /"temperature": 0\.0/u);
  assert.match(source, /class _NoRedirectHandler\(urllib\.request\.HTTPRedirectHandler\)/u);
  assert.match(source, /build_opener\(_NoRedirectHandler\(\)\)/u);
  assert.match(source, /response\.read\(limit \+ 1\)/u);
  assert.match(source, /Ollama returned too much data/u);
});

test("vault answer evidence is bounded before OMD applies its local context limit", () => {
  const code = [
    "from dataclasses import dataclass",
    "import json",
    "import bridge.omd_home_bridge as bridge",
    "@dataclass",
    "class Block:",
    "    path: str",
    "    title: str",
    "    heading: str",
    "    kind: str",
    "    text: str",
    "blocks = [Block(f'note-{i}.md', f'Note {i}', f'Section {i}', 'section', 'evidence ' * 900) for i in range(8)]",
    "selected, source = bridge._bounded_block_context('summarise all evidence', blocks)",
    "print(json.dumps({'selected': len(selected), 'tokens': bridge._task_input_tokens(source), 'limit': bridge.AI_INPUT_TOKEN_LIMIT}))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", code], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout) as { selected: number; tokens: number; limit: number };
  assert.ok(value.selected > 0 && value.selected < 8);
  assert.ok(value.tokens <= value.limit);
});

test("Ask AI scopes exhaustive questions and keeps evidence categories separate", () => {
  const source = readFileSync(bridgeScript, "utf8");
  assert.match(source, /Follow retrieval\s+response rules\/category\/count/u);
  assert.match(source, /Give each item one supported\s+action\/detail/u);
  assert.match(source, /compatible explicit actions in both sources/u);
  assert.match(source, /mentions, negations,\s+or opposites do not count/u);
  assert.match(source, /Keep each outline item/u);
  assert.match(source, /never\s+merge\/omit it/u);
  assert.match(source, /infer one corrective action per mistake/u);
  assert.match(source, /Deduplicate\s+only details/u);
  assert.match(source, /Discuss overlap only when asked/u);
  assert.match(source, /Answer only what was asked/u);
  assert.match(source, /Under 700 tokens/u);
  assert.match(source, /AI_INPUT_TOKEN_LIMIT\s*=\s*2_600/u);
  assert.match(source, /EVIDENCE CONTRACT/u);
});

test("Ask AI prefers OMD's bounded section-aware answer context without changing search", () => {
  const source = readFileSync(bridgeScript, "utf8");
  assert.match(source, /from omd\.retrieval import build_answer_context/u);
  assert.match(source, /answer = build_answer_context\(/u);
  assert.match(source, /block_limit=min\(limit, 8\)/u);
  assert.match(source, /SOURCE CATALOG/u);
  assert.match(source, /EVIDENCE BLOCKS/u);
  assert.match(source, /f"BLOCK E\{index\}/u);
  assert.match(source, /f"Source: \{source_id\}\\n"/u);
  assert.match(source, /temperature=0\.0/u);
  assert.match(source, /return search_notes\(vault, _string\(request, "query"\), limit=limit\)/u);
});

test("fallback bridge documents the exact local endpoint contract", () => {
  const source = readFileSync(bridgeScript, "utf8");
  assert.match(source, /http:\/\/localhost:11434/u);
  assert.match(source, /http:\/\/127\.0\.0\.1:11434/u);
  assert.match(source, /only permits a loopback Ollama endpoint/u);
});

test("spawnProcess times out runaway children", async () => {
  await withNodeRequire(async () => {
    await assert.rejects(
      spawnProcess(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], { timeoutMs: 25 }),
      /timed out/,
    );
  });
});

test("spawnProcess aborts when the signal is cancelled", async () => {
  await withNodeRequire(async () => {
    const controller = new AbortController();
    const pending = spawnProcess(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], {
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(pending, /aborted/);
  });
});

test("OmdBridge relays caller cancellation to a running hybrid bridge", async () => {
  const root = await mkdtemp(join(tmpdir(), "omd-home-cancel-bridge-"));
  const script = join(root, "slow_bridge.py");
  try {
    await writeFile(script, "import time\ntime.sleep(30)\n");
    await withNodeRequire(async () => {
      const bridge = new OmdBridge(() => "omd", () => "python3", () => script);
      const controller = new AbortController();
      const pending = bridge.previewAi(
        root,
        "test",
        "ollama",
        "qwen3:4b-instruct",
        "http://localhost:11434",
        {
          hybridRetrievalEnabled: true,
          embeddingModel: "bge-m3",
          embeddingModelRevision: "sha256:current",
          semanticRerankEnabled: false,
        },
        controller.signal,
      );
      controller.abort();
      await assert.rejects(
        pending,
        (error: unknown) => error instanceof Error && error.name === "AbortError",
      );
      bridge.dispose();
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("spawnProcess enforces stdout bounds", async () => {
  await withNodeRequire(async () => {
    await assert.rejects(
      spawnProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(128))"], { maxStdoutChars: 32 }),
      /stdout exceeded 32 characters/,
    );
  });
});

function runBridge(
  request: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, any> {
  const result = spawnSync("python3", [bridgeScript.pathname], {
    encoding: "utf8",
    input: JSON.stringify(request),
    env,
  });
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  assert.ok(output, `bridge produced no stdout: ${result.stderr}`);
  return JSON.parse(output) as Record<string, any>;
}

async function withNodeRequire<T>(run: () => Promise<T>): Promise<T> {
  const runtime = globalThis as typeof globalThis & { window?: unknown };
  const previous = runtime.window;
  Object.defineProperty(runtime, "window", {
    value: {
      ...(typeof previous === "object" && previous ? previous : {}),
      require: nodeRequire,
      setTimeout,
      clearTimeout,
    },
    configurable: true,
    writable: true,
  });
  try {
    return await run();
  } finally {
    if (previous === undefined) Reflect.deleteProperty(runtime, "window");
    else Object.defineProperty(runtime, "window", { value: previous, configurable: true, writable: true });
  }
}
