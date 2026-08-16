import { ItemView, Menu, Notice, WorkspaceLeaf, getAllTags, setIcon, type TFile } from "obsidian";
import type OmdHomePlugin from "./main";
import type { CalendarEventRecord, WidgetId, WidgetPlacement } from "./model";
import { DEFAULT_LAYOUT, GRID_COLUMNS, movePlacement } from "./layout";
import { Omnibox } from "./omnibox";
import { inferCaptureActive, summarizeProcessingEvents, type ProcessingRow } from "./processing-state";
import { groupTagCounts } from "./tags";

export const HOME_VIEW_TYPE = "omd-home-view";
const ROW_HEIGHT = 48;

export class OmdHomeView extends ItemView {
  private readonly plugin: OmdHomePlugin;
  private grid!: HTMLElement;
  private manageWidgetsButton?: HTMLElement;
  private manageWidgetsBadge?: HTMLElement;
  private readonly widgetEls = new Map<WidgetId, HTMLElement>();
  private readonly widgetBodies = new Map<WidgetId, HTMLElement>();
  private omnibox?: Omnibox;
  private renderTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: OmdHomePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return HOME_VIEW_TYPE; }
  getDisplayText(): string { return "OMD Home"; }
  getIcon(): string { return "layout-dashboard"; }

  async onOpen(): Promise<void> {
    this.render();
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRender()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRender()));
  }

  render(): void {
    if (!this.grid?.isConnected) this.buildShell();
    this.syncManageWidgetsButton();
    this.syncWidgets();
    this.refreshWidgets();
  }

  async onClose(): Promise<void> {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
  }

  private scheduleRender(): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, 120);
  }

  private buildShell(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("omd-home-view");
    const header = contentEl.createDiv({ cls: "omd-home-header" });
    const title = header.createDiv({ cls: "omd-home-title" });
    title.createSpan({ cls: "omd-home-mark", text: "OMD" });
    title.createEl("h1", { text: greeting() });
    title.createEl("p", { text: longDate() });
    const controls = header.createDiv({ cls: "omd-home-controls" });
    const capture = controls.createEl("button", { cls: "omd-action-button", type: "button", text: "Capture URL or file" });
    capture.addEventListener("click", () => this.plugin.openCaptureModal());
    const event = controls.createEl("button", { cls: "omd-action-button mod-cta", type: "button", text: "Create event" });
    event.addEventListener("click", () => void this.plugin.createCalendarEvent());
    this.manageWidgetsButton = controls.createEl("button", {
      cls: "omd-action-button omd-widget-manager",
      type: "button",
      attr: { "aria-label": "Manage widgets" },
    });
    this.manageWidgetsButton.createSpan({ text: "Widgets" });
    this.manageWidgetsBadge = this.manageWidgetsButton.createSpan({ cls: "omd-widget-manager-badge" });
    this.manageWidgetsButton.addEventListener("click", (event) => this.openWidgetManagerMenu(event));
    const reset = controls.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "Reset widget layout" } });
    setIcon(reset, "rotate-ccw");
    reset.addEventListener("click", () => {
      void this.plugin.saveDeviceLayout(DEFAULT_LAYOUT.map((item) => ({ ...item }))).then(() => {
        this.render();
        new Notice("OMD Home layout reset");
      });
    });

    this.grid = contentEl.createDiv({ cls: "omd-widget-grid" });
  }

  focusOmnibox(): void { this.omnibox?.focus(); }

  private syncManageWidgetsButton(): void {
    if (!this.manageWidgetsBadge) return;
    const hiddenCount = this.plugin.deviceLayout.filter((item) => item.hidden).length;
    this.manageWidgetsBadge.textContent = hiddenCount ? String(hiddenCount) : "";
    this.manageWidgetsBadge.hidden = hiddenCount === 0;
  }

  private syncWidgets(): void {
    const visible = this.plugin.deviceLayout.filter((item) => !item.hidden);
    const visibleIds = new Set(visible.map((item) => item.id));
    for (const [id, element] of this.widgetEls) {
      if (visibleIds.has(id)) continue;
      element.remove();
      this.widgetEls.delete(id);
      this.widgetBodies.delete(id);
    }
    for (const placement of visible) {
      let widget = this.widgetEls.get(placement.id);
      if (!widget) widget = this.createWidget(placement);
      applyPlacement(widget, placement);
      this.grid.appendChild(widget);
    }
  }

  private refreshWidgets(): void {
    for (const [id, body] of this.widgetBodies) {
      if (id === "omnibox") {
        this.omnibox ??= new Omnibox(this.app, this.plugin);
        this.omnibox.mount(body);
        continue;
      }
      body.empty();
      this.renderWidgetBody(id, body);
    }
  }

  private createWidget(placement: WidgetPlacement): HTMLElement {
    const widget = this.grid.createEl("section", { cls: `omd-widget omd-widget-${placement.id}` });
    widget.dataset.widgetId = placement.id;
    const header = widget.createDiv({ cls: "omd-widget-header" });
    const label = header.createEl("h2", { text: widgetTitle(placement.id) });
    const controls = header.createDiv({ cls: "omd-widget-controls" });
    if (placement.id === "today" || placement.id === "upcoming") {
      const add = controls.createEl("button", { cls: "clickable-icon omd-widget-action", attr: { "aria-label": "Create event" } });
      setIcon(add, "plus");
      add.addEventListener("click", () => void this.plugin.createCalendarEvent());
    }
    if (placement.id === "processing") {
      const add = controls.createEl("button", { cls: "clickable-icon omd-widget-action", attr: { "aria-label": "Capture URL or file" } });
      setIcon(add, "download");
      add.addEventListener("click", () => this.plugin.openCaptureModal());
    }
    const menuButton = controls.createEl("button", { cls: "clickable-icon", attr: { "aria-label": `Options for ${label.textContent}` } });
    setIcon(menuButton, "more-horizontal");
    menuButton.addEventListener("click", (event) => this.openWidgetMenu(event, placement.id));
    const drag = controls.createEl("button", { cls: "clickable-icon omd-widget-drag", attr: { "aria-label": `Move ${label.textContent}` } });
    setIcon(drag, "grip");
    this.bindPointerTransform(drag, widget, placement.id, "move");
    const body = widget.createDiv({ cls: "omd-widget-body" });
    const resize = widget.createDiv({ cls: "omd-widget-resize", attr: { role: "button", tabindex: "0", "aria-label": `Resize ${label.textContent}` } });
    this.bindPointerTransform(resize, widget, placement.id, "resize");
    this.widgetEls.set(placement.id, widget);
    this.widgetBodies.set(placement.id, body);
    return widget;
  }

  private renderWidgetBody(id: WidgetId, body: HTMLElement): void {
    if (id === "today" || id === "upcoming") {
      const now = Date.now();
      const end = id === "today" ? endOfToday() : now + 7 * 86_400_000;
      const events = this.plugin.calendarEvents
        .filter((event) => new Date(event.end).getTime() >= now && new Date(event.start).getTime() <= end)
        .sort((a, b) => a.start.localeCompare(b.start))
        .slice(0, id === "today" ? 8 : 6);
      if (!events.length) {
        return emptyAction(body, "No events in this range", "+ Create event", () => void this.plugin.createCalendarEvent());
      }
      for (const event of events) {
        const row = body.createEl("button", { cls: "omd-event-row", type: "button" });
        row.createSpan({ cls: `omd-source-mark is-${event.source}`, attr: { "aria-label": event.source } });
        row.createSpan({ cls: "omd-event-time", text: event.allDay ? "ALL" : shortTime(event.start) });
        row.createSpan({ cls: "omd-event-title", text: event.title });
        if (event.syncState === "conflict") row.addClass("has-conflict");
        row.addEventListener("click", () => event.notePath
          ? void this.app.workspace.openLinkText(event.notePath, "", false)
          : void this.plugin.openCalendar());
      }
      return;
    }
    if (id === "inbox") return this.renderInbox(body, this.plugin.listInboxFiles().slice(0, 7));
    if (id === "recent") return this.renderFileList(body, [...this.app.vault.getMarkdownFiles()].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 7), "No recent notes");
    if (id === "continue") {
      const file = this.app.workspace.getActiveFile();
      if (!file) return emptyState(body, "Nothing open yet", "Choose a recent note to continue.");
      return this.renderFileList(body, [file], "Nothing open yet");
    }
    if (id === "pinned") {
      const files = this.plugin.settings.pinnedNotes.map((path) => this.app.vault.getFileByPath(path)).filter((file): file is TFile => Boolean(file));
      return this.renderFileList(body, files, "Pin notes from their file menu");
    }
    if (id === "processing") {
      const activity = summarizeProcessingEvents(this.plugin.processingEvents, this.captureActive);
      if (!activity.active && activity.recent.length === 0) return emptyState(body, "OMD is idle", "Paste a URL or file path into the omnibox.");
      if (activity.active) {
        const controls = body.createDiv({ cls: "omd-process-actions" });
        const cancel = controls.createEl("button", { cls: "omd-inline-action", type: "button", text: "Cancel" });
        cancel.addEventListener("click", () => void (this.plugin as OmdHomePlugin & { cancelActiveOmd?: () => Promise<void> | void }).cancelActiveOmd?.());
        this.renderProcessingSection(body, "Active now", [activity.active]);
      }
      if (activity.recent.length) this.renderProcessingSection(body, activity.active ? "Recent" : "Last activity", activity.recent);
      return;
    }
    if (id === "attention") {
      const attention = this.plugin.calendarEvents.filter((event) => (
        event.syncState === "conflict" || event.syncState === "pending" || event.syncState === "unavailable" || event.syncState === "error"
      ));
      if (!attention.length && !this.plugin.lastError) return emptyState(body, "Nothing needs attention", "Sync and processing are healthy.");
      if (this.plugin.lastError) body.createDiv({ cls: "omd-attention-item", text: this.plugin.lastError });
      for (const event of attention.slice(0, 5)) {
        const row = body.createEl("button", { cls: "omd-attention-item", type: "button" });
        row.setText(`${attentionLabel(event.syncState)}: ${event.title}`);
        row.addEventListener("click", () => void this.plugin.openCalendar());
      }
      return;
    }
    if (id === "tags") {
      const tags = this.app.vault.getMarkdownFiles().flatMap((file) => {
        const cache = this.app.metadataCache.getFileCache(file);
        return cache ? getAllTags(cache) ?? [] : [];
      });
      const groups = groupTagCounts(tags).slice(0, 12);
      if (!groups.length) return emptyState(body, "No tags yet", "Add #tags or frontmatter tags to your notes.");
      const list = body.createDiv({ cls: "omd-tag-groups" });
      for (const group of groups) {
        const button = list.createEl("button", {
          cls: "omd-tag-group",
          type: "button",
          attr: { "aria-label": `Search tag group ${group.name}` },
        });
        button.createSpan({ cls: "omd-tag-name", text: `#${group.name}` });
        button.createSpan({ cls: "omd-tag-count", text: String(group.count) });
        if (group.tags.length > 1 || group.tags[0]?.name !== group.name) {
          button.createSpan({
            cls: "omd-tag-detail",
            text: group.tags.slice(0, 3).map((tag) => tag.name.replace(`${group.name}/`, "")).join(" · "),
          });
        }
        button.addEventListener("click", () => void this.plugin.openTagSearch(group.name));
      }
      return;
    }
    if (id === "status") {
      const activity = summarizeProcessingEvents(this.plugin.processingEvents, this.captureActive);
      statusLine(body, "OMD", activity.active ? "active" : activity.recent.length ? "idle" : "ready");
      statusLine(body, "Enrichment", this.plugin.enrichmentCapability.status);
      if (activity.recent[0]) statusLine(body, "Last run", activity.recent[0].value);
      statusLine(body, "Calendar", this.plugin.externalCalendars.length ? "connected" : "vault only");
      statusLine(body, "AI", this.plugin.settings.aiProvider === "ollama" ? "local" : "task consent");
    }
  }

  private get captureActive(): boolean {
    return this.plugin.captureActive
      || this.plugin.enrichmentActive
      || inferCaptureActive(this.plugin.processingEvents);
  }

  private renderInbox(body: HTMLElement, files: TFile[]): void {
    if (!files.length) return emptyState(body, "Inbox is clear", "New OMD captures and legacy Inbox notes appear here.");
    for (const file of files) {
      const row = body.createDiv({ cls: "omd-inbox-row" });
      const open = row.createEl("button", {
        cls: "omd-note-row omd-inbox-open",
        type: "button",
        attr: { "aria-label": `Open ${file.basename}` },
      });
      open.createSpan({ cls: "omd-note-title", text: file.basename });
      open.createSpan({ cls: "omd-note-path", text: file.parent?.path ?? "/" });
      open.addEventListener("click", () => void this.app.workspace.openLinkText(file.path, "", false));
      const suggest = row.createEl("button", {
        cls: "clickable-icon omd-inbox-suggest",
        type: "button",
        attr: { "aria-label": `Suggest links and tags for ${file.basename}` },
      });
      setIcon(suggest, "sparkles");
      suggest.addEventListener("click", () => void this.plugin.suggestLinksAndTags(file));
    }
  }

  private renderProcessingSection(body: HTMLElement, title: string, rows: ProcessingRow[]): void {
    const section = body.createDiv({ cls: "omd-process-section" });
    section.createEl("h3", { cls: "omd-process-heading", text: title });
    for (const item of rows) {
      const row = section.createDiv({ cls: `omd-process-row is-${item.tone}` });
      row.createSpan({ text: item.label });
      row.createSpan({ cls: "omd-process-value", text: item.value });
    }
  }

  private renderFileList(body: HTMLElement, files: TFile[], empty: string): void {
    if (!files.length) return emptyState(body, empty, "This panel fills itself as you work.");
    for (const file of files) {
      const row = body.createEl("button", { cls: "omd-note-row", type: "button" });
      row.createSpan({ cls: "omd-note-title", text: file.basename });
      row.createSpan({ cls: "omd-note-path", text: file.parent?.path ?? "/" });
      row.addEventListener("click", () => void this.app.workspace.openLinkText(file.path, "", false));
    }
  }

  private openWidgetMenu(event: MouseEvent, id: WidgetId): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Hide widget").setIcon("eye-off").onClick(async () => {
      await this.setWidgetHidden(id, true);
    }));
    const hidden = this.plugin.deviceLayout.filter((placement) => placement.hidden);
    if (hidden.length) {
      menu.addSeparator();
      for (const placement of hidden) {
        menu.addItem((item) => item.setTitle(`Show ${widgetTitle(placement.id)}`).setIcon("eye").onClick(async () => {
          await this.setWidgetHidden(placement.id, false);
        }));
      }
    }
    menu.addItem((item) => item.setTitle("Reset layout").setIcon("rotate-ccw").onClick(async () => {
      await this.plugin.saveDeviceLayout(DEFAULT_LAYOUT.map((placement) => ({ ...placement })));
      this.render();
    }));
    menu.showAtMouseEvent(event);
  }

  private openWidgetManagerMenu(event: MouseEvent): void {
    const menu = new Menu();
    const hidden = this.plugin.deviceLayout.filter((placement) => placement.hidden);
    if (hidden.length) {
      for (const placement of hidden) {
        menu.addItem((item) => item.setTitle(`Show ${widgetTitle(placement.id)}`).setIcon("eye").onClick(async () => {
          await this.setWidgetHidden(placement.id, false);
        }));
      }
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("Show all widgets").setIcon("layout-dashboard").onClick(async () => {
        await this.plugin.saveDeviceLayout(this.plugin.deviceLayout.map((placement) => ({ ...placement, hidden: false })));
        this.render();
      }));
    } else {
      menu.addItem((item) => item.setTitle("All widgets visible").setIcon("check").onClick(() => undefined));
    }
    menu.showAtMouseEvent(event);
  }

  private async setWidgetHidden(id: WidgetId, hidden: boolean): Promise<void> {
    await this.plugin.saveDeviceLayout(this.plugin.deviceLayout.map((placement) => placement.id === id ? { ...placement, hidden } : placement));
    this.render();
  }

  private bindPointerTransform(
    handle: HTMLElement,
    widget: HTMLElement,
    id: WidgetId,
    mode: "move" | "resize",
  ): void {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const placement = this.plugin.deviceLayout.find((item) => item.id === id);
      if (!placement) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const columnWidth = this.grid.clientWidth / GRID_COLUMNS;
      widget.addClass("is-transforming");
      this.grid.addClass("is-rearranging");
      handle.setPointerCapture(event.pointerId);
      let previewLayout = this.plugin.deviceLayout;
      let finished = false;
      const onMove = (move: PointerEvent): void => {
        if (move.pointerId !== event.pointerId) return;
        const dx = Math.round((move.clientX - startX) / columnWidth);
        const dy = Math.round((move.clientY - startY) / ROW_HEIGHT);
        const preview = mode === "move"
          ? { ...placement, x: placement.x + dx, y: placement.y + dy }
          : { ...placement, w: placement.w + dx, h: placement.h + dy };
        previewLayout = movePlacement(this.plugin.deviceLayout, placement.id, preview);
        this.applyPreviewLayout(previewLayout, placement.id);
      };
      const onEnd = async (end: PointerEvent): Promise<void> => {
        if (finished || end.pointerId !== event.pointerId) return;
        finished = true;
        if (handle.hasPointerCapture(end.pointerId)) handle.releasePointerCapture(end.pointerId);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEndWrapper);
        window.removeEventListener("pointercancel", onEndWrapper);
        widget.removeClass("is-transforming");
        this.grid.removeClass("is-rearranging");
        await this.plugin.saveDeviceLayout(previewLayout);
        this.render();
      };
      const onEndWrapper = (end: PointerEvent): void => {
        void onEnd(end);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEndWrapper);
      window.addEventListener("pointercancel", onEndWrapper);
    });
  }

  private applyPreviewLayout(layout: WidgetPlacement[], movingId: WidgetId): void {
    for (const placement of layout) {
      const element = this.grid.querySelector<HTMLElement>(`[data-widget-id="${placement.id}"]`);
      if (!element) continue;
      applyPlacement(element, placement);
      element.toggleClass("is-displaced", placement.id !== movingId);
    }
  }
}

