import { ItemView, Menu, Notice, WorkspaceLeaf, getAllTags, setIcon, type TFile } from "obsidian";
import { aiProviderLabel } from "./ai-provider.ts";
import type { CaptureFailureRecord } from "./capture-request";
import { omdHomeStatus } from "./inbox.ts";
import {
  buildHomeNoteSnapshot,
  filterHomeNoteRows,
  formatFullHomeNoteTime,
  formatRelativeHomeNoteTime,
  homeNoteDisplayTime,
  homeNoteTagFilterOptions,
  sortHomeNoteRows,
  visibleHomeNoteTags,
  type HomeNoteRow,
} from "./home-note-list.ts";
import { canOpenOllamaDesktopApp } from "./ollama-app";
import type OmdHomePlugin from "./main";
import type { CalendarEventRecord, WidgetId, WidgetPlacement } from "./model";
import { DEFAULT_LAYOUT, GRID_COLUMNS, movePlacement } from "./layout";
import { Omnibox } from "./omnibox";
import { summarizeProcessingEvents, type ProcessingRow } from "./processing-state";
import { groupTagCounts } from "./tags";

export const HOME_VIEW_TYPE = "omd-home-view";
const ROW_HEIGHT = 48;

export class OmdHomeView extends ItemView {
  private readonly plugin: OmdHomePlugin;
  private grid!: HTMLElement;
  private manageWidgetsButton?: HTMLElement;
  private manageWidgetsBadge?: HTMLElement;
  private greetingEl?: HTMLElement;
  private dateEl?: HTMLElement;
  private readonly widgetEls = new Map<WidgetId, HTMLElement>();
  private readonly widgetBodies = new Map<WidgetId, HTMLElement>();
  private omnibox?: Omnibox;
  private omniboxExpanded = false;
  private renderTimer: number | null = null;
  private clockTimer: number | null = null;
  private clockDay: string | null = null;
  private noteSnapshot: HomeNoteRow<TFile>[] = [];
  private readonly noteTagFilters: Record<"inbox" | "recent", Set<string>> = {
    inbox: new Set(),
    recent: new Set(),
  };

