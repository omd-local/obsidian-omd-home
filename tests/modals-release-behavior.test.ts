import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import * as capture from "../src/capture-request.ts";
import { omdCaptureArgs } from "../src/omd-events.ts";
import * as omniboxUtils from "../src/omnibox-utils.ts";

type Harness = Record<string, any>;

class ElementMock {
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  focused = false;
  removed = false;
  classes: string[] = [];
  attributes: Record<string, string> = {};
  children: ElementMock[] = [];
  listeners: Record<string, (event: Harness) => void> = {};
  tag: string;
  constructor(tag = "div") { this.tag = tag; }
  createEl(tag: string, options: Harness = {}): ElementMock {
    const element = new ElementMock(tag);
    element.textContent = options.text ?? "";
    element.classes = options.cls?.split(" ") ?? [];
    element.attributes = { ...options.attr };
    this.children.push(element);
    return element;
  }
  createDiv(options: Harness = {}) { return this.createEl("div", options); }
  createSpan(options: Harness = {}) { return this.createEl("span", options); }
  addClass(...values: string[]) { for (const value of values) if (!this.classes.includes(value)) this.classes.push(value); }
  removeClass(...values: string[]) { this.classes = this.classes.filter((value) => !values.includes(value)); }
  toggleClass(value: string, active: boolean) { if (active) this.addClass(value); else this.removeClass(value); }
  setText(value: string) { this.textContent = value; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  removeAttribute(name: string) { delete this.attributes[name]; }
  addEventListener(name: string, callback: (event: Harness) => void) { this.listeners[name] = callback; }
  focus() { this.focused = true; }
  empty() { this.children = []; }
  remove() { this.removed = true; }
  descendants(): ElementMock[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
}

function loadModals() {
  const notices: string[] = [];
  const settings: Harness[] = [];
  const timers = new Map<number, () => void>();
  const openedUrls: string[] = [];
  class Modal {
    modalEl = new ElementMock();
    titleEl = new ElementMock();
    contentEl = new ElementMock();
    isOpen = false;
    constructor(_app: unknown) {}
    open() { this.isOpen = true; (this as unknown as Harness).onOpen(); }
    close() { this.isOpen = false; (this as unknown as Harness).onClose(); }
  }
  class Setting {
    settingEl: ElementMock;
    name = "";
    controls: Harness[] = [];
    constructor(parent: ElementMock) { this.settingEl = parent.createDiv(); settings.push(this); }
    setName(value: string) { this.name = value; return this; }
    setDesc(_value: string) { return this; }
    setHeading() { return this; }
    control(kind: string, configure: (value: Harness) => void) {
      const element = new ElementMock(kind);
      const control: Harness = {
        inputEl: element, buttonEl: element, selectEl: element, toggleEl: element,
        kind, label: "", disabled: false, value: "", options: {},
        setPlaceholder() { return this; },
        setValue(value: unknown) { this.value = value; element.value = String(value); return this; },
        setDisabled(value: boolean) { this.disabled = value; element.disabled = value; return this; },
        setButtonText(value: string) { this.label = value; return this; },
        setCta() { return this; },
        addOption(value: string, label: string) { this.options[value] = label; return this; },
        onChange(callback: (value: unknown) => void) { this.change = callback; return this; },
        onClick(callback: () => unknown) { this.click = callback; return this; },
      };
      this.controls.push(control);
      configure(control);
      return this;
    }
    addText(fn: (value: Harness) => void) { return this.control("text", fn); }
    addTextArea(fn: (value: Harness) => void) { return this.control("textarea", fn); }
    addToggle(fn: (value: Harness) => void) { return this.control("toggle", fn); }
    addDropdown(fn: (value: Harness) => void) { return this.control("dropdown", fn); }
    addButton(fn: (value: Harness) => void) { return this.control("button", fn); }
  }
  const file = ts.createSourceFile("modals.ts", readFileSync(resolve("src/modals.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const source = file.statements.filter((node) => !ts.isImportDeclaration(node))
    .map((node) => node.getText(file).replace(/^export /u, "")).join("\n");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const dependencies = {
    Modal, Setting, Notice: class { constructor(value: string) { notices.push(value); } },
    ...capture, ...omniboxUtils,
    window: {
      setTimeout(callback: () => void) { const id = timers.size + 1; timers.set(id, callback); return id; },
      clearTimeout(id: number) { timers.delete(id); },
      open(url: string) { openedUrls.push(url); },
    },
  };
  const classes = new Function(...Object.keys(dependencies), `${compiled}\nreturn {CaptureModal, CloudAnswerConsentModal};`)(...Object.values(dependencies)) as {
    CaptureModal: new (...args: any[]) => Harness;
    CloudAnswerConsentModal: new (...args: any[]) => Harness;
  };
  return {
    ...classes, notices, settings, timers, openedUrls,
    button(label: string): Harness {
      const button = settings.flatMap((setting) => setting.controls).filter((control) => control.label === label).at(-1);
      assert.ok(button, `Missing button ${label}`);
      return button;
    },
  };
}

const availability: capture.CaptureLanguageAvailability = {
  status: "supported", message: "", ocrPresets: [{ value: "eng", label: "English" }, { value: "chi_sim+eng", label: "Chinese and English" }],
  customOcr: true, ocrBackendAvailable: true, ocrInstalledPacks: ["eng", "chi_sim"], asrAutoDetect: true, asrExplicit: true,
};

function captureModal(source = "", callback: (request: capture.CaptureRequest) => Promise<void> = async () => {}) {
  const harness = loadModals();
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source }),
    { douyinCookiesPath: "", xhsCookiesPath: "" },
    availability,
    "local-writing-model",
    async () => {},
    callback,
  ) as Harness;
  modal.open();
  return { ...harness, modal };
}

test("empty capture provides visible validation and keeps the draft open", async () => {
  let calls = 0;
  const harness = captureModal(" ", async () => { calls += 1; });
  await harness.button("Capture").click();
  assert.equal(calls, 0);
  assert.equal(harness.modal.isOpen, true);
  const error = harness.modal.contentEl.descendants().find((node: ElementMock) => node.attributes.role === "alert");
  assert.ok(error);
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /URL|file path/u);
  assert.equal(harness.modal.sourceInput.focused, true);
});

test("malformed URLs and non-path text never start capture", async () => {
  for (const source of ["https://", "https:// bad host/article", "not a file path", "javascript:alert(1)"]) {
    let calls = 0;
    const harness = captureModal(source, async () => { calls += 1; });
    await harness.button("Capture").click();
    assert.equal(calls, 0, source);
    assert.equal(harness.modal.isOpen, true);
  }
});

test("capture preserves long Unicode file paths and web addresses", async () => {
  for (const source of [
    '"/Users/test/研究 项目/' + "长文件名".repeat(30) + '.pdf"',
    "file:///Users/test/%E7%A0%94%E7%A9%B6%20notes.pdf",
    "https://example.com/研究?title=dense%20and%20sparse#概念",
    "~/研究/文件.pdf",
  ]) {
    let request: capture.CaptureRequest | undefined;
    const harness = captureModal(source, async (value) => { request = value; });
    await harness.button("Capture").click();
    assert.equal(request?.source, omniboxUtils.normalizeCaptureSource(source));
    assert.equal(harness.modal.isOpen, false);
  }
});

test("a pending capture cannot be submitted twice", async () => {
  let resolveCapture!: () => void;
  const pending = new Promise<void>((resolvePromise) => { resolveCapture = resolvePromise; });
  let calls = 0;
  const harness = captureModal("/tmp/file.pdf", async () => { calls += 1; await pending; });
  const button = harness.button("Capture");
  const first = button.click();
  const second = button.click();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveCapture();
  await Promise.all([first, second]);
});

test("unexpected callback failure restores the draft and allows retry", async () => {
  let calls = 0;
  const harness = captureModal("/tmp/研究.pdf", async () => {
    calls += 1;
    if (calls === 1) throw new Error("Writer unavailable");
  });
  harness.modal.tags = "研究, project/notes";
  harness.modal.polish = true;
  await assert.doesNotReject(async () => harness.button("Capture").click());
  assert.equal(harness.modal.isOpen, true);
  assert.ok(harness.notices.some((notice) => notice.includes("Writer unavailable")));
  assert.equal(harness.modal.sourceInput.value, "/tmp/研究.pdf");
  assert.equal(harness.modal.tags, "研究, project/notes");
  assert.equal(harness.modal.polish, true);
  await harness.button("Capture").click();
  assert.equal(calls, 2);
  assert.equal(harness.modal.isOpen, false);
});

test("Cancel discards modal choices without capture or a detached focus timer", () => {
  let calls = 0;
  const harness = captureModal("/tmp/file.pdf", async () => { calls += 1; });
  harness.modal.polish = true;
  harness.button("Cancel").click();
  assert.equal(calls, 0);
  assert.equal(harness.modal.isOpen, false);
  assert.equal(harness.timers.size, 0);
});

test("capture submits user-selected tags, polish, review, OCR, and speech options", async () => {
  let request: capture.CaptureRequest | undefined;
  const harness = captureModal("/tmp/识别.png", async (value) => { request = value; });
  const choose = (name: string, value: unknown) => {
    const setting = harness.settings.find((item) => item.name === name);
    assert.ok(setting, name);
    setting.controls[0].change(value);
  };
  choose("Tags", "  研究, project/notes,  ");
  choose("Polish Markdown", true);
  choose("Review links and tags", true);
  choose("Image text language", "chi_sim+eng");
  choose("Speech language", "auto-detect");
  await harness.button("Capture").click();
  assert.deepEqual(request?.tags, ["研究", "project/notes"]);
  assert.equal(request?.polish, true);
  assert.equal(request?.suggest, true);
  assert.deepEqual(request?.ocr, { mode: "preset", language: "chi_sim+eng" });
  assert.deepEqual(request?.asr, { mode: "auto-detect" });
});

test("textarea Enter stays multiline while Cmd/Ctrl+Enter submits outside IME composition", async () => {
  let calls = 0;
  const harness = captureModal("", async () => { calls += 1; });
  await harness.button("Capture").click();
  const source = harness.settings.find((item) => item.name === "URL, share text, or file path")!.controls[0];
  source.change("/tmp/中文.pdf");
  assert.equal(harness.modal.sourceError.hidden, true);
  assert.equal(source.inputEl.attributes["aria-invalid"], undefined);
  let prevented = false;
  source.inputEl.listeners.keydown({ key: "Enter", isComposing: false, metaKey: false, ctrlKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(calls, 0);
  source.inputEl.listeners.keydown({ key: "Enter", isComposing: true, metaKey: true, ctrlKey: false, preventDefault() { prevented = true; } });
  assert.equal(calls, 0);
  source.inputEl.listeners.keydown({ key: "Enter", isComposing: false, metaKey: true, ctrlKey: false, preventDefault() { prevented = true; } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(prevented, true);
  assert.equal(calls, 1);
});

test("pasting a supported social share message into a blank modal reveals Site access", () => {
  const harness = captureModal("");
  assert.equal(harness.modal.sourceAccessDetails.open, false);
  const source = harness.settings.find((item) => item.name === "URL, share text, or file path")!.controls[0];
  source.change("复制此链接 https://v.douyin.com/abc/ 打开抖音");
  assert.equal(harness.modal.sourceAccessDetails.open, true);
});

test("dropping a local file fills its normalized Unicode path without capturing", () => {
  let calls = 0;
  const harness = captureModal("", async () => { calls += 1; });
  harness.modal.dropZone.listeners.drop({
    preventDefault() {},
    dataTransfer: { files: [{ path: "/tmp/文件 名.pdf" }], getData() { return ""; } },
  });
  assert.equal(harness.modal.sourceInput.value, "/tmp/文件 名.pdf");
  assert.equal(calls, 0);
});

test("capture cancellation does not reopen a dismissed modal as an error", async () => {
  const harness = captureModal("/tmp/file.pdf", async () => { throw new DOMException("Cancelled", "AbortError"); });
  await harness.button("Capture").click();
  assert.equal(harness.modal.isOpen, false);
  assert.deepEqual(harness.notices, []);
});

test("social capture preflight keeps the modal open on failure and submits both current path drafts on success", async () => {
  const harness = loadModals();
  const rawSource = "复制此链接 https://v.douyin.com/abc123/ 打开抖音";
  const preflights: Array<{ request: capture.CaptureRequest; cookiesPath: string }> = [];
  const captures: Array<{ request: capture.CaptureRequest; access: Harness }> = [];
  let rejectPreflight = true;
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source: rawSource }),
    {
      douyinCookiesPath: "/Users/test/抖音 access/cookies.txt",
      xhsCookiesPath: "/Users/test/小红书 access/cookies.txt",
    },
    availability,
    "local-writing-model",
    async (request: capture.CaptureRequest, cookiesPath: string) => {
      preflights.push({ request, cookiesPath });
      if (rejectPreflight) throw new Error("The Douyin cookies have expired. Sign in again, export fresh cookies, then retry.");
    },
    async (request: capture.CaptureRequest, access: Harness) => { captures.push({ request, access }); },
  ) as Harness;
  modal.open();

  const sourceFocusedBefore = modal.sourceInput.focused;
  await harness.button("Capture").click();
  assert.equal(modal.isOpen, true);
  assert.equal(captures.length, 0);
  assert.equal(preflights[0]?.request.source, "https://v.douyin.com/abc123/");
  assert.equal(preflights[0]?.request.submittedSource, rawSource);
  assert.equal(preflights[0]?.cookiesPath, "/Users/test/抖音 access/cookies.txt");
  assert.match(modal.sourceAccessStatus.textContent, /expired/u);
  assert.equal(modal.sourceInput.attributes["aria-invalid"], undefined);
  assert.equal(modal.sourceInput.focused, sourceFocusedBefore, "site access errors do not move focus to the valid source");

  rejectPreflight = false;
  await harness.button("Capture").click();
  assert.equal(modal.isOpen, false);
  assert.equal(captures.length, 1);
  assert.deepEqual(captures[0]?.access, {
    douyinCookiesPath: "/Users/test/抖音 access/cookies.txt",
    xhsCookiesPath: "/Users/test/小红书 access/cookies.txt",
  });
});

test("cookie path syntax errors target Site access without invalidating a valid source", async () => {
  const harness = loadModals();
  let captures = 0;
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source: "https://v.douyin.com/abc/" }),
    { douyinCookiesPath: "relative/cookies.txt", xhsCookiesPath: "" },
    availability,
    "local-writing-model",
    async () => {},
    async () => { captures += 1; },
  ) as Harness;
  modal.open();
  modal.sourceInput.focused = false;
  await harness.button("Capture").click();

