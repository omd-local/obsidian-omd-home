import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  buildModelEntry,
  classifyEmbeddingSetup,
  localModelNamesMatch,
  localModelPullCommand,
  modelSupportsEmbedding,
  textModelInstallGuidance,
} from "../src/local-ai-readiness.ts";
import { modelIsCloudBacked } from "../src/ai-provider.ts";
import {
  OmdBridge,
  portableOmdAppContents,
  resolvePortableOmdPython,
  spawnProcess,
} from "../src/omd-bridge.ts";

const endpoint = "http://localhost:11434";
const model = "qwen3:4b-instruct";
const input = {
  model, host: endpoint, models: [], catalogChecked: true,
  connectionCode: "ready" as const, code: "selected_model_missing" as const,
};

test("missing text models get an exact safe pull command at the selected endpoint", () => {
  assert.deepEqual(textModelInstallGuidance(input), {
    model,
    pullCommand: `OLLAMA_HOST='${endpoint}' ollama pull ${model}`,
  });
  assert.equal(textModelInstallGuidance({ ...input, connectionCode: "no_models_installed", code: "no_models_installed" })?.model, model);
  assert.equal(textModelInstallGuidance({ ...input, models: [buildModelEntry({ name: "bge-m3", capabilities: ["embedding"] })] })?.model, model);
  assert.equal(textModelInstallGuidance({ ...input, code: "unchecked" })?.model, model);
  assert.equal(localModelPullCommand(model, "http://[::1]:12000", true),
    `cmd.exe /d /c "set OLLAMA_HOST=http://[::1]:12000&& ollama pull ${model}"`);
});

test("text install guidance distinguishes missing, unreachable, incompatible, and unverified models", () => {
  for (const connectionCode of ["daemon_unreachable", "invalid_host", "provider_unreachable", "unchecked"] as const) {
    assert.equal(textModelInstallGuidance({ ...input, connectionCode }), null);
  }
  for (const code of ["selected_model_incompatible", "selected_model_remote_blocked", "checking"] as const) {
    assert.equal(textModelInstallGuidance({ ...input, code }), null);
  }
  assert.equal(textModelInstallGuidance({ ...input, code: "unchecked", catalogChecked: false }), null);
  assert.equal(textModelInstallGuidance({ ...input, code: "ready", models: [buildModelEntry({ name: model, capabilities: ["completion"] })] }), null);
  for (const unsafe of ["x;echo y", "$(whoami)", "x\ncommand", "--help", "remote:cloud"]) {
    assert.equal(localModelPullCommand(unsafe, endpoint, false), null);
    assert.equal(textModelInstallGuidance({ ...input, model: unsafe })?.pullCommand, null);
  }
});

