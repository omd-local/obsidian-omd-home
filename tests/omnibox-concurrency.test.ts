import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { isLocalImageSource } from "../src/omnibox-utils.ts";

type Harness = Record<string, any>;

function loadMethods(file: string, names: string[], dependencies: Record<string, unknown> = {}): Harness {
  const source = ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
  const members = source.statements.flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : []);
  const methods = names.map((name) => {
    const member = members.find((node) => node.name?.getText(source) === name);
    assert.ok(member, `Missing production member ${name}`);
    return member.getText(source);
  });
  const compiled = ts.transpileModule(
    `class Harness { ${methods.join("\n")} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}\nreturn new Harness();`)(
    ...Object.values(dependencies),
  ) as Harness;
}

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolveValue = resolvePromise; });
  return { promise, resolve: resolveValue };
}

class FakeElement {
  hidden = false;
  parent: FakeElement | null = null;
  children: FakeElement[] = [];
  text = "";

  empty(): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = "";
  }

  createDiv(options: { text?: string } = {}): FakeElement {
    const child = new FakeElement();
    child.parent = this;
    child.text = options.text ?? "";
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }

  visibleText(): string[] {
    return [this.text, ...this.children.flatMap((child) => child.visibleText())].filter(Boolean);
  }
}

function omniboxHarness(looksCapturable: (query: string) => boolean = () => false): Harness {
  const box = loadMethods("src/omnibox.ts", [
    "execute",
    "beginSubmission",
    "beginResult",
    "finishResult",
    "cancelPendingResult",
    "clearResultShell",
    "dispose",
  ], {
    looksCapturable,
    isLocalImageSource,
    captureRequestFromSettings: (source: string) => source,
    normalizeCaptureSource: (source: string) => source,
  });
  Object.assign(box, {
    previewTimer: null,
    resultGeneration: 0,
    resultController: null,
    resultOutput: null,
    disposed: false,
    input: { value: "" },
    results: new FakeElement(),
    resultPanel: new FakeElement(),
    setResultsVisible(visible: boolean) { this.resultPanel.hidden = !visible; },
  });
  return box;
}

test("a second @ submission wins even when the first answer completes last", async () => {
  const first = deferred<void>();
  const second = deferred<void>();
  const signals = new Map<string, AbortSignal>();
  const box = omniboxHarness();
  box.plugin = {
    settings: {},
    async askOmd(query: string, output: FakeElement, signal: AbortSignal) {
      signals.set(query, signal);
      await (query === "Q1" ? first.promise : second.promise);
      // Deliberately ignore cancellation here. The Omnibox-owned output surface
      // must still prevent a misbehaving late producer from replacing Q2.
      output.createDiv({ text: `answer:${query}` });
    },
  };

  box.input.value = "@Q1";
  const firstRun = box.execute();
  box.input.value = "@Q2";
  const secondRun = box.execute();

  assert.equal(signals.get("Q1")?.aborted, true);
  assert.equal(signals.get("Q2")?.aborted, false);
  second.resolve();
  await secondRun;
  first.resolve();
  await firstRun;

  assert.deepEqual(box.results.visibleText(), ["answer:Q2"]);
});

test("a late OMD search cannot overwrite a newer @ answer", async () => {
  const search = deferred<void>();
  const answer = deferred<void>();
  let searchSignal: AbortSignal | undefined;
  const box = omniboxHarness();
  box.searchVault = () => [];
  box.plugin = {
    settings: {},
    async searchWithOmd(_query: string, output: FakeElement, signal: AbortSignal) {
      searchSignal = signal;
      await search.promise;
      output.empty();
      output.createDiv({ text: "late search" });
    },
    async askOmd(_query: string, output: FakeElement) {
      await answer.promise;
      output.createDiv({ text: "new answer" });
    },
  };

  box.input.value = "no local match";
  const searchRun = box.execute();
  box.input.value = "@new question";
  const answerRun = box.execute();

  assert.equal(searchSignal?.aborted, true);
  answer.resolve();
  await answerRun;
  search.resolve();
  await searchRun;

  assert.equal(box.resultPanel.hidden, false);
  assert.deepEqual(box.results.visibleText(), ["new answer"]);
});