  assert.equal(captures, 0);
  assert.equal(modal.isOpen, true);
  assert.equal(modal.sourceInput.attributes["aria-invalid"], undefined);
  assert.equal(modal.sourceInput.focused, false);
  assert.equal(modal.cookieInputs.douyin.attributes["aria-invalid"], "true");
  assert.equal(modal.cookieInputs.douyin.attributes["aria-describedby"], "omd-capture-source-access-status");
  assert.equal(modal.cookieInputs.douyin.focused, true);
  assert.match(modal.sourceAccessStatus.textContent, /absolute local cookies\.txt path/u);
  assert.equal(modal.sourceAccessStatus.attributes.role, "alert");
  assert.ok(modal.sourceAccessStatus.classes.includes("is-warning"));
});

test("cookie path rows accept one dropped local file and explain ambiguous drops", async () => {
  const harness = loadModals();
  const preflightPaths: string[] = [];
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source: "https://v.douyin.com/abc/" }),
    { douyinCookiesPath: "", xhsCookiesPath: "" },
    availability,
    "local-writing-model",
    async (_request: capture.CaptureRequest, cookiesPath: string) => { preflightPaths.push(cookiesPath); },
    async () => {},
  ) as Harness;
  modal.open();
  const row = harness.settings.find((setting) => setting.name === "Douyin cookies");
  assert.ok(row);
  row.settingEl.listeners.drop({
    preventDefault() {},
    dataTransfer: {
      files: [{ path: "/Users/test/抖音 access/douyin cookies.txt" }],
      getData() { return ""; },
    },
  });
  assert.equal(row.controls[0].value, "/Users/test/抖音 access/douyin cookies.txt");
  await harness.button("Capture").click();
  assert.deepEqual(preflightPaths, ["/Users/test/抖音 access/douyin cookies.txt"]);

  const invalidHarness = captureModal("https://v.douyin.com/abc/");
  const invalidRow = invalidHarness.settings.find((setting) => setting.name === "Douyin cookies");
  assert.ok(invalidRow);
  invalidRow.settingEl.listeners.drop({
    preventDefault() {},
    dataTransfer: {
      files: [{ path: "/tmp/one.txt" }, { path: "/tmp/two.txt" }],
      getData() { return ""; },
    },
  });
  assert.match(invalidHarness.modal.sourceAccessStatus.textContent, /one local cookies\.txt file/u);
  assert.equal(invalidHarness.modal.sourceAccessStatus.attributes.role, "alert");
  assert.ok(invalidHarness.modal.sourceAccessStatus.classes.includes("is-warning"));
});

