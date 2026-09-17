import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import * as capture from "../src/capture-request.ts";
import { omdCaptureArgs } from "../src/omd-events.ts";
import { captureSourceFromDataTransfer, isLocalImageSource, normalizeCaptureSource } from "../src/omnibox-utils.ts";

type Harness = Record<string, any>;

class ElementMock {
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  focused = false;
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
  addClass(value: string) { this.classes.push(value); }
  toggleClass(value: string, active: boolean) { if (active) this.addClass(value); }
  setText(value: string) { this.textContent = value; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  removeAttribute(name: string) { delete this.attributes[name]; }
  addEventListener(name: string, callback: (event: Harness) => void) { this.listeners[name] = callback; }
  focus() { this.focused = true; }
  empty() { this.children = []; }
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
        inputEl: element, buttonEl: element, kind, label: "", disabled: false, value: "", options: {},
        setPlaceholder() { return this; },
        setValue(value: unknown) { this.value = value; element.value = String(value); return this; },
        setDisabled(value: boolean) { this.disabled = value; return this; },
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
    ...capture, captureSourceFromDataTransfer, isLocalImageSource, normalizeCaptureSource,
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
  const modal = new harness.CaptureModal({}, capture.createCaptureRequest({ source }), availability, "local-writing-model", callback) as Harness;
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
    assert.equal(request?.source, normalizeCaptureSource(source));
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

test("Enter respects IME composition and corrected input clears validation", async () => {
  let calls = 0;
  const harness = captureModal("", async () => { calls += 1; });
  await harness.button("Capture").click();
  const source = harness.settings.find((item) => item.name === "URL or file path")!.controls[0];
  source.change("/tmp/中文.pdf");
  assert.equal(harness.modal.sourceError.hidden, true);
  assert.equal(source.inputEl.attributes["aria-invalid"], undefined);
  source.inputEl.listeners.keydown({ key: "Enter", isComposing: true, preventDefault() {} });
  assert.equal(calls, 0);
  source.inputEl.listeners.keydown({ key: "Enter", isComposing: false, preventDefault() {} });
  assert.equal(calls, 1);
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
  const source = harness.settings.find((setting) => setting.name === "URL or file path")!.controls[0];
  source.change("/fixtures/简体中文-2.png");
  await harness.button("Capture").click();
  assert.equal(submitted.length, 1);
  const args = omdCaptureArgs(submitted[0]!, "/isolated-vault");
  assert.equal(args[args.indexOf("--ocr-lang") + 1], "chi_sim+eng");
  assert.equal(args.includes("--whisper-lang"), false);
  assert.equal(submitted[0]!.source, "/fixtures/简体中文-2.png");
});