function applyPlacement(element: HTMLElement, value: WidgetPlacement): void {
  element.style.gridColumn = `${Math.max(1, value.x + 1)} / span ${Math.max(1, value.w)}`;
  element.style.gridRow = `${Math.max(1, value.y + 1)} / span ${Math.max(1, value.h)}`;
}

function widgetTitle(id: WidgetId): string {
  return ({ omnibox: "Omnibox", today: "Today", inbox: "OMD Inbox", processing: "Active processing", recent: "Recent notes", continue: "Continue", upcoming: "Upcoming", pinned: "Pinned", attention: "Needs attention", tags: "Vault tags", status: "System" })[id];
}

function emptyState(container: HTMLElement, title: string, detail: string): void {
  const empty = container.createDiv({ cls: "omd-empty" });
  empty.createDiv({ cls: "omd-empty-pixel" });
  empty.createEl("strong", { text: title });
  empty.createSpan({ text: detail });
}

function emptyAction(container: HTMLElement, title: string, label: string, action: () => void): void {
  const empty = container.createDiv({ cls: "omd-empty" });
  empty.createDiv({ cls: "omd-empty-pixel" });
  empty.createEl("strong", { text: title });
  const button = empty.createEl("button", { cls: "omd-inline-action", type: "button", text: label });
  button.addEventListener("click", action);
}

function statusLine(container: HTMLElement, label: string, value: string): void {
  const row = container.createDiv({ cls: "omd-status-line" });
  row.createSpan({ text: label });
  row.createSpan({ cls: "omd-status-value", text: value });
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function longDate(): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}

function shortTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function endOfToday(): number {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function attentionLabel(state: CalendarEventRecord["syncState"]): string {
  if (state === "conflict") return "Conflict";
  if (state === "pending") return "Pending sync";
  if (state === "error") return "Sync paused";
  return "Unavailable";
}