test("capture validates only the active social provider and preserves invalid unrelated drafts", async () => {
  const cases = [
    {
      source: "https://v.douyin.com/abc/",
      active: "douyin",
      invalid: "xhs",
      selectedPath: "/saved/douyin cookies.txt",
    },
    {
      source: "https://xhslink.com/a/abc/",
      active: "xhs",
      invalid: "douyin",
      selectedPath: "/saved/xhs cookies.txt",
    },
    {
      source: "https://example.com/article",
      active: null,
      invalid: "both",
      selectedPath: "",
    },
  ] as const;
  for (const scenario of cases) {
    const harness = loadModals();
    const preflightPaths: string[] = [];
    const captures: Harness[] = [];
    const initialAccess = {
      douyinCookiesPath: "/saved/douyin cookies.txt",
      xhsCookiesPath: "/saved/xhs cookies.txt",
    };
    const modal = new harness.CaptureModal(
      {},
      capture.createCaptureRequest({ source: scenario.source }),
      initialAccess,
      availability,
      "local-writing-model",
      async (_request: capture.CaptureRequest, cookiesPath: string) => {
        preflightPaths.push(cookiesPath);
        return scenario.active === "xhs" ? { cookieRuntimeRecheck: true } : undefined;
      },
      async (_request: capture.CaptureRequest, access: Harness) => { captures.push(access); },
    ) as Harness;
    modal.open();
    if (scenario.invalid === "xhs" || scenario.invalid === "both") {
      const setting = harness.settings.find((entry) => entry.name === "Xiaohongshu / Rednote cookies");
      assert.ok(setting);
      await setting.controls[0].change("relative/invalid-xhs.txt");
    }
    if (scenario.invalid === "douyin" || scenario.invalid === "both") {
      const setting = harness.settings.find((entry) => entry.name === "Douyin cookies");
      assert.ok(setting);
      await setting.controls[0].change("relative/invalid-douyin.txt");
    }
    await harness.button("Capture").click();
    assert.deepEqual(preflightPaths, [scenario.selectedPath], scenario.source);
    assert.deepEqual(captures, [initialAccess], scenario.source);
    assert.equal(modal.isOpen, false, scenario.source);
  }
});