for (const kind of ["text", "embedding"] as const) {
  test(`${kind} model recovery displays the command, copies it, and rechecks without installing or changing settings`, async () => {
    const selectedModel = kind === "text" ? model : "bge-m3";
    const methodName = kind === "text" ? "modelReadinessRail" : "embeddingModelSetting";
    const source = ts.createSourceFile("settings.ts", await readFile(new URL("../src/settings.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const method = source.statements.flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : [])
      .find((node) => node.name?.getText(source) === methodName);
    assert.ok(method);
    const compiled = ts.transpileModule(`class Harness { ${method.getText(source)} }`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const displayed: string[] = [];
    const copied: string[] = [];
    const buttons: Array<{ label: string; click: () => Promise<void> }> = [];
    class Element {
      addClass(..._names: string[]): void {}
      setAttribute(_key: string, _value: string): void {}
      createEl(_tag: string, options?: { text?: string }): Element {
        if (options?.text) displayed.push(options.text);
        return new Element();
      }
    }
    class Setting {
      settingEl = new Element();
      descEl = new Element();
      setName(_name: string): this { return this; }
      setDesc(value: string): this { displayed.push(value); return this; }
      addDropdown(callback: (dropdown: any) => void): this {
        const dropdown = {
          addOption() { return this; }, addOptions() { return this; },
          setValue() { return this; }, setDisabled() { return this; }, onChange() { return this; },
        };
        callback(dropdown);
        return this;
      }
      addButton(callback: (button: any) => void): this {
        const entry = { label: "", click: async () => {} };
        const button = {
          buttonEl: new Element(),
          setButtonText(value: string) { entry.label = value; return this; },
          setDisabled(_value: boolean) { return this; },
          onClick(action: () => Promise<void>) { entry.click = action; return this; },
        };
        callback(button);
        buttons.push(entry);
        return this;
      }
    }
    const tab = new Function("Setting", "textModelInstallGuidance", "classifyEmbeddingSetup", "localModelNamesMatch", "modelIsCloudBacked", "modelSupportsEmbedding", "navigator", "Notice", "process", "Platform", `${compiled}\nreturn new Harness();`)(
      Setting, textModelInstallGuidance, classifyEmbeddingSetup, localModelNamesMatch, modelIsCloudBacked, modelSupportsEmbedding,
      { clipboard: { writeText: async (value: string) => { copied.push(value); } } }, class {}, process, { isWin: false },
    );
    const settings = { aiProvider: "ollama", aiModel: model, localWritingModel: model, embeddingModel: "bge-m3", ollamaHost: endpoint };
    let checks = 0;
    tab.plugin = {
      settings, aiSetupBusy: () => false,
      localAiState: { models: [], daemonCode: "ready", connectionCode: "ready", catalogCheckedAt: 1 },
      ollamaLocalClient: new Proxy({}, { get: () => assert.fail("Copying a command must not call Ollama or download a model") }),
      checkLocalAiConnection: async () => { checks += 1; return true; },
    };
    tab.runAiSetupAction = async (action: () => Promise<void>) => await action();
    if (kind === "text") tab.modelReadinessRail({}, "Answer model", { model, code: "selected_model_missing", detail: "missing" }, true);
    else tab.embeddingModelSetting({});
    assert.ok(displayed.includes(`OLLAMA_HOST='${endpoint}' ollama pull ${selectedModel}`));
    assert.ok(displayed.some((value) => /terminal/iu.test(value)));
    assert.deepEqual(buttons.map((button) => button.label), ["Copy install command", "Check setup"]);
    await buttons.find((button) => button.label === "Copy install command")?.click();
    assert.deepEqual(copied, [`OLLAMA_HOST='${endpoint}' ollama pull ${selectedModel}`]);
    assert.equal(checks, 0, "copying alone does not claim the model is installed or run setup checks");
    await buttons.find((button) => button.label === "Check setup")?.click();
    assert.equal(checks, 1);
    assert.equal(tab.plugin.settings, settings);
    assert.equal(settings.aiModel, model);
    assert.equal(settings.embeddingModel, "bge-m3");
  });
}

test("portable Python discovery is restricted to the selected engine app layout", () => {
  assert.equal(portableOmdAppContents("/Applications/OMD Engine.app/Contents/MacOS/omd"), "/Applications/OMD Engine.app/Contents");
  assert.equal(portableOmdAppContents("/Users/Someone/Applications/OMD Engine.app/Contents/MacOS/omd"), "/Users/Someone/Applications/OMD Engine.app/Contents");
  for (const launcher of ["omd", "relative/OMD Engine.app/Contents/MacOS/omd", "/usr/local/bin/omd", "/Applications/Other.app/Contents/MacOS/omd", "/Applications/OMD Engine.app/Contents/MacOS/not-omd"]) {
    assert.equal(portableOmdAppContents(launcher), null);
  }
});

test("portable engine runs the real Python bridge from a path with spaces without system Python lookup", async () => {
  const root = await mkdtemp(join(tmpdir(), "omd engine fixture "));
  const contents = join(root, "OMD Engine.app", "Contents");
  const runtime = join(contents, "runtime");
  const macos = join(contents, "MacOS");
  const launcher = join(macos, "omd");
  const nodeRequire = createRequire(import.meta.url);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousPythonPath = process.env.PYTHONPATH;
  Object.defineProperty(globalThis, "window", { value: { require: nodeRequire, setTimeout, clearTimeout }, configurable: true, writable: true });
  try {
    await mkdir(macos, { recursive: true });
    const venv = spawnSync("python3", ["-m", "venv", "--without-pip", "--copies", runtime], { encoding: "utf8" });
    assert.equal(venv.status, 0, venv.stderr);
    const python = join(runtime, "bin", "python3");
    const purelib = spawnSync(python, ["-I", "-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"], { encoding: "utf8" });
    assert.equal(purelib.status, 0, purelib.stderr);
    const module = join(purelib.stdout.trim(), "omd");
    await mkdir(module, { recursive: true });
    await writeFile(join(module, "__init__.py"), "FIXTURE = True\n");
    await writeFile(launcher, "#!/bin/sh\n", { mode: 0o755 });
    await symlink(python, join(macos, "python3"));
    const inventory = (await readdir(contents, { recursive: true })).sort();
    assert.equal(await resolvePortableOmdPython(launcher, spawnProcess), await realpath(python));
    const embedded = "import json,sys,omd\nr=json.loads(sys.stdin.read())\nprint(json.dumps({'ok':True,'hits':[{'path':'proof.md','title':'Proof','score':1,'evidence':r['query']}]}))";
    const bridge = new OmdBridge(() => launcher, () => "", () => "", () => embedded);
    const shadow = join(root, "unrelated Python modules");
    await mkdir(join(shadow, "omd"), { recursive: true });
    await writeFile(join(shadow, "omd", "__init__.py"), "raise RuntimeError('must not import from PYTHONPATH')\n");
    process.env.PYTHONPATH = shadow;
    const hits = await bridge.search(root, "portable proof");
    assert.equal(hits[0]?.path, "proof.md");
    assert.equal(hits[0]?.evidence, "portable proof");
    const cliAlias = join(root, "local bin", "omd");
    await mkdir(join(root, "local bin"));
    await symlink(launcher, cliAlias);
    const aliasBridge = new OmdBridge(() => cliAlias, () => "", () => "", () => embedded);
    assert.equal((await aliasBridge.search(root, "alias proof"))[0]?.evidence, "alias proof");
    assert.deepEqual((await readdir(contents, { recursive: true })).sort(), inventory,
      "runtime validation and bridge execution must not write bytecode into the installed app");
    await rm(join(module, "__init__.py"));
    await rm(join(module, "__pycache__"), { recursive: true, force: true });
    assert.equal(await resolvePortableOmdPython(launcher, spawnProcess), null, "an unassociated Python must not be accepted");
    await assert.rejects(bridge.search(root, "proof"), /OMD Engine runtime/u);
    await rm(join(macos, "python3"));
    await symlink(process.execPath, join(macos, "python3"));
    let launches = 0;
    assert.equal(await resolvePortableOmdPython(launcher, async () => { launches += 1; throw new Error("must not execute"); }), null);
    assert.equal(launches, 0, "an interpreter outside the selected bundle is rejected before execution");
  } finally {
    if (previousPythonPath === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = previousPythonPath;
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
    await rm(root, { recursive: true, force: true });
  }
});

test("independently packaged engine searches a synthetic vault through the bundled Python bridge", {
  skip: !process.env.OMD_TEST_ENGINE_PATH,
}, async () => {
  const launcher = process.env.OMD_TEST_ENGINE_PATH!;
  const root = await mkdtemp(join(tmpdir(), "omd packaged bridge "));
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: { require: createRequire(import.meta.url), setTimeout, clearTimeout }, configurable: true, writable: true,
  });
  try {
    const canonicalLauncher = await realpath(launcher);
    const contents = portableOmdAppContents(canonicalLauncher);
    assert.ok(contents);
    const inventory = (await readdir(contents, { recursive: true })).sort();
    const interpreter = await resolvePortableOmdPython(canonicalLauncher, spawnProcess);
    assert.ok(interpreter, "packaged Python and its OMD module must belong to the selected app");
    const module = await spawnProcess(interpreter, ["-I", "-B", "-c", "from omd.retrieval import search_notes; print('retrieval ready')"]);
    assert.equal(module.code, 0, module.stderr);
    const embedded = await readFile(new URL("../bridge/omd_home_bridge.py", import.meta.url), "utf8");
    const vault = join(root, "Synthetic vault");
    await mkdir(vault);
    await writeFile(join(vault, "proof.md"), "# Portable engine proof\n\nquartzproof confirms this independently installed engine can search the local vault.\n");
    const alias = join(root, "linked omd");
    await symlink(launcher, alias);
    for (const executable of [launcher, alias]) {
      const bridge = new OmdBridge(() => executable, () => "", () => "", () => embedded);
      const hits = await bridge.search(vault, "quartzproof");
      assert.ok(hits.some((hit) => hit.path.endsWith("proof.md") && hit.evidence.includes("quartzproof")));
    }
    assert.deepEqual((await readdir(contents, { recursive: true })).sort(), inventory,
      "packaged-engine bridge checks must leave the installed app inventory unchanged");
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
    await rm(root, { recursive: true, force: true });
  }
});
