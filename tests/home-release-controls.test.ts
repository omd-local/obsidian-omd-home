import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import * as inbox from "../src/inbox.ts";
import * as layout from "../src/layout.ts";
import * as processing from "../src/processing-state.ts";
import type { WidgetPlacement } from "../src/model.ts";

const documentStub = { activeElement: null as ElementStub | null };
class ElementStub {
  children: ElementStub[] = [];
  listeners = new Map<string, (event: any) => void>();
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  style = { setProperty() {} };
  textContent = "";
  tagName = "";
  type = "";
  isConnected = true;
  ownerDocument = documentStub;
  lastFocusOptions?: FocusOptions;
  clientWidth = 1200;
  createEl(_tag: string, options: any = {}): ElementStub {
    const child = new ElementStub();
    child.tagName = _tag;
    child.textContent = options.text ?? "";
    child.attributes = options.attr ?? {};
    child.type = options.type ?? "";
    this.children.push(child);
    return child;
  }
  createDiv(options?: any) { return this.createEl("div", options); }
  createSpan(options?: any) { return this.createEl("span", options); }
  appendChild(child: ElementStub) {
    if (child.contains(documentStub.activeElement)) documentStub.activeElement = null;
    this.children = this.children.filter((element) => element !== child);
    this.children.push(child);
  }
  empty() { this.children = []; }
  contains(element: ElementStub | null): boolean { return element !== null && (element === this || this.descendants().includes(element)); }
  focus(options?: FocusOptions) { documentStub.activeElement = this; this.lastFocusOptions = options; }
  setText(text: string) { this.textContent = text; }
  addEventListener(type: string, handler: (event: any) => void) { this.listeners.set(type, handler); }
  removeEventListener(type: string) { this.listeners.delete(type); }
  addClass() {}
  removeClass() {}
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  querySelectorAll() { return []; }
  descendants(): ElementStub[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
}

const source = readFileSync(new URL("../src/home-view.ts", import.meta.url), "utf8");
const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
const module = { exports: {} };
Function("require", "module", "exports", compiled)((id: string) => {
  if (id === "obsidian") return {
    ItemView: class {
      contentEl = new ElementStub();
      app: unknown;
      constructor(leaf: { app?: unknown }) { this.app = leaf.app; }
      registerEvent() {}
    }, Notice: class {}, setIcon() {},
  };
  if (id === "./layout") return layout;
  if (id === "./inbox.ts") return inbox;
  if (id === "./ollama-app") return { canOpenOllamaDesktopApp: () => false };
  if (id === "./processing-state") return processing;
  return {};
}, module, module.exports);

interface HomeStub {
  grid: ElementStub;
  contentEl: ElementStub;
  widgetBodies: Map<string, ElementStub>;
  omniboxExpanded: boolean;
  render(): void;
  onOpen(): Promise<void>;
  onClose(): Promise<void>;
  syncWidgets(): void;
  refreshWidgets(): void;
  applyPreviewLayout(): void;
  createWidget(placement: WidgetPlacement): ElementStub;
  renderWidgetBody(id: string, body: ElementStub): void;
  renderInbox(body: ElementStub, files: unknown[]): void;
  renderFileList(body: ElementStub, files: unknown[], empty: string, showWorkflowStatus?: boolean): void;
  renderLastIssue(body: ElementStub, issueId: number): void;
  renderIndependentCaptureFailure(body: ElementStub, failure: unknown): void;
  renderLocalAiAttention(body: ElementStub): void;
  bindPointerTransform(handle: ElementStub, widget: ElementStub, id: string, mode: string): void;
  readonly captureActive: boolean;
}
const Home = (module.exports as { OmdHomeView: new (...args: unknown[]) => HomeStub }).OmdHomeView;
function makeHome() {
  const saved: WidgetPlacement[][] = [];
  const placement = { id: "today", x: 0, y: 2, w: 6, h: 6 } as const;
  const plugin = {
    deviceLayout: [{ ...placement }] as WidgetPlacement[], captureActive: false, enrichmentActive: true,
    enrichmentPhase: "review", processingEvents: [],
    isNotePinned: () => false,
    async saveDeviceLayout(next: WidgetPlacement[]) { saved.push(next); plugin.deviceLayout = next; },
  };
  const home = new Home({}, plugin);
  home.grid = new ElementStub();
  home.render = () => {};
  home.applyPreviewLayout = () => {};
  return { home, saved, placement, plugin };
}

test("widget Move grip supports ArrowRight without a pointer", async () => {
  const { home, saved, placement } = makeHome();
  const widget = home.createWidget(placement);
  const move = widget.descendants().find((element) => element.attributes["aria-label"]?.startsWith("Move Today"));
  assert.ok(move);
  move.listeners.get("keydown")?.({ key: "ArrowRight", preventDefault() {} });
  await Promise.resolve();
  assert.equal(saved.at(-1)?.find((item) => item.id === "today")?.x, 1);
});

test("repeated keyboard moves keep the grip focused after widget reparenting", async () => {
  const { home, saved, placement } = makeHome();
  const widget = home.createWidget(placement);
  const move = widget.descendants().find((element) => element.attributes["aria-label"]?.startsWith("Move Today"));
  assert.ok(move);
  home.render = () => home.syncWidgets();
  move.focus();
  for (let press = 0; press < 2; press++) {
    documentStub.activeElement?.listeners.get("keydown")?.({ key: "ArrowRight", preventDefault() {} });
    await Promise.resolve();
    assert.equal(documentStub.activeElement, move, "reparenting must not drop keyboard focus");
  }
  assert.equal(saved.at(-1)?.find((item) => item.id === "today")?.x, 2);
  assert.deepEqual(move.lastFocusOptions, { preventScroll: true });
});

test("Home clock refreshes date-relative events across midnight and stops when closed", async (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 16, 23, 59).getTime() });
  const previousWindow = globalThis.window;
  const intervals = new Map<number, () => void>();
  let nextId = 0;
  const windowStub = {
    setInterval(callback: () => void, delay: number) {
      assert.equal(delay, 60_000);
      intervals.set(++nextId, callback);
      return nextId;
    },
    clearInterval(id: number) { intervals.delete(id); },
    clearTimeout() {},
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowStub });
  try {
    const app = { vault: { on() {} }, metadataCache: { on() {} } };
    const event = (title: string, day: number, hour: number, minute: number, endMinute: number) => ({
      title, source: "vault", start: new Date(2026, 8, day, hour, minute).toISOString(),
      end: new Date(2026, 8, day, hour, endMinute).toISOString(),
    });
    const home = new Home({ app }, {
      deviceLayout: [],
      calendarEvents: [
        event("Yesterday's event", 16, 23, 50, 59),
        event("Today's event", 17, 12, 0, 30),
        event("New upcoming event", 24, 0, 0, 30),
      ],
    });
    const today = new ElementStub();
    const upcoming = new ElementStub();
    const omnibox = new ElementStub();
    const draft = omnibox.createEl("input", { text: "研究 / بحث" });
    home.widgetBodies.set("today", today);
    home.widgetBodies.set("upcoming", upcoming);
    home.widgetBodies.set("omnibox", omnibox);
    const titles = (body: ElementStub) => body.descendants().filter((el) => el.attributes.dir === "auto").map((el) => el.textContent);
    let fullRefreshes = 0;
    home.syncWidgets = () => {};
    home.refreshWidgets = () => {
      fullRefreshes++;
      for (const [id, body] of [["today", today], ["upcoming", upcoming]] as const) {
        body.empty();
        home.renderWidgetBody(id, body);
      }
    };
    await home.onOpen();
    draft.focus();
    assert.deepEqual(titles(today), ["Yesterday's event"]);
    assert.deepEqual(titles(upcoming), ["Yesterday's event", "Today's event"]);
    const heading = home.contentEl.descendants().find((element) => element.tagName === "h1");
    const date = home.contentEl.descendants().find((element) => element.tagName === "p");
    assert.ok(heading && date);
    assert.equal(heading.textContent, "Good evening");
    const previousDate = date.textContent;
    const firstTodayRow = today.children[0];
    context.mock.timers.tick(30_000);
    for (const tick of intervals.values()) tick();
    assert.equal(today.children[0], firstTodayRow, "a same-day clock tick must not rebuild event rows");
    context.mock.timers.tick(90_000);
    assert.equal(intervals.size, 1, "the Home view needs an owned clock interval");
    for (const tick of intervals.values()) tick();
    assert.equal(heading.textContent, "Good morning");
    assert.notEqual(date.textContent, previousDate);
    assert.equal(date.textContent, new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date()));
    assert.deepEqual(titles(today), ["Today's event"]);
    assert.deepEqual(titles(upcoming), ["Today's event", "New upcoming event"]);
    assert.equal(fullRefreshes, 1, "the clock must not rebuild the full dashboard");
    assert.equal(omnibox.children[0], draft);
    assert.equal(draft.textContent, "研究 / بحث");
    assert.equal(documentStub.activeElement, draft);
    await home.onClose();
    assert.equal(intervals.size, 0);
    await home.onOpen();
    assert.equal(intervals.size, 1);
    await home.onClose();
    assert.equal(intervals.size, 0);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("pointer cancellation restores the widget layout without persisting the preview", async () => {
  const previousWindow = globalThis.window;
  const windowStub = new ElementStub();
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowStub });
  try {
    const { home, saved } = makeHome();
    const handle = new ElementStub();
    home.bindPointerTransform(handle, new ElementStub(), "today", "move");
    handle.listeners.get("pointerdown")?.({ pointerId: 1, button: 0, clientX: 0, clientY: 0, preventDefault() {} });
    windowStub.listeners.get("pointermove")?.({ pointerId: 1, clientX: 200, clientY: 100 });
    windowStub.listeners.get("pointercancel")?.({ type: "pointercancel", pointerId: 1 });
    await Promise.resolve();
    assert.equal(saved.length, 0);
  } finally {
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("a review-ready proposal does not present as a running OMD process", () => {
  const { home, plugin } = makeHome();
  assert.equal(home.captureActive, false);
  plugin.enrichmentPhase = "generating";
  assert.equal(home.captureActive, true);
  plugin.enrichmentPhase = "applied";
  assert.equal(home.captureActive, false);
  plugin.captureActive = true;
  assert.equal(home.captureActive, true);
});

test("Current task describes review and apply phases without a false startup message", () => {
  const { home, plugin } = makeHome();
  const review = new ElementStub();
  home.renderWidgetBody("processing", review);
  assert.ok(review.descendants().some((element) => element.textContent === "Ready to review"));
  plugin.enrichmentPhase = "applying";
  const applying = new ElementStub();
  home.renderWidgetBody("processing", applying);
  const messages = applying.descendants().map((element) => element.textContent);
  assert.ok(messages.includes("Applying suggestions"));
  assert.ok(!messages.includes("Starting OMD"));
});

test("long English, CJK and RTL note rows retain full paths and independent text direction", () => {
  const { home } = makeHome();
  for (const basename of ["Very long English filename ".repeat(12), "超长中文笔记标题".repeat(20), "ملاحظات البحث والمراجعة ".repeat(16)]) {
    const path = `Notes/${basename}.md`;
    const body = new ElementStub();
    home.renderFileList(body, [{ basename, path, parent: { path: "Notes" } }], "Empty");
    const elements = body.descendants();
    assert.ok(elements.some((element) => element.attributes.title === path));
    assert.ok(elements.some((element) => element.textContent === basename && element.attributes.dir === "auto"));
    assert.ok(elements.some((element) => element.attributes["aria-label"] === `Open ${basename}`));
  }
});

test("Recent notes show exact Inbox and Reviewed Properties without adding a placeholder", () => {
  const files = [
    { basename: "Captured", path: "Sources/Captured.md", parent: { path: "Sources" }, stat: { mtime: 3 } },
    { basename: "Finished", path: "Notes/Finished.md", parent: { path: "Notes" }, stat: { mtime: 2 } },
    { basename: "Ordinary", path: "Notes/Ordinary.md", parent: { path: "Notes" }, stat: { mtime: 1 } },
  ];
  const frontmatter = new Map<object, Record<string, string>>([
    [files[0], { omd_home_status: "inbox" }],
    [files[1], { omd_home_status: "reviewed" }],
    [files[2], { omd_home_status: "pending" }],
  ]);
  const app = {
    vault: { getMarkdownFiles: () => files },
    metadataCache: { getFileCache: (file: object) => ({ frontmatter: frontmatter.get(file) }) },
    workspace: { openLinkText() {} },
  };
  const home = new Home({ app }, { isNotePinned: () => false, toggleNotePinned() {} });
  const recent = new ElementStub();

  home.renderWidgetBody("recent", recent);

  const rowFor = (basename: string) => {
    const row = recent.children.find((candidate) => candidate.descendants().some((element) => element.textContent === basename));
    assert.ok(row);
    return row;
  };
  const rowText = (basename: string) => rowFor(basename).descendants().map((element) => element.textContent);
  assert.ok(rowText("Captured").includes("Inbox"));
  assert.ok(rowText("Finished").includes("Reviewed"));
  assert.ok(!rowText("Ordinary").some((text) => text === "Inbox" || text === "Reviewed"));
  assert.equal(rowFor("Captured").children[0]?.attributes["aria-label"], "Open Captured. Status: Inbox.");
  assert.equal(rowFor("Finished").children[0]?.attributes["aria-label"], "Open Finished. Status: Reviewed.");
  assert.equal(rowFor("Ordinary").children[0]?.attributes["aria-label"], "Open Ordinary");
});

test("workflow status remains a Recent-only hint", () => {
  const file = { basename: "Reviewed note", path: "Notes/Reviewed.md", parent: { path: "Notes" } };
  const app = {
    metadataCache: { getFileCache: () => ({ frontmatter: { omd_home_status: "reviewed" } }) },
    workspace: { openLinkText() {} },
  };
  const home = new Home({ app }, { isNotePinned: () => false, toggleNotePinned() {} });
  const body = new ElementStub();

  home.renderFileList(body, [file], "Empty");

  assert.ok(!body.descendants().some((element) => element.textContent === "Reviewed"));
});

test("an empty Inbox points to reviewed notes in Recent notes", () => {
  const { home } = makeHome();
  const body = new ElementStub();

  home.renderInbox(body, []);

  assert.ok(body.descendants().some((element) => element.textContent === "Reviewed notes remain available in Recent notes."));
});

test("historical issue dismissal captures the exact issue ID in an accessible button", () => {
  let dismissedIssue = 0;
  const plugin = {
    lastErrorContext: "capture",
    lastErrorAt: Date.now(),
    lastErrorSource: "https://example.com/source",
    lastError: "Capture failed",
    captureFailureForCurrentIssue: () => null,
    dismissIssue: (issueId: number) => { dismissedIssue = issueId; },
  };
  const home = new Home({}, plugin);
  const body = new ElementStub();

  home.renderLastIssue(body, 41);

  const dismiss = body.descendants().find((element) => element.attributes["aria-label"] === "Dismiss Capture failed issue");
  assert.ok(dismiss);
  assert.equal(dismiss.tagName, "button");
  assert.equal(dismiss.type, "button");
  assert.equal(dismiss.attributes.title, "Dismiss Capture failed issue");
  dismiss.listeners.get("click")?.({});
  assert.equal(dismissedIssue, 41);
});

test("independent capture retry dismissal uses the exact failure ID", () => {
  let dismissedFailure = 0;
  const home = new Home({}, {
    dismissCaptureFailure: (failureId: number) => { dismissedFailure = failureId; },
    retryFailedCapture() {},
  });
  const body = new ElementStub();

  home.renderIndependentCaptureFailure(body, {
    id: 73,
    issueId: 18,
    issueContext: "capture",
    failedAt: Date.now(),
    detail: "Capture failed",
    request: { source: "https://example.com/source" },
  });

  const dismiss = body.descendants().find((element) => element.attributes["aria-label"] === "Dismiss capture retry");
  assert.ok(dismiss);
  assert.equal(dismiss.type, "button");
  dismiss.listeners.get("click")?.({});
  assert.equal(dismissedFailure, 73);
});

test("live Local AI setup state has no historical dismissal control", () => {
  const home = new Home({}, {
    localAiState: {
      daemonCode: "daemon_unreachable",
      daemonDetail: "Ollama is not reachable",
      activeAction: "",
      workflows: {},
    },
    captureFailureForCurrentIssue: () => null,
    aiSetupBusy: () => false,
    checkLocalAiConnection() {},
  });
  const body = new ElementStub();

  home.renderLocalAiAttention(body);

  assert.ok(!body.descendants().some((element) => element.attributes["aria-label"]?.startsWith("Dismiss")));
});