test("XHS shortlink preflight gives one nonblocking redirect recheck note", async () => {
  const harness = loadModals();
  let captures = 0;
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source: "复制 https://xhslink.com/a/abc/ 打开小红书" }),
    { douyinCookiesPath: "", xhsCookiesPath: "/saved/xhs cookies.txt" },
    availability,
    "local-writing-model",
    async () => ({ cookieRuntimeRecheck: true }),
    async () => { captures += 1; },
  ) as Harness;
  modal.open();
  await harness.button("Capture").click();
  assert.equal(captures, 1);
  assert.deepEqual(harness.notices, [
    "Site access checked. Access will be checked again after redirect.",
  ]);
  assert.doesNotMatch(harness.notices[0], /xhslink|\/saved|cookies\.txt/u);
});

test("direct XHS capture confirms preflight before handing off", async () => {
  const harness = loadModals();
  let captures = 0;
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source: "https://www.xiaohongshu.com/explore/abc" }),
    { douyinCookiesPath: "", xhsCookiesPath: "/saved/xhs cookies.txt" },
    availability,
    "local-writing-model",
    async () => ({ cookieRuntimeRecheck: false }),
    async () => { captures += 1; },
  ) as Harness;
  modal.open();
  await harness.button("Capture").click();
  assert.equal(captures, 1);
  assert.deepEqual(harness.notices, ["Site access checked. Starting capture."]);
});