test("a late OMD search cannot restore the result shell after a later command", async () => {
  const search = deferred<void>();
  let commandRuns = 0;
  const box = omniboxHarness();
  box.searchVault = () => [];
  box.commands = {
    listCommands: () => [{ id: "app:command", name: "Run command" }],
    executeCommandById: () => { commandRuns += 1; return true; },
  };
  box.plugin = {
    settings: {},
    async searchWithOmd(_query: string, output: FakeElement) {
      await search.promise;
      output.createDiv({ text: "late search" });
    },
  };

  box.input.value = "no local match";
  const searchRun = box.execute();
  box.input.value = ">run";
  await box.execute();
  search.resolve();
  await searchRun;

  assert.equal(commandRuns, 1);
  assert.equal(box.resultPanel.hidden, true);
  assert.deepEqual(box.results.visibleText(), []);
});

test("submitting +, captures, and commands clears a pending @ result shell", async () => {
  for (const next of [
    {
      query: "+Quick note",
      setup(box: Harness) { box.createQuickNote = async () => {}; },
    },
    {
      query: "https://example.com/article",
      setup(box: Harness) {
        box.plugin.captureWithOmd = async () => {};
      },
    },
    {
      query: "/fixtures/简体中文.png",
      setup(box: Harness) {
        box.plugin.openCaptureModal = () => {};
      },
    },
    {
      query: ">run",
      setup(box: Harness) {
        box.commands = {
          listCommands: () => [{ id: "app:command", name: "Run command" }],
          executeCommandById: () => true,
        };
      },
    },
  ]) {
    const pending = deferred<void>();
    let signal: AbortSignal | undefined;
    const box = omniboxHarness((query) => query.startsWith("https://") || query.startsWith("/"));
    box.plugin = {
      settings: {},
      async askOmd(_query: string, output: FakeElement, requestSignal: AbortSignal) {
        signal = requestSignal;
        output.createDiv({ text: "Loading answer" });
        await pending.promise;
        output.createDiv({ text: "late answer" });
      },
    };
    next.setup(box);

    box.input.value = "@question";
    const answerRun = box.execute();
    assert.equal(box.resultPanel.hidden, false, next.query);
    assert.deepEqual(box.results.visibleText(), ["Loading answer"], next.query);

    box.input.value = next.query;
    await box.execute();

    assert.equal(signal?.aborted, true, next.query);
    assert.equal(box.resultPanel.hidden, true, next.query);
    assert.deepEqual(box.results.visibleText(), [], next.query);

    pending.resolve();
    await answerRun;
    assert.equal(box.resultPanel.hidden, true, next.query);
    assert.deepEqual(box.results.visibleText(), [], next.query);
  }
});

test("disposing an Omnibox aborts its pending OMD search request", async () => {
  const pending = deferred<void>();
  let signal: AbortSignal | undefined;
  const box = omniboxHarness();
  box.searchVault = () => [];
  box.plugin = {
    settings: {},
    async searchWithOmd(_query: string, output: FakeElement, requestSignal: AbortSignal) {
      signal = requestSignal;
      await pending.promise;
      output.createDiv({ text: "late search" });
    },
  };
  box.input.value = "no local match";
  const run = box.execute();
  box.dispose();
  assert.equal(signal?.aborted, true);
  pending.resolve();
  await run;
  assert.deepEqual(box.results.visibleText(), []);
});