  constructor(leaf: WorkspaceLeaf, plugin: OmdHomePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string { return HOME_VIEW_TYPE; }
  getDisplayText(): string { return "OMD Home"; }
  getIcon(): string { return "layout-dashboard"; }

  async onOpen(): Promise<void> {
    this.render();
    if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
    this.clockTimer = window.setInterval(() => this.refreshClock(), 60_000);
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRender()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRender()));
  }

  render(): void {
    if (!this.grid?.isConnected) this.buildShell();
    this.refreshClock();
    this.syncManageWidgetsButton();
    this.syncWidgets();
    this.refreshWidgets();
  }

  async onClose(): Promise<void> {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = null;
    if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
    this.clockTimer = null;
    this.omnibox?.dispose();
    this.omnibox = undefined;
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
    this.greetingEl = title.createEl("h1", { text: greeting() });
    this.dateEl = title.createEl("p", { text: longDate() });
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

  private refreshClock(): void {
    const now = new Date();
    const day = now.toDateString();
    const dayChanged = this.clockDay !== null && this.clockDay !== day;
    this.clockDay = day;
    const nextGreeting = greeting(now);
    const nextDate = longDate(now);
    if (this.greetingEl && this.greetingEl.textContent !== nextGreeting) this.greetingEl.setText(nextGreeting);
    if (this.dateEl && this.dateEl.textContent !== nextDate) this.dateEl.setText(nextDate);
    this.refreshRenderedNoteTimes();
    if (dayChanged) {
      for (const id of ["today", "upcoming"] as const) {
        const body = this.widgetBodies.get(id);
        if (!body) continue;
        body.empty();
        this.renderWidgetBody(id, body);
      }
    }
  }

  private syncManageWidgetsButton(): void {
    if (!this.manageWidgetsBadge) return;
    const hiddenCount = this.plugin.deviceLayout.filter((item) => item.hidden).length;
    this.manageWidgetsBadge.textContent = hiddenCount ? String(hiddenCount) : "";
    this.manageWidgetsBadge.hidden = hiddenCount === 0;
  }

  private syncWidgets(): void {
    const active = this.grid.ownerDocument.activeElement;
    const focused = active && this.grid.contains(active) ? active as HTMLElement : null;
    const visible = this.runtimeLayout().filter((item) => !item.hidden);
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
    if (focused?.isConnected && focused.ownerDocument.activeElement !== focused) {
      focused.focus({ preventScroll: true });
    }
  }

  private refreshWidgets(): void {
    this.noteSnapshot = buildHomeNoteSnapshot(
      this.app.vault.getMarkdownFiles(),
      (file) => {
        const cache = this.app.metadataCache.getFileCache(file);
        return {
          frontmatter: cache?.frontmatter,
          tags: cache ? getAllTags(cache) ?? [] : [],
        };
      },
    );
    for (const [id, body] of this.widgetBodies) {
      if (id === "omnibox") {
        this.omnibox ??= new Omnibox(this.app, this.plugin, (visible) => this.setOmniboxExpanded(visible));
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
    if (placement.id === "inbox" || placement.id === "recent") {
      const context = placement.id;
      label.createSpan({ cls: "omd-note-list-total", attr: { "aria-hidden": "true" } });
      const filter = controls.createEl("button", {
        cls: "clickable-icon omd-note-filter",
        type: "button",
        attr: { "aria-label": `Filter ${label.textContent} by tag` },
      });
      setIcon(filter, "list-filter");
      filter.createSpan({ cls: "omd-note-filter-count" });
      filter.addEventListener("click", (event) => this.openNoteFilterMenu(event, context));
    }
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
    const drag = controls.createEl("button", { cls: "clickable-icon omd-widget-drag", type: "button", attr: { "aria-label": `Move ${label.textContent}. Use arrow keys or drag.` } });
    setIcon(drag, "grip");
    this.bindPointerTransform(drag, widget, placement.id, "move");
    this.bindKeyboardMove(drag, placement.id);
    const body = widget.createDiv({ cls: "omd-widget-body" });
    const resize = widget.createDiv({
      cls: "omd-widget-resize",
      attr: {
        role: "button",
        tabindex: "0",
        title: `Drag to resize ${label.textContent}`,
        "aria-label": `Resize ${label.textContent}. Use arrow keys or drag.`,
      },
    });
    this.bindPointerTransform(resize, widget, placement.id, "resize");
    this.bindKeyboardResize(resize, placement.id);
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
        row.createSpan({ cls: "omd-event-title", text: event.title, attr: { dir: "auto", title: event.title } });
        if (event.syncState === "conflict") row.addClass("has-conflict");
        row.addEventListener("click", () => event.notePath
          ? void this.app.workspace.openLinkText(event.notePath, "", false)
          : void this.plugin.openCalendar());
      }
      return;
    }
    if (id === "inbox") return this.renderInbox(body);
    if (id === "recent") return this.renderRecent(body);
    if (id === "continue") {
      const file = this.app.workspace.getActiveFile();
      if (!file) return emptyState(body, "Nothing open yet", "Choose a recent note to continue.");
      return this.renderFileList(body, [file], "Nothing open yet");
    }
    if (id === "pinned") {
      const files = this.plugin.settings.pinnedNotes.map((path) => this.app.vault.getFileByPath(path)).filter((file): file is TFile => Boolean(file));
      return this.renderFileList(body, files, "Use a Pin button on a note to keep it here");
    }
    if (id === "processing") {
      if (this.plugin.enrichmentPhase === "review" && !this.plugin.captureActive) {
        return emptyState(body, "Ready to review", "Choose suggestions in the OMD review pane.");
      }
      if ((this.plugin.enrichmentPhase === "applying" || this.plugin.enrichmentPhase === "finishing") && !this.plugin.captureActive) {
        const label = this.plugin.enrichmentPhase === "finishing" ? "Finishing review" : "Applying suggestions";
        return this.renderProcessingSection(body, "Active now", [{ label, value: "working", tone: "active" }]);
      }
      const activity = summarizeProcessingEvents(this.plugin.processingEvents, this.captureActive);
      if (!activity.active) return emptyState(body, "No task running", "Captures continue when this tab is in the background.");
      if (activity.active) {
        const canCancel = this.plugin.captureCancelable || this.plugin.enrichmentCancelable;
        if (canCancel) {
          const controls = body.createDiv({ cls: "omd-process-actions" });
          const cancel = controls.createEl("button", { cls: "omd-inline-action", type: "button", text: "Cancel" });
          cancel.addEventListener("click", () => void this.plugin.cancelActiveOmd());
        }
        this.renderProcessingSection(body, "Active now", [activity.active]);
      }
      return;
    }
    if (id === "attention") {
      const attention = this.plugin.calendarEvents.filter((event) => (
        event.syncState === "conflict" || event.syncState === "pending" || event.syncState === "unavailable" || event.syncState === "error"
      ));
      const capabilityIssue = this.plugin.enrichmentCapability.status === "unavailable";
      const localAiNeedsAttention = this.plugin.localAiState.daemonCode !== "ready"
        && !this.plugin.localAiState.activeAction;
      const hostedAnswerNeedsAttention = this.plugin.hostedAiState
        && this.plugin.hostedAiState.code !== "ready"
        && !this.plugin.hostedAiState.activeAction;
      const localAiOwnsLastError = localAiNeedsAttention && this.plugin.lastErrorContext === "ai";
      const captureFailure = this.plugin.currentCaptureFailure();
      const captureFailureForIssue = this.plugin.captureFailureForCurrentIssue();
      const hasIndependentCaptureFailure = Boolean(captureFailure && captureFailure !== captureFailureForIssue);
      if (!attention.length && !this.plugin.lastError && !capabilityIssue && !localAiNeedsAttention
        && !hostedAnswerNeedsAttention && !hasIndependentCaptureFailure) {
        return emptyState(body, "Nothing needs attention", "Sync and processing are healthy.");
      }
      if (this.plugin.lastError && !localAiOwnsLastError) this.renderLastIssue(body, this.plugin.currentIssueId());
      if (localAiNeedsAttention) this.renderLocalAiAttention(body);
      if (hostedAnswerNeedsAttention) this.renderHostedAiAttention(body);
      if (captureFailure && hasIndependentCaptureFailure) {
        this.renderIndependentCaptureFailure(body, captureFailure);
      }
      if (capabilityIssue) {
        const item = body.createDiv({ cls: "omd-attention-item" });
        const header = item.createDiv({ cls: "omd-attention-header" });
        header.createEl("strong", { text: "OMD setup needs attention" });
        if (this.plugin.enrichmentCapability.checkedAt) {
          header.createSpan({ cls: "omd-attention-time", text: formatIssueTime(this.plugin.enrichmentCapability.checkedAt) });
        }
        item.createDiv({ cls: "omd-attention-detail", text: this.plugin.enrichmentCapability.message });
        const controls = item.createDiv({ cls: "omd-process-actions" });
        if (!this.plugin.usesAutomaticOmdDiscovery()) {
          const automatic = controls.createEl("button", {
            cls: "omd-inline-action",
            type: "button",
            text: "Use automatic",
          });
          automatic.addEventListener("click", () => void this.plugin.useAutomaticOmdDiscovery().then((ready) => {
            new Notice(ready ? "OMD was found automatically." : this.plugin.enrichmentCapability.message);
          }));
        }
        if (this.plugin.enrichmentCapability.code === "missing_executable") {
          const copy = controls.createEl("button", {
            cls: "omd-inline-action",
            type: "button",
            text: "Copy install steps",
          });
          copy.addEventListener("click", () => void this.plugin.copyOmdInstallInstructions());
        }
        const guide = controls.createEl("button", {
          cls: "omd-inline-action",
          type: "button",
          text: this.plugin.enrichmentCapability.code === "missing_executable" ? "Install guide" : "Update guide",
        });
        guide.addEventListener("click", () => this.plugin.openOmdInstallGuide());
        const check = controls.createEl("button", {
          cls: "omd-inline-action",
          type: "button",
          text: "Check again",
        });
        check.addEventListener("click", () => void this.plugin.checkEnrichmentCapability(true).then((ready) => {
          new Notice(ready ? "OMD is ready." : this.plugin.enrichmentCapability.message);
        }));
      }
      for (const event of attention.slice(0, 5)) {
        const row = body.createEl("button", { cls: "omd-attention-item", type: "button" });
        row.setText(`${attentionLabel(event.syncState)}: ${event.title}`);
        row.addEventListener("click", () => void this.plugin.openCalendar());
      }
      return;
    }
    if (id === "tags") {
      const tags = this.noteSnapshot.flatMap((note) => note.tags);
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
      statusLine(body, "OMD", this.plugin.enrichmentPhase === "review" ? "awaiting review" : activity.active ? "active" : activity.recent.length ? "idle" : "ready");
      statusLine(body, "OMD executable", this.plugin.enrichmentCapability.status);
      if (activity.recent[0]) statusLine(body, "Last run", activity.recent[0].value);
      statusLine(body, "Calendar", this.plugin.externalCalendars.length ? "connected" : "vault only");
      statusLine(body, "Local AI", this.plugin.localAiState.daemonCode);
      statusLine(body, "Answer provider", aiProviderLabel(this.plugin.settings.aiProvider));
      if (this.plugin.hostedAiState) statusLine(body, "Answer setup", this.plugin.hostedAiState.code);
      if (this.plugin.localAiState.version) statusLine(body, "Ollama", this.plugin.localAiState.version);
      if (this.plugin.localAiFeedback) {
        statusLine(body, "AI last action", `${this.plugin.localAiFeedback.tone} ${formatIssueTime(this.plugin.localAiFeedback.at)}`);
      }
      for (const workflow of Object.values(this.plugin.localAiState.workflows)) {
        if (!workflow.enabled) continue;
        statusLine(body, workflow.label, workflow.code);
      }
      if (this.plugin.localAiState.daemonCode === "unchecked") {
        const aiSetupBusy = this.plugin.aiSetupBusy();
        const controls = body.createDiv({ cls: "omd-process-actions" });
        const check = controls.createEl("button", {
          cls: "omd-inline-action",
          type: "button",
          text: aiSetupBusy ? "Checking…" : "Check setup",
        });
        check.disabled = aiSetupBusy;
        check.addEventListener("click", () => void this.plugin.checkLocalAiConnection());
      }
    }
  }

  private get captureActive(): boolean {
    const phase = this.plugin.enrichmentPhase;
    return this.plugin.captureActive
      || phase === "capability" || phase === "catalog" || phase === "generating" || phase === "applying" || phase === "finishing";
  }

  private renderInbox(body: HTMLElement): void {
    this.renderWorkflowNoteList(body, "inbox");
  }

  private renderRecent(body: HTMLElement): void {
    this.renderWorkflowNoteList(body, "recent");
  }

  private renderWorkflowNoteList(body: HTMLElement, context: "inbox" | "recent"): void {
    const source = context === "inbox"
      ? this.noteSnapshot.filter((note) => note.inbox)
      : this.noteSnapshot;
    const ordered = sortHomeNoteRows(source, context);
    const filtered = filterHomeNoteRows(ordered, this.noteTagFilters[context]);
    this.syncNoteFilterButton(context, filtered.length, source.length);

    if (!filtered.length) {
      if (this.noteTagFilters[context].size) {
        return emptyAction(body, "No notes match these tags", "Clear filters", () => {
          this.noteTagFilters[context].clear();
          this.refreshNoteWidgets();
        });
      }
      const detail = context === "inbox"
        ? "Reviewed notes remain available in Recent notes."
        : "This panel fills itself as you work.";
      return emptyState(body, context === "inbox" ? "Inbox is clear" : "No recent notes", detail);
    }

    const list = body.createDiv({ cls: "omd-note-list" });
    for (const note of filtered.slice(0, 7)) this.renderWorkflowNoteRow(list, note, context);
  }

  private renderWorkflowNoteRow(
    list: HTMLElement,
    note: HomeNoteRow<TFile>,
    context: "inbox" | "recent",
  ): void {
    const row = list.createDiv({ cls: "omd-note-list-row" });
    const statusLabel = note.status === "inbox" ? "Inbox" : note.status === "reviewed" ? "Reviewed" : null;
    const open = row.createEl("button", {
      cls: "omd-note-row omd-note-list-open",
      type: "button",
      attr: {
        "aria-label": statusLabel && context === "recent"
          ? `Open ${note.title}. Status: ${statusLabel}.`
          : `Open ${note.title}`,
        title: note.path,
      },
    });
    open.createSpan({ cls: "omd-note-title", text: note.title, attr: { dir: "auto" } });
    open.createSpan({ cls: "omd-note-path", text: note.parentPath, attr: { dir: "auto" } });
    const metadata = open.createSpan({ cls: "omd-note-metadata" });
    if (context === "recent" && statusLabel) {
      metadata.createSpan({ cls: `omd-note-status is-${note.status}`, text: statusLabel });
    }
    this.renderNoteTime(metadata, note, context);
    const visibleTags = visibleHomeNoteTags(note.tags);
    for (const tag of visibleTags.visible) {
      metadata.createSpan({ cls: "omd-note-tag", text: `#${tag}`, attr: { dir: "auto" } });
    }
    if (visibleTags.remaining) {
      metadata.createSpan({
        cls: "omd-note-tag-more",
        text: `+${visibleTags.remaining}`,
        attr: { "aria-label": `${visibleTags.remaining} more tags` },
      });
    }
    open.addEventListener("click", () => void this.app.workspace.openLinkText(note.path, "", false));

    const actions = row.createDiv({ cls: "omd-note-tools" });
    const reviewLabel = context === "recent" && note.status === "reviewed" ? "Review again" : "Review";
    this.createNoteTool(actions, note.file, reviewLabel, "list-checks", () => void this.plugin.reviewNote(note.file));
    this.createNoteTool(actions, note.file, "AI tags", "tags", () => this.generateNoteProposal(note.file));
    this.createNoteTool(actions, note.file, "Summarize", "align-left", () => this.generateNoteProposal(note.file));
    this.createPinButton(actions, note.file);
    const more = actions.createEl("button", {
      cls: "omd-note-tool omd-note-overflow",
      type: "button",
      attr: { title: `More actions for ${note.title}`, "aria-label": `More actions for ${note.title}` },
    });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (event) => this.openNoteActionsMenu(event, note.file, reviewLabel));
  }

  private renderNoteTime(parent: HTMLElement, note: HomeNoteRow, context: "inbox" | "recent"): void {
    const display = homeNoteDisplayTime(note, context);
    const label = display.kind === "captured" ? "Captured" : "Updated";
    const full = formatFullHomeNoteTime(display.timestamp);
    parent.createEl("time", {
      cls: "omd-note-time",
      text: `${label} ${formatRelativeHomeNoteTime(display.timestamp)}`,
      attr: {
        datetime: new Date(display.timestamp).toISOString(),
        title: full,
        "aria-label": `${label} ${full}`,
        "data-omd-time-kind": display.kind,
        "data-omd-timestamp": String(display.timestamp),
      },
    });
  }

  private refreshRenderedNoteTimes(): void {
    for (const element of Array.from(this.contentEl.querySelectorAll<HTMLElement>(".omd-note-time[data-omd-timestamp]"))) {
      const timestamp = Number(element.dataset.omdTimestamp);
      if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
      const label = element.dataset.omdTimeKind === "captured" ? "Captured" : "Updated";
      const full = formatFullHomeNoteTime(timestamp);
      element.setText(`${label} ${formatRelativeHomeNoteTime(timestamp)}`);
      element.setAttribute("title", full);
      element.setAttribute("aria-label", `${label} ${full}`);
    }
  }

  private createNoteTool(
    parent: HTMLElement,
    file: TFile,
    label: "Review" | "Review again" | "AI tags" | "Summarize",
    icon: string,
    action: () => void,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: "omd-note-tool omd-note-wide-tool",
      type: "button",
      attr: { title: `${label} ${file.basename}`, "aria-label": `${label} ${file.basename}` },
    });
    setIcon(button, icon);
    button.createSpan({ text: label });
    button.addEventListener("click", action);
    return button;
  }

  private generateNoteProposal(file: TFile): void {
    void this.plugin.suggestLinksAndTags(file);
  }

  private openNoteActionsMenu(event: MouseEvent, file: TFile, reviewLabel: "Review" | "Review again"): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(reviewLabel).setIcon("list-checks").onClick(() => void this.plugin.reviewNote(file)));
    menu.addItem((item) => item.setTitle("AI tags").setIcon("tags").onClick(() => this.generateNoteProposal(file)));
    menu.addItem((item) => item.setTitle("Summarize").setIcon("align-left").onClick(() => this.generateNoteProposal(file)));
    menu.showAtMouseEvent(event);
  }

  private openNoteFilterMenu(event: MouseEvent, context: "inbox" | "recent"): void {
    const source = context === "inbox" ? this.noteSnapshot.filter((note) => note.inbox) : this.noteSnapshot;
    const selected = this.noteTagFilters[context];
    const options = homeNoteTagFilterOptions(source);
    const menu = new Menu();
    for (const tag of options) {
      menu.addItem((item) => item
        .setTitle(`#${tag}`)
        .setChecked(selected.has(tag))
        .onClick(() => {
          if (selected.has(tag)) selected.delete(tag);
          else selected.add(tag);
          this.refreshNoteWidgets();
        }));
    }
    if (!options.length) menu.addItem((item) => item.setTitle("No tags available").setIcon("info"));
    if (selected.size) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("Clear filters").setIcon("x").onClick(() => {
        selected.clear();
        this.refreshNoteWidgets();
      }));
    }
    menu.showAtMouseEvent(event);
  }

  private refreshNoteWidgets(): void {
    for (const context of ["inbox", "recent"] as const) {
      const body = this.widgetBodies.get(context);
      if (!body) continue;
      body.empty();
      this.renderWidgetBody(context, body);
    }
  }

  private syncNoteFilterButton(context: "inbox" | "recent", visible: number, total: number): void {
    const widget = this.widgetEls.get(context);
    const button = widget?.querySelector<HTMLButtonElement>(".omd-note-filter");
    if (!button) return;
    const totalLabel = widget?.querySelector<HTMLElement>(".omd-note-list-total");
    if (totalLabel) totalLabel.setText(` ${total}`);
    const selected = this.noteTagFilters[context].size;
    const count = button.querySelector<HTMLElement>(".omd-note-filter-count");
    if (count) {
      count.textContent = selected ? `${visible}/${total}` : "";
      count.hidden = selected === 0;
    }
    button.toggleClass("is-active", selected > 0);
    button.setAttribute("aria-label", selected
      ? `Filter ${widgetTitle(context)} by tag. ${visible} of ${total} notes shown with ${selected} filters.`
      : `Filter ${widgetTitle(context)} by tag. ${total} notes.`);
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

  private renderFileList(body: HTMLElement, files: TFile[], empty: string, showWorkflowStatus = false): void {
    if (!files.length) return emptyState(body, empty, "This panel fills itself as you work.");
    for (const file of files) {
      const status = showWorkflowStatus
        ? omdHomeStatus(this.app.metadataCache.getFileCache(file)?.frontmatter)
        : null;
      const statusLabel = status === "inbox" ? "Inbox" : status === "reviewed" ? "Reviewed" : null;
      const row = body.createDiv({ cls: "omd-note-action-row" });
      const open = row.createEl("button", {
        cls: "omd-note-row",
        type: "button",
        attr: {
          "aria-label": statusLabel ? `Open ${file.basename}. Status: ${statusLabel}.` : `Open ${file.basename}`,
          title: file.path,
        },
      });
      open.createSpan({ cls: "omd-note-title", text: file.basename, attr: { dir: "auto" } });
      open.createSpan({ cls: "omd-note-path", text: file.parent?.path ?? "/", attr: { dir: "auto" } });
      if (statusLabel) open.createSpan({ cls: "omd-note-status", text: statusLabel });
      open.addEventListener("click", () => void this.app.workspace.openLinkText(file.path, "", false));
      this.createPinButton(row, file);
    }
  }

  private createPinButton(parent: HTMLElement, file: TFile): HTMLButtonElement {
    const pinned = this.plugin.isNotePinned(file.path);
    const label = pinned ? "Unpin" : "Pin";
    const button = parent.createEl("button", {
      cls: `omd-pin-action${pinned ? " is-active" : ""}`,
      type: "button",
      attr: {
        title: `${label} ${file.basename} ${pinned ? "from" : "to"} OMD Home`,
        "aria-label": `${label} ${file.basename} ${pinned ? "from" : "to"} OMD Home`,
        "aria-pressed": String(pinned),
      },
    });
    setIcon(button, "pin");
    button.createSpan({ text: label });
    button.addEventListener("click", () => void this.plugin.toggleNotePinned(file.path));
    return button;
  }

  private openWidgetMenu(event: MouseEvent, id: WidgetId): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Hide widget").setIcon("eye-off").onClick(async () => {
      await this.setWidgetHidden(id, true);
    }));
    menu.addItem((item) => item.setTitle("Use standard size").setIcon("maximize-2").onClick(async () => {
      const current = this.plugin.deviceLayout.find((placement) => placement.id === id);
      const standard = DEFAULT_LAYOUT.find((placement) => placement.id === id);
      if (!current || !standard) return;
      await this.plugin.saveDeviceLayout(movePlacement(this.plugin.deviceLayout, id, {
        x: current.x,
        y: current.y,
        w: standard.w,
        h: standard.h,
      }));
      this.render();
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
      if (event.button !== 0) return;
      if (!this.allowLayoutEditing()) return;
      event.preventDefault();
      const placement = this.plugin.deviceLayout.find((item) => item.id === id);
      if (!placement) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const columnWidth = this.grid.clientWidth / GRID_COLUMNS;
      widget.addClass("is-transforming");
      widget.addClass(mode === "move" ? "is-moving" : "is-resizing");
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
        widget.removeClass("is-moving", "is-resizing");
        this.grid.removeClass("is-rearranging");
        this.grid.querySelectorAll<HTMLElement>(".is-displaced").forEach((element) => element.removeClass("is-displaced"));
        try {
          if (end.type !== "pointercancel") await this.plugin.saveDeviceLayout(previewLayout);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "Could not save widget layout");
        } finally {
          this.render();
        }
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
      const original = this.plugin.deviceLayout.find((item) => item.id === placement.id);
      const displaced = placement.id !== movingId
        && original !== undefined
        && !sameGeometry(placement, original);
      element.toggleClass("is-displaced", displaced);
    }
  }

  private bindKeyboardResize(handle: HTMLElement, id: WidgetId): void {
    handle.addEventListener("keydown", (event) => {
      if (!event.key.startsWith("Arrow")) return;
      if (!this.allowLayoutEditing()) return;
      const placement = this.plugin.deviceLayout.find((item) => item.id === id);
      if (!placement) return;
      event.preventDefault();
      const next = {
        x: placement.x,
        y: placement.y,
        w: placement.w + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0),
        h: placement.h + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0),
      };
      void this.plugin.saveDeviceLayout(movePlacement(this.plugin.deviceLayout, id, next)).then(() => this.render());
    });
  }

  private bindKeyboardMove(handle: HTMLElement, id: WidgetId): void {
    handle.addEventListener("keydown", (event) => {
      if (!event.key.startsWith("Arrow") || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!this.allowLayoutEditing()) return;
      const placement = this.plugin.deviceLayout.find((item) => item.id === id);
      if (!placement) return;
      event.preventDefault();
      const next = {
        ...placement,
        x: placement.x + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0),
        y: placement.y + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0),
      };
      void this.plugin.saveDeviceLayout(movePlacement(this.plugin.deviceLayout, id, next))
        .then(() => this.render())
        .catch((error: unknown) => new Notice(error instanceof Error ? error.message : "Could not move widget"));
    });
  }

  private runtimeLayout(): WidgetPlacement[] {
    if (!this.omniboxExpanded) return this.plugin.deviceLayout;
    const omnibox = this.plugin.deviceLayout.find((placement) => placement.id === "omnibox");
    if (!omnibox || omnibox.hidden) return this.plugin.deviceLayout;
    return movePlacement(this.plugin.deviceLayout, "omnibox", {
      x: omnibox.x,
      y: omnibox.y,
      w: omnibox.w,
      h: Math.max(8, omnibox.h),
    });
  }

  private setOmniboxExpanded(expanded: boolean): void {
    if (this.omniboxExpanded === expanded) return;
    this.omniboxExpanded = expanded;
    this.contentEl.toggleClass("has-omnibox-results", expanded);
    this.syncWidgets();
  }

  private allowLayoutEditing(): boolean {
    if (!this.omniboxExpanded) return true;
    new Notice("Collapse omnibox results before rearranging widgets.");
    return false;
  }

  private renderLastIssue(body: HTMLElement, issueId: number): void {
    const item = body.createDiv({ cls: "omd-attention-item" });
    const header = item.createDiv({ cls: "omd-attention-header" });
    const title = issueTitle(this.plugin.lastErrorContext);
    header.createEl("strong", { text: title });
    const meta = header.createDiv({ cls: "omd-attention-header-actions" });
    meta.createSpan({ cls: "omd-attention-time", text: formatIssueTime(this.plugin.lastErrorAt) });
    this.createAttentionDismissButton(meta, `Dismiss ${title} issue`, () => this.plugin.dismissIssue(issueId));
    if (this.plugin.lastErrorSource) {
      item.createDiv({ cls: "omd-attention-source", text: safeSourceLabel(this.plugin.lastErrorSource) });
    }
    item.createDiv({ cls: "omd-attention-detail", text: this.plugin.lastError });
    const failure = this.plugin.captureFailureForCurrentIssue();
    if (failure) {
      const retry = item.createEl("button", { cls: "omd-inline-action", type: "button", text: "Retry capture" });
      retry.addEventListener("click", () => this.plugin.retryFailedCapture(failure.id));
    }
    if (this.plugin.lastErrorContext === "inbox" && this.plugin.lastErrorSource) {
      const open = item.createEl("button", { cls: "omd-inline-action", type: "button", text: "Open note" });
      open.addEventListener("click", () => void this.app.workspace.openLinkText(this.plugin.lastErrorSource, "", false));
    }
  }

  private renderIndependentCaptureFailure(body: HTMLElement, failure: CaptureFailureRecord): void {
    const item = body.createDiv({ cls: "omd-attention-item" });
    const header = item.createDiv({ cls: "omd-attention-header" });
    header.createEl("strong", { text: "Capture can be retried" });
    const meta = header.createDiv({ cls: "omd-attention-header-actions" });
    meta.createSpan({ cls: "omd-attention-time", text: formatIssueTime(failure.failedAt) });
    this.createAttentionDismissButton(meta, "Dismiss capture retry", () => this.plugin.dismissCaptureFailure(failure.id));
    item.createDiv({ cls: "omd-attention-source", text: safeSourceLabel(failure.request.source) });
    item.createDiv({
      cls: "omd-attention-detail",
      text: failure.detail,
    });
    const retry = item.createEl("button", { cls: "omd-inline-action", type: "button", text: "Retry capture" });
    retry.addEventListener("click", () => this.plugin.retryFailedCapture(failure.id));
  }

  private createAttentionDismissButton(parent: HTMLElement, label: string, onDismiss: () => void): void {
    const dismiss = parent.createEl("button", {
      cls: "clickable-icon omd-attention-dismiss",
      type: "button",
      attr: { "aria-label": label, title: label },
    });
    setIcon(dismiss, "x");
    dismiss.addEventListener("click", onDismiss);
  }

  private renderLocalAiAttention(body: HTMLElement): void {
    const item = body.createDiv({ cls: "omd-attention-item" });
    const header = item.createDiv({ cls: "omd-attention-header" });
    header.createEl("strong", { text: "Local AI needs attention" });
    if (this.plugin.localAiState.catalogCheckedAt) {
      header.createSpan({ cls: "omd-attention-time", text: formatIssueTime(this.plugin.localAiState.catalogCheckedAt) });
    }
    item.createDiv({ cls: "omd-attention-detail", text: this.plugin.localAiState.daemonDetail });
    for (const workflow of Object.values(this.plugin.localAiState.workflows)) {
      if (!workflow.enabled || workflow.code === "ready" || workflow.code === this.plugin.localAiState.daemonCode) continue;
      item.createDiv({
        cls: "omd-attention-detail",
        text: `${workflow.label}: ${workflow.detail}`,
      });
    }
    const controls = item.createDiv({ cls: "omd-process-actions" });
    const failure = this.plugin.captureFailureForCurrentIssue();
    if (failure?.issueContext === "ai") {
      const retry = controls.createEl("button", { cls: "omd-inline-action", type: "button", text: "Retry capture" });
      retry.addEventListener("click", () => this.plugin.retryFailedCapture(failure.id));
    }
    const ollamaCanBeOpened = canOpenOllamaDesktopApp()
      && this.plugin.localAiState.daemonCode === "daemon_unreachable";
    if (ollamaCanBeOpened) {
      const open = controls.createEl("button", {
        cls: "omd-inline-action mod-cta",
        type: "button",
        text: "Open Ollama",
      });
      open.addEventListener("click", () => void this.plugin.openOllamaApp());
    }
    const check = controls.createEl("button", {
      cls: "omd-inline-action",
      type: "button",
      text: this.plugin.aiSetupBusy() ? "Checking…" : "Check setup",
    });
    check.disabled = this.plugin.aiSetupBusy();
    check.addEventListener("click", () => void this.plugin.checkLocalAiConnection());
  }

  private renderHostedAiAttention(body: HTMLElement): void {
    const state = this.plugin.hostedAiState;
    if (!state) return;
    const item = body.createDiv({ cls: "omd-attention-item" });
    const header = item.createDiv({ cls: "omd-attention-header" });
    header.createEl("strong", { text: "AI answers need attention" });
    if (state.checkedAt) {
      header.createSpan({ cls: "omd-attention-time", text: formatIssueTime(state.checkedAt) });
    }
    item.createDiv({
      cls: "omd-attention-detail",
      text: `${aiProviderLabel(state.provider)}: ${state.detail}`,
    });
    const controls = item.createDiv({ cls: "omd-process-actions" });
    const activeAction = this.plugin.localAiState.activeAction || state.activeAction;
    const aiSetupBusy = this.plugin.aiSetupBusy();
    const check = controls.createEl("button", {
      cls: "omd-inline-action",
      type: "button",
      text: activeAction ? "Checking…" : "Check setup",
    });
    check.disabled = aiSetupBusy;
    check.addEventListener("click", () => void this.plugin.checkHostedAiConnection());
  }
}

function applyPlacement(element: HTMLElement, value: WidgetPlacement): void {
  element.style.gridColumn = `${Math.max(1, value.x + 1)} / span ${Math.max(1, value.w)}`;
  element.style.gridRow = `${Math.max(1, value.y + 1)} / span ${Math.max(1, value.h)}`;
}

function widgetTitle(id: WidgetId): string {
  return ({ omnibox: "Omnibox", today: "Today", inbox: "OMD Inbox", processing: "Current task", recent: "Recent notes", continue: "Continue", upcoming: "Upcoming", pinned: "Pinned", attention: "Needs attention", tags: "Vault tags", status: "System" })[id];
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

function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function longDate(now = new Date()): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(now);
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

function sameGeometry(a: WidgetPlacement, b: WidgetPlacement): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function issueTitle(context: OmdHomePlugin["lastErrorContext"]): string {
  if (context === "capture") return "Capture failed";
  if (context === "calendar") return "Calendar sync failed";
  if (context === "ai") return "Vault AI failed";
  if (context === "inbox") return "Inbox update failed";
  return "OMD Home needs attention";
}

function formatIssueTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function safeSourceLabel(value: string): string {
  if (!/^https?:\/\//iu.test(value)) return value;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "Submitted URL";
  }
}