test("Douyin capture confirms preflight before handing off", async () => {
  const harness = loadModals();
  let captures = 0;
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source: "复制 https://v.douyin.com/abc/ 打开抖音" }),
    { douyinCookiesPath: "/saved/douyin cookies.txt", xhsCookiesPath: "" },
    availability,
    "local-writing-model",
    async () => {},
    async () => { captures += 1; },
  ) as Harness;
  modal.open();
  await harness.button("Capture").click();
  assert.equal(captures, 1);
  assert.deepEqual(harness.notices, ["Site access checked. Starting capture."]);
});

test("pending social preflight locks mutable fields and a late busy race reopens the unchanged draft", async () => {
  const harness = loadModals();
  let releasePreflight!: () => void;
  const preflight = new Promise<void>((resolve) => { releasePreflight = resolve; });
  const captured: capture.CaptureRequest[] = [];
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source: "复制 https://v.douyin.com/abc/ 打开抖音", tags: ["before"] }),
    { douyinCookiesPath: "/Users/test/抖音 cookies.txt", xhsCookiesPath: "" },
    availability,
    "local-writing-model",
    async () => { await preflight; },
    async (request: capture.CaptureRequest) => {
      captured.push(request);
      throw new Error("Another OMD action started while this source was being checked. Your capture draft is still open; try again when it finishes.");
    },
  ) as Harness;
  modal.open();
  const captureButton = harness.button("Capture");
  const submission = captureButton.click();
  await Promise.resolve();

  assert.equal(modal.modalEl.attributes["aria-busy"], "true");
  assert.equal(modal.sourceInput.disabled, true);
  assert.equal(modal.cookieInputs.douyin.disabled, true);
  const douyinCookies = harness.settings.find((item) => item.name === "Douyin cookies")!;
  assert.equal(douyinCookies.settingEl.attributes["aria-disabled"], "true");
  douyinCookies.settingEl.listeners.drop({
    preventDefault() {},
    dataTransfer: {
      files: [{ path: "/Users/test/replacement-cookies.txt" }],
      getData() { return ""; },
    },
  });
  assert.equal(douyinCookies.controls[0].value, "/Users/test/抖音 cookies.txt");
  assert.equal(harness.settings.find((item) => item.name === "Tags")!.controls[0].inputEl.disabled, true);
  assert.equal(harness.settings.find((item) => item.name === "Polish Markdown")!.controls[0].disabled, true);
  assert.match(modal.sourceAccessStatus.textContent, /Checking site access/u);
  assert.equal(modal.sourceAccessStatus.attributes.role, "status");
  assert.ok(modal.sourceAccessStatus.classes.includes("is-checking"));

  releasePreflight();
  await submission;
  assert.equal(captured[0]?.source, "https://v.douyin.com/abc/");
  assert.deepEqual(captured[0]?.tags, ["before"]);
  assert.equal(modal.isOpen, true);
  assert.equal(modal.sourceInput.value, "复制 https://v.douyin.com/abc/ 打开抖音");
  assert.equal(modal.sourceInput.disabled, false);
  assert.equal(modal.modalEl.attributes["aria-busy"], undefined);
  assert.equal(douyinCookies.settingEl.attributes["aria-disabled"], undefined);
  assert.ok(harness.notices.some((notice) => /draft is still open/u.test(notice)));
});