test("aborting a cloud @ request closes obsolete consent without sending evidence", async () => {
  const decision = deferred<boolean>();
  const opened = deferred<void>();
  const notices: string[] = [];
  let closed = 0;
  let executions = 0;
  const plugin = loadMethods("src/main.ts", ["askOmd", "assertCloudConsentStillCurrent"], {
    cloudAnswerPermissionEnabled: () => true,
    selectedAiModel: () => "gpt-test",
    aiProviderLabel: () => "OpenAI API",
    isAbortError: (error: unknown) => error instanceof Error && error.name === "AbortError",
    Notice: class { constructor(value: string) { notices.push(value); } },
    CloudAnswerConsentModal: class {
      openAndWait() { opened.resolve(); return decision.promise; }
      close() { closed += 1; decision.resolve(false); }
    },
  });
  Object.assign(plugin, {
    unloaded: false,
    settings: { aiProvider: "openai", aiModels: { openai: "gpt-test" } },
    cloudAnswerConsentGeneration: 0,
    cloudAnswerConsentModals: new Set(),
    assertCloudPreviewStillCurrent() {},
    qaRetrievalOptions: () => ({}),
    requireReadyOmdExecutable: async () => "/Applications/OMD/bin/omd",
    previewCloudAnswer: async () => ({
      provider: "openai",
      model: "gpt-test",
      endpoint: "http://localhost:11434",
      retrieval: {},
      preview: {
        evidence: [{ path: "Note.md", title: "Note", evidence: "Approved excerpt", score: 1 }],
        preview: {
          model: "gpt-test",
          destination_domain: "api.openai.com",
          estimated_input_tokens: 10,
          character_count: 40,
          data_handling_summary: "Selected excerpts only",
          policy_url: null,
        },
      },
    }),
    executeCloudAnswer: async () => { executions += 1; return { text: "obsolete", evidence: [] }; },
    clearIssue() {},
    recordIssue() {},
    setLocalAiFeedback() {},
    reportLocalAiWorkflowIssue() {},
    renderAiAnswer() {},
  });
  const output = new FakeElement();
  const controller = new AbortController();
  const answer = plugin.askOmd("Q1", output, controller.signal);
  await opened.promise;
  controller.abort();
  await answer;

  assert.equal(closed, 1);
  assert.equal(executions, 0);
  assert.equal(plugin.cloudAnswerConsentModals.size, 0);
  assert.deepEqual(notices, []);
  assert.deepEqual(output.visibleText(), []);
});

test("changing a cloud route away and back invalidates an already-open approval", async () => {
  const decision = deferred<boolean>();
  const opened = deferred<void>();
  let closed = 0;
  let executions = 0;
  const plugin = loadMethods("src/main.ts", [
    "askOmd",
    "assertCloudConsentStillCurrent",
    "invalidateCloudAnswerConsent",
  ], {
    cloudAnswerPermissionEnabled: () => true,
    selectedAiModel: () => "gpt-test",
    aiProviderLabel: () => "OpenAI API",
    isAbortError: () => false,
    LocalAiError: class LocalAiError extends Error {
      constructor(_code: string, detail: string) { super(detail); }
    },
    Notice: class {},
    CloudAnswerConsentModal: class {
      openAndWait() { opened.resolve(); return decision.promise; }
      close() { closed += 1; }
    },
  });
  Object.assign(plugin, {
    unloaded: false,
    settings: { aiProvider: "openai", aiModels: { openai: "gpt-test" } },
    cloudAnswerConsentGeneration: 0,
    cloudAnswerConsentModals: new Set(),
    qaRetrievalOptions: () => ({}),
    requireReadyOmdExecutable: async () => "/Applications/OMD/bin/omd",
    previewCloudAnswer: async () => ({
      provider: "openai",
      model: "gpt-test",
      endpoint: "http://localhost:11434",
      retrieval: {},
      preview: {
        evidence: [{ path: "Note.md", title: "Note", evidence: "Approved excerpt", score: 1 }],
        preview: {
          model: "gpt-test",
          destination_domain: "api.openai.com",
          estimated_input_tokens: 10,
          character_count: 40,
          data_handling_summary: "Selected excerpts only",
          policy_url: null,
        },
      },
    }),
    assertCloudPreviewStillCurrent() {},
    executeCloudAnswer: async () => { executions += 1; return { text: "stale", evidence: [] }; },
    clearIssue() {},
    recordIssue() {},
    setLocalAiFeedback() {},
    reportLocalAiWorkflowIssue() {},
    renderAiAnswer() {},
  });
  const output = new FakeElement();
  const answer = plugin.askOmd("Q1", output);
  await opened.promise;
  plugin.invalidateCloudAnswerConsent();
  plugin.invalidateCloudAnswerConsent();
  decision.resolve(true);
  await answer;

  assert.equal(closed, 1);
  assert.equal(executions, 0);
  assert.equal(plugin.cloudAnswerConsentModals.size, 0);
});