test("closing the capture modal aborts social preflight before capture can start", async () => {
  const harness = loadModals();
  let captureCalls = 0;
  let observedSignal: AbortSignal | undefined;
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source: "复制 https://v.douyin.com/abc/ 打开抖音" }),
    { douyinCookiesPath: "/Users/test/douyin.txt", xhsCookiesPath: "" },
    availability,
    "local-writing-model",
    async (_request: capture.CaptureRequest, _path: string, signal: AbortSignal) => {
      observedSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
      });
    },
    async () => { captureCalls += 1; },
  ) as Harness;
  modal.open();
  const submission = harness.button("Capture").click();
  await Promise.resolve();
  harness.button("Cancel").click();
  await submission;

  assert.equal(observedSignal?.aborted, true);
  assert.equal(captureCalls, 0);
  assert.equal(modal.isOpen, false);
  assert.deepEqual(harness.notices, []);
});

test("social cookie Clear appears after entry and hides after clearing without a rerender", async () => {
  const harness = loadModals();
  const modal = new harness.CaptureModal(
    {},
    capture.createCaptureRequest({ source: "https://xhslink.com/a/abc" }),
    { douyinCookiesPath: "", xhsCookiesPath: "/Users/test/小红书 cookies.txt" },
    availability,
    "local-writing-model",
    async () => {},
    async () => {},
  ) as Harness;
  modal.open();
  const settingsBefore = harness.settings.length;
  const xhs = harness.settings.find((setting) => setting.name === "Xiaohongshu / Rednote cookies");
  assert.ok(xhs);
  assert.equal(xhs.controls[0].value, "/Users/test/小红书 cookies.txt");
  assert.equal(xhs.controls[1].buttonEl.hidden, false);
  await xhs.controls[1].click();
  assert.equal(xhs.controls[0].value, "");
  assert.equal(xhs.controls[1].buttonEl.hidden, true);
  assert.equal(modal.cookieInputs.xhs.focused, true);
  assert.equal(harness.settings.length, settingsBefore);

  await xhs.controls[0].change("/Users/test/new-xhs-cookies.txt");
  assert.equal(xhs.controls[1].buttonEl.hidden, false);
});

function consentModal() {
  const harness = loadModals();
  const excerpt = "  第一段\n\nSecond paragraph.\n";
  const modal = new harness.CloudAnswerConsentModal({}, {
    question: "What is relevant?", provider: "OpenAI", model: "example-model", destination_domain: "api.openai.com",
    estimated_input_tokens: 10, character_count: excerpt.length, data_handling_summary: "Provider policy applies.",
    policy_url: "https://openai.com/policies/privacy-policy/",
    evidence: [{ title: "研究", path: "Notes/研究.md", evidence: excerpt }],
  }) as Harness;
  return { ...harness, modal, excerpt };
}

test("cloud consent dismissal denies and Send requires an explicit button click", async () => {
  const dismissed = consentModal();
  const denied = dismissed.modal.openAndWait();
  dismissed.modal.close();
  assert.equal(await denied, false);

  const approved = consentModal();
  const decision = approved.modal.openAndWait();
  approved.button("Send and answer").click();
  assert.equal(await decision, true);
  assert.equal(approved.modal.isOpen, false);
});

test("cloud consent shows exact excerpt whitespace and opens only the vetted policy", () => {
  const harness = consentModal();
  harness.modal.open();
  const rendered = harness.modal.contentEl.descendants().map((node: ElementMock) => node.textContent);
  assert.ok(rendered.includes(harness.excerpt));
  harness.button("Open policy").click();
  assert.deepEqual(harness.openedUrls, ["https://openai.com/policies/privacy-policy/"]);
});


test("mixed Chinese OCR reaches capture argv while speech uses No language preference", async () => {
  const submitted: capture.CaptureRequest[] = [];
  const harness = captureModal("/fixtures/简体中文.png", async (request) => { submitted.push(request); });
  const recognition = harness.modal.contentEl.descendants().find((node: ElementMock) => node.classes.includes("omd-capture-recognition"));
  assert.equal(recognition?.open, true, "Image captures show recognition options immediately");
  const ocr = harness.settings.find((setting) => setting.name === "Image text language")!.controls[0];
  const asr = harness.settings.find((setting) => setting.name === "Speech language")!.controls[0];
  ocr.change("chi_sim+eng");
  asr.change("inherit-adapter-default");
  const source = harness.settings.find((setting) => setting.name === "URL, share text, or file path")!.controls[0];
  source.change("/fixtures/简体中文-2.png");
  await harness.button("Capture").click();
  assert.equal(submitted.length, 1);
  const args = omdCaptureArgs(submitted[0]!, "/isolated-vault");
  assert.equal(args[args.indexOf("--ocr-lang") + 1], "chi_sim+eng");
  assert.equal(args.includes("--whisper-lang"), false);
  assert.equal(submitted[0]!.source, "/fixtures/简体中文-2.png");
});
