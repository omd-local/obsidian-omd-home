import {
  FileSystemAdapter,
  Notice,
  Platform,
  Plugin,
  TFile,
  normalizePath,
  type WorkspaceLeaf,
} from "obsidian";
import { HOME_VIEW_TYPE, OmdHomeView } from "./home-view";
import { CALENDAR_VIEW_TYPE, OmdCalendarView } from "./calendar-view";
import { DEFAULT_LAYOUT, normalizeLayout } from "./layout";
import type { CalendarEventRecord, ExternalCalendarDescriptor, OmdProgressEvent, WidgetPlacement } from "./model";
import {
  DEFAULT_SETTINGS,
  normalizeOmdHomeSettings,
  OmdHomeSettingTab,
  reconcileCalendarSelection,
  type OmdHomeSettings,
} from "./settings";
import { OmdBridge, type AiAnswer } from "./omd-bridge";
import { EventKitBridge, normalizeEventKitEvent } from "./eventkit-bridge";
import { eventNotePath, recordFromFrontmatter, serializeEventNote, updateEventNote } from "./event-note";
import { AiConsentModal, CaptureModal } from "./modals";
import { OmdCapabilityService } from "./enrichment/capability";
import { EnrichmentWorkflowController } from "./enrichment/controller.ts";
import { OmdEnrichmentRunner } from "./enrichment/runner";
import { toUserFacingEnrichmentMessage } from "./enrichment/errors.ts";
import { inspectVaultRelativeMarkdownPath } from "./enrichment/path-safety.ts";
import { capturedOutputVaultPath, isOmdInboxNote } from "./inbox";
import {
  calendarFetchWindow,
  calendarIdentityKeys,
  classifyLinkedAvailability,
  classifyLinkedChange,
  detachLinkedEvent,
  eventSyncHash,
  isSelectedWritableCalendar,
  linkedEventSaveBlockReason,
  mergeExternalIntoLinked,
  resolveCalendarWriteOverride,
  type CalendarWriteOverride,
} from "./calendar-sync";

export default class OmdHomePlugin extends Plugin {
  settings: OmdHomeSettings = { ...DEFAULT_SETTINGS };
  deviceLayout: WidgetPlacement[] = DEFAULT_LAYOUT.map((item) => ({ ...item }));
  calendarEvents: CalendarEventRecord[] = [];
  externalCalendars: ExternalCalendarDescriptor[] = [];
  processingEvents: OmdProgressEvent[] = [];
  captureActive = false;
  enrichmentActive = false;
  enrichmentCapability: { status: "unchecked" | "checking" | "ready" | "unavailable"; message: string } = {
    status: "unchecked",
    message: "Not checked this session",
  };
  lastError = "";
  readonly omdCapabilityService = new OmdCapabilityService();
  readonly omdEnrichmentRunner = new OmdEnrichmentRunner();
  private omdBridge!: OmdBridge;
  private eventKitBridge!: EventKitBridge;
  private enrichmentWorkflowController!: EnrichmentWorkflowController;
  private calendarRefresh: Promise<void> | null = null;
  private calendarRefreshTimer: number | null = null;
  private readonly calendarWriteOverrides = new Map<string, CalendarWriteOverride>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.deviceLayout = this.loadDeviceLayout();
    this.omdBridge = new OmdBridge(
      () => this.settings.omdExecutable,
      () => this.settings.pythonExecutable,
      () => this.settings.pythonBridgePath,
    );
    this.eventKitBridge = new EventKitBridge(() => this.settings.eventKitHelperPath);
    this.enrichmentWorkflowController = new EnrichmentWorkflowController(this);
    this.registerView(HOME_VIEW_TYPE, (leaf) => new OmdHomeView(leaf, this));
    this.registerView(CALENDAR_VIEW_TYPE, (leaf) => new OmdCalendarView(leaf, this));
    this.addRibbonIcon("layout-dashboard", "Open OMD Home", () => void this.openHome());
    this.addRibbonIcon("calendar-days", "Open OMD calendar", () => void this.openCalendar());
    this.addCommand({ id: "open-home", name: "Open home", callback: () => void this.openHome() });
    this.addCommand({ id: "open-calendar", name: "Open calendar", callback: () => void this.openCalendar() });
    this.addCommand({ id: "new-event", name: "Create event", callback: () => void this.createCalendarEvent() });
    this.addCommand({
      id: "sync-calendar",
      name: "Sync linked calendar events",
      callback: () => void this.synchronizeCalendarEvents()
        .then(() => new Notice("Calendar sync complete"))
        .catch((error) => new Notice(message(error))),
    });
    this.addCommand({ id: "capture-with-omd", name: "Capture URL or file", callback: () => this.openCaptureModal() });
    this.addCommand({ id: "cancel-omd", name: "Cancel active OMD action", callback: () => this.cancelActiveOmd() });
    this.addCommand({ id: "suggest-links-and-tags", name: "Suggest links and tags", callback: () => void this.suggestLinksAndTags() });
    this.addCommand({
      id: "focus-omnibox",
      name: "Focus omnibox",
      callback: async () => {
        const leaf = await this.openHome();
        if (leaf.view instanceof OmdHomeView) leaf.view.focusOmnibox();
      },
    });
    this.addSettingTab(new OmdHomeSettingTab(this.app, this));

    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (file.path.startsWith("Calendar/Events/")) this.scheduleCalendarRefresh();
    }));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile)) return;
      const pinned = this.settings.pinnedNotes.includes(file.path);
      menu.addItem((item) => item
        .setTitle(pinned ? "Unpin from OMD Home" : "Pin to OMD Home")
        .setIcon("pin")
        .onClick(async () => {
          this.settings.pinnedNotes = pinned
            ? this.settings.pinnedNotes.filter((path) => path !== file.path)
            : [...this.settings.pinnedNotes, file.path];
          await this.saveSettings();
          this.refreshHomeViews();
        }));
      if (file.extension === "md") {
        menu.addItem((item) => item
          .setTitle("Suggest links and tags")
          .setIcon("sparkles")
          .onClick(() => void this.suggestLinksAndTags(file)));
      }
    }));

    this.app.workspace.onLayoutReady(() => {
      void this.refreshCalendarEvents();
      if (Platform.isMacOS && this.settings.eventKitHelperPath) void this.refreshExternalCalendars();
      if (this.settings.openOnLaunch) void this.openHome(false);
    });
  }

  onunload(): void {
    if (this.calendarRefreshTimer !== null) window.clearTimeout(this.calendarRefreshTimer);
    this.calendarWriteOverrides.clear();
    this.omdCapabilityService.dispose();
    this.omdEnrichmentRunner.dispose();
    this.enrichmentWorkflowController?.dispose();
    this.eventKitBridge?.dispose();
    this.omdBridge?.dispose?.();
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeOmdHomeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  async openHome(focus = true): Promise<WorkspaceLeaf> {
    let leaf = this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: HOME_VIEW_TYPE, active: focus });
    }
    if (focus) await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async openCalendar(): Promise<WorkspaceLeaf> {
    let leaf = this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: CALENDAR_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  async createCalendarEvent(): Promise<void> {
    const leaf = await this.openCalendar();
    if (!(leaf.view instanceof OmdCalendarView)) throw new Error("OMD Calendar is still loading. Try again.");
    leaf.view.createEvent();
  }

  openCaptureModal(): void {
    new CaptureModal(
      this.app,
      this.settings.capturePolish,
      this.settings.capturePolishModel,
      async (enabled) => {
        this.settings.capturePolish = enabled;
        await this.saveSettings();
      },
      async (source, tags, polish) => this.captureWithOmd(source, tags, polish),
    ).open();
  }

  async openTagSearch(tag: string): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: "search", active: true, state: { query: `tag:#${tag}` } });
    await this.app.workspace.revealLeaf(leaf);
  }

  async saveDeviceLayout(layout: WidgetPlacement[]): Promise<void> {
    this.deviceLayout = normalizeLayout(layout);
    this.app.saveLocalStorage(this.layoutStorageKey(), this.deviceLayout);
  }

  async captureWithOmd(source: string, tags: string[] = [], polish = this.settings.capturePolish): Promise<void> {
    if (this.captureActive || this.enrichmentActive) {
      new Notice("Another OMD action is already active.");
      return;
    }
    this.captureActive = true;
    this.processingEvents = [];
    this.refreshHomeViews();
    try {
      this.lastError = "";
      const vault = this.vaultPath();
      const outputPath = await this.omdBridge.capture(source, vault, tags, {
        enabled: polish,
        model: this.settings.capturePolishModel,
        host: this.settings.ollamaHost,
      }, (event) => {
        this.processingEvents.push(event);
        this.processingEvents = this.processingEvents.slice(-40);
        this.refreshHomeViews();
      });
      const vaultRelative = capturedOutputVaultPath(outputPath, vault);
      if (!vaultRelative) {
        new Notice("Capture completed, but OMD did not return a verifiable vault note path. The note was not added to OMD inbox.");
      } else {
        const inspection = await inspectVaultRelativeMarkdownPath(vault, vaultRelative);
        const file = inspection.ok && inspection.normalizedPath
          ? this.app.vault.getFileByPath(inspection.normalizedPath)
          : null;
        if (file instanceof TFile) {
          await this.refreshInboxStatus(file, "inbox");
        } else {
          new Notice("Capture completed, but its output path could not be verified. The note was not added to OMD inbox.");
        }
      }
      new Notice("OMD capture complete");
      await this.refreshCalendarEvents();
    } catch (error) {
      this.lastError = message(error);
      this.processingEvents.push({
        v: 1,
        event: this.lastError.toLowerCase().includes("abort") ? "cancelled" : "error",
        kind: this.lastError.toLowerCase().includes("abort") ? "cancelled" : "error",
        ts: Date.now() / 1000,
        message: this.lastError,
      });
      this.processingEvents = this.processingEvents.slice(-40);
      new Notice(this.lastError);
      this.refreshHomeViews();
    } finally {
      this.captureActive = false;
      this.refreshHomeViews();
    }
  }

  cancelActiveOmd(): void {
    let cancelled = false;
    if (this.captureActive) {
      this.omdBridge.cancelActive();
      cancelled = true;
    }
    if (this.enrichmentActive) {
      this.omdEnrichmentRunner.cancel();
      this.omdCapabilityService.cancelActive(this.settings.omdExecutable);
      this.enrichmentActive = false;
      this.refreshHomeViews();
      cancelled = true;
    }
    if (!cancelled) new Notice("OMD is idle");
  }

  async searchWithOmd(query: string, output: HTMLElement): Promise<void> {
    try {
      const hits = await this.omdBridge.search(this.vaultPath(), query);
      output.empty();
      output.hidden = false;
      if (!hits.length) return void output.createDiv({ cls: "omd-answer-empty", text: "No matching OMD evidence." });
      for (const hit of hits) {
        const row = output.createEl("button", { cls: "omd-result-row", type: "button" });
        row.createSpan({ cls: "omd-result-title", text: hit.title });
        row.createSpan({ cls: "omd-result-detail", text: hit.evidence });
        row.addEventListener("click", () => void this.app.workspace.openLinkText(hit.path, "", false));
      }
    } catch (error) { new Notice(message(error)); }
  }

  async askOmd(query: string, output: HTMLElement): Promise<void> {
    if (!query) return void new Notice("Enter a question after @");
    output.hidden = false;
    output.empty();
    output.createDiv({ cls: "omd-answer-loading", text: "Retrieving local evidence..." });
    try {
      const preview = await this.omdBridge.previewAi(
        this.vaultPath(), query, this.settings.aiProvider, this.settings.aiModel, this.settings.ollamaHost,
      );
      const execute = async (): Promise<void> => {
        output.empty();
        output.createDiv({ cls: "omd-answer-loading", text: "OMD is reading the selected evidence..." });
        const answer = await this.omdBridge.executeAi(
          this.vaultPath(), query, this.settings.aiProvider, this.settings.aiModel,
          this.settings.ollamaHost, preview.consent_grant ?? null,
        );
        this.renderAiAnswer(output, answer);
      };
      if (preview.preview.privacy_mode === "cloud_for_this_task") {
        new AiConsentModal(this.app, preview, execute).open();
      } else await execute();
    } catch (error) {
      this.lastError = message(error);
      output.empty();
      output.createDiv({ cls: "omd-answer-error", text: this.lastError });
      new Notice(this.lastError);
    }
  }

  async suggestLinksAndTags(file = this.app.workspace.getActiveFile()): Promise<void> {
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("Open a Markdown note first.");
      return;
    }
    await this.enrichmentWorkflowController.start(file);
  }

  async checkEnrichmentCapability(force = false): Promise<boolean> {
    if (force) this.omdCapabilityService.clear(this.settings.omdExecutable);
    this.enrichmentCapability = { status: "checking", message: "Checking the configured OMD executable…" };
    try {
      await this.omdCapabilityService.requireEnrichNote(this.settings.omdExecutable);
      this.enrichmentCapability = { status: "ready", message: "OMD enrich-note schema v1 is available." };
      return true;
    } catch (error) {
      this.enrichmentCapability = { status: "unavailable", message: toUserFacingEnrichmentMessage(error) };
      return false;
    } finally {
      this.refreshHomeViews();
    }
  }

  resetEnrichmentCapability(): void {
    this.omdCapabilityService.clear();
    this.enrichmentCapability = { status: "unchecked", message: "Not checked since the executable changed" };
    this.refreshHomeViews();
  }

  async refreshExternalCalendars(): Promise<void> {
    if (!Platform.isMacOS) throw new Error("Apple Calendar integration is available on macOS only");
    try {
      this.externalCalendars = await this.eventKitBridge.calendars();
      const reconciled = reconcileCalendarSelection(this.settings, this.externalCalendars);
      if (
        reconciled.defaultExternalCalendarId !== this.settings.defaultExternalCalendarId
        || reconciled.selectedCalendarIds.join("\u0000") !== this.settings.selectedCalendarIds.join("\u0000")
      ) {
        this.settings = reconciled;
        await this.saveSettings();
      }
      this.lastError = "";
      await this.refreshCalendarEvents();
    } catch (error) {
      this.lastError = message(error);
      new Notice(this.lastError);
      this.refreshHomeViews();
    }
  }

  async refreshCalendarEvents(): Promise<void> {
    await this.runCalendarRefresh(false);
  }

  async synchronizeCalendarEvents(): Promise<void> {
    if (this.calendarRefresh) await this.calendarRefresh;
    await this.runCalendarRefresh(true);
  }

  private async runCalendarRefresh(reconcile: boolean): Promise<void> {
    if (this.calendarRefresh) return await this.calendarRefresh;
    this.calendarRefresh = this.performCalendarRefresh(reconcile);
    try { await this.calendarRefresh; }
    finally { this.calendarRefresh = null; }
  }

  private async performCalendarRefresh(reconcile: boolean): Promise<void> {
    const vaultEvents: CalendarEventRecord[] = this.app.vault.getMarkdownFiles()
      .flatMap((file): CalendarEventRecord[] => {
        const cached = recordFromFrontmatter(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter ?? {});
        const override = this.calendarWriteOverrides.get(file.path);
        const resolved = resolveCalendarWriteOverride(file.path, file.stat.mtime, cached, override);
        if (override && !resolved.retainOverride) this.calendarWriteOverrides.delete(file.path);
        const record = resolved.event;
        return record ? [{ ...record, vaultModifiedAt: new Date(file.stat.mtime).toISOString() }] : [];
      });
    let external: CalendarEventRecord[] = [];
    let externalFetchFailed = false;
    if (Platform.isMacOS && this.settings.eventKitHelperPath && this.settings.selectedCalendarIds.length) {
      const { start, end } = calendarFetchWindow(vaultEvents);
      try {
        external = await this.eventKitBridge.events(this.settings.selectedCalendarIds, start, end);
        this.lastError = "";
      }
      catch (error) {
        externalFetchFailed = true;
        this.lastError = message(error);
      }
    }
    const externalByKey = new Map<string, CalendarEventRecord>();
    for (const event of external) for (const key of calendarIdentityKeys(event)) externalByKey.set(key, event);
    const usedExternal = new Set<CalendarEventRecord>();
    const synchronized: CalendarEventRecord[] = [];
    for (const vault of vaultEvents) {
      if (vault.source !== "linked") {
        synchronized.push(vault);
        continue;
      }
      const identityKeys = calendarIdentityKeys(vault);
      if (!identityKeys.length) {
        synchronized.push({ ...vault, syncState: "unavailable" });
        continue;
      }
      const outside = identityKeys.map((key) => externalByKey.get(key)).find(Boolean);
      const calendarId = outside?.appleCalendarId ?? vault.appleCalendarId ?? "";
      const availability = classifyLinkedAvailability(
        this.settings.selectedCalendarIds.includes(calendarId),
        externalFetchFailed,
        Boolean(outside),
      );
      if (availability !== "available") {
        synchronized.push({ ...vault, syncState: availability, pendingDirection: undefined });
        continue;
      }
      if (!outside) {
        synchronized.push({ ...vault, syncState: "unavailable", pendingDirection: undefined });
        continue;
      }
      usedExternal.add(outside);
      const change = classifyLinkedChange(vault, outside);
      if (change === "conflict") {
        synchronized.push({ ...vault, syncState: "conflict", conflictExternal: outside });
      } else if (change === "external") {
        if (reconcile) {
          const merged = mergeExternalIntoLinked(vault, outside);
          await this.writeCalendarNote(merged);
          synchronized.push(merged);
        } else synchronized.push({ ...vault, syncState: "pending", pendingDirection: "external", conflictExternal: outside });
      } else if (change === "vault") {
        if (reconcile) {
          if (outside.readOnly) {
            synchronized.push({ ...vault, syncState: "conflict", conflictExternal: outside });
            continue;
          }
          const merged = await this.pushLinkedEventToCalendar({
            ...vault,
            appleCalendarId: outside.appleCalendarId,
            appleItemId: outside.appleItemId,
            appleExternalId: outside.appleExternalId,
            occurrenceDate: outside.occurrenceDate,
          });
          synchronized.push(merged);
        } else synchronized.push({ ...vault, syncState: "pending", pendingDirection: "vault", conflictExternal: outside });
      } else {
        const healed = mergeExternalIntoLinked(vault, outside, vault.lastSyncedAt ?? new Date().toISOString());
        const needsPersistence = !vault.syncHash
          || vault.syncState === "pending"
          || vault.appleItemId !== outside.appleItemId
          || vault.appleExternalId !== outside.appleExternalId
          || vault.occurrenceDate !== outside.occurrenceDate
          || vault.readOnly !== outside.readOnly;
        if (reconcile && needsPersistence) {
          const persisted = await this.writeCalendarNote(healed);
          synchronized.push(persisted);
        } else if (!reconcile && vault.syncState === "pending") {
          synchronized.push({ ...healed, syncState: "pending", pendingDirection: vault.pendingDirection });
        } else synchronized.push(healed);
      }
    }
    this.calendarEvents = [...synchronized, ...external.filter((event) => !usedExternal.has(event))];
    this.refreshOpenViews();
    if (reconcile && externalFetchFailed) throw new Error(this.lastError || "Calendar could not be read safely");
  }

  async resolveCalendarConflict(event: CalendarEventRecord, choice: "vault" | "external"): Promise<void> {
    if (!event.conflictExternal) throw new Error("The Calendar version is no longer available. Refresh and try again.");
    if (choice === "vault" && !this.isSelectedWritableCalendar(event.conflictExternal.appleCalendarId ?? "")) {
      throw new Error("The linked Calendar is no longer selected and writable");
    }
    if (choice === "external") {
      await this.writeCalendarNote(mergeExternalIntoLinked(event, event.conflictExternal));
    } else {
      await this.pushLinkedEventToCalendar({
        ...event,
        appleCalendarId: event.conflictExternal.appleCalendarId,
        appleItemId: event.conflictExternal.appleItemId,
        appleExternalId: event.conflictExternal.appleExternalId,
        occurrenceDate: event.conflictExternal.occurrenceDate,
        conflictExternal: undefined,
      });
    }
    await this.refreshCalendarEvents();
  }

  async saveCalendarEvent(event: CalendarEventRecord): Promise<void> {
    let saved = { ...event };
    if (event.source === "linked") {
      const blockReason = linkedEventSaveBlockReason(event);
      if (blockReason) throw new Error(blockReason);
      const linkingReadOnlyExternal = !event.notePath && Boolean(event.appleItemId) && Boolean(event.readOnly);
      if (linkingReadOnlyExternal) {
        saved = await this.writeCalendarNote({
          ...event,
          source: "linked",
          syncState: "clean",
          pendingDirection: undefined,
          lastSyncedAt: new Date().toISOString(),
          syncHash: eventSyncHash(event),
        });
        await this.refreshCalendarEvents();
        return;
      }
      const targetId = saved.appleCalendarId || this.settings.defaultExternalCalendarId;
      if (!targetId || !this.isSelectedWritableCalendar(targetId)) {
        throw new Error("Choose an explicitly selected writable Calendar in OMD Home settings");
      }
      saved.appleCalendarId = targetId;
      await this.pushLinkedEventToCalendar(saved);
      await this.refreshCalendarEvents();
      return;
    } else if (event.source === "external") {
      if (event.readOnly) throw new Error("This Calendar is read-only. Create a linked vault note instead");
      saved = await this.eventKitBridge.upsert(saved);
    } else if (event.appleItemId) {
      throw new Error("Choose whether to detach the note or also delete its Calendar event");
    }
    if (saved.source !== "external") {
      await this.ensureFolder("Calendar/Events");
      await this.writeCalendarNote(saved);
    }
    await this.refreshCalendarEvents();
  }

  async detachCalendarEvent(event: CalendarEventRecord, deleteExternal: boolean): Promise<void> {
    if (event.source === "external") {
      if (deleteExternal && event.appleItemId) await this.eventKitBridge.remove(event.appleItemId);
      await this.refreshCalendarEvents();
      return;
    }
    const detached = detachLinkedEvent(event);
    await this.writeCalendarNote(detached);
    if (deleteExternal && event.appleItemId) {
      try { await this.eventKitBridge.remove(event.appleItemId); }
      catch (error) {
        await this.refreshCalendarEvents();
        throw new Error(`The note was detached safely, but Calendar deletion failed: ${message(error)}`);
      }
    }
    await this.refreshCalendarEvents();
  }

  async recreateCalendarEvent(event: CalendarEventRecord): Promise<void> {
    await this.saveCalendarEvent({
      ...event,
      source: "linked",
      appleCalendarId: this.settings.defaultExternalCalendarId,
      appleItemId: undefined,
      appleExternalId: undefined,
      occurrenceDate: undefined,
      syncHash: undefined,
      syncState: "pending",
      pendingDirection: "vault",
      conflictExternal: undefined,
    });
  }

  private async pushLinkedEventToCalendar(event: CalendarEventRecord): Promise<CalendarEventRecord> {
    const hadExternalIdentity = Boolean(event.appleItemId);
    const staged = await this.writeCalendarNote({
      ...event,
      source: "linked",
      syncState: "pending",
      pendingDirection: "vault",
      conflictExternal: undefined,
    });
    const savedOutside = await this.eventKitBridge.upsert(staged);
    const merged = mergeExternalIntoLinked(staged, savedOutside);
    try {
      return await this.writeCalendarNote(merged);
    } catch (firstError) {
      try {
        return await this.writeCalendarNote(merged);
      } catch {
        if (!hadExternalIdentity && savedOutside.appleItemId) {
          let rollbackError: unknown;
          try { await this.eventKitBridge.remove(savedOutside.appleItemId); }
          catch (error) { rollbackError = error; }
          if (!rollbackError) {
            throw new Error(`Calendar creation was rolled back because the note could not be finalized. The pending note was preserved: ${message(firstError)}`);
          }
          throw new Error(`The pending note was preserved, but its new Calendar copy could not be rolled back. Delete Calendar item ${savedOutside.appleItemId} manually, then use Recreate: ${message(rollbackError)}`);
        }
        throw new Error(`Calendar was updated, while the note remains safely marked pending. Run Sync to finalize it: ${message(firstError)}`);
      }
    }
  }

  private async writeCalendarNote(event: CalendarEventRecord): Promise<CalendarEventRecord> {
    const normalized = normalizeEventKitEvent(event);
    await this.ensureFolder("Calendar/Events");
    const existing = normalized.notePath ? this.app.vault.getFileByPath(normalized.notePath) : null;
    if (existing) {
      await this.app.vault.process(existing, (current) => updateEventNote(current, normalized));
      const saved = { ...normalized, notePath: existing.path };
      const currentFile = this.app.vault.getFileByPath(existing.path);
      this.calendarWriteOverrides.set(existing.path, {
        event: saved,
        modifiedAt: currentFile?.stat.mtime ?? existing.stat.mtime,
      });
      return saved;
    } else {
      const path = await this.uniquePath(eventNotePath(normalized));
      const file = await this.app.vault.create(path, serializeEventNote({ ...normalized, notePath: path }));
      const saved = { ...normalized, notePath: file.path };
      this.calendarWriteOverrides.set(file.path, { event: saved, modifiedAt: file.stat.mtime });
      return saved;
    }
  }

  async ensureFolder(path: string): Promise<void> {
    const parts = normalizePath(path).split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }

  async uniquePath(path: string): Promise<string> {
    const normalized = normalizePath(path);
    if (!this.app.vault.getAbstractFileByPath(normalized)) return normalized;
    const dot = normalized.lastIndexOf(".");
    const stem = dot > 0 ? normalized.slice(0, dot) : normalized;
    const extension = dot > 0 ? normalized.slice(dot) : "";
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${stem}-${index}${extension}`;
      if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
    }
    throw new Error("Could not allocate a unique note path");
  }

  listInboxFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles()
      .filter((file) => isOmdInboxNote(file.path, this.app.metadataCache.getFileCache(file)?.frontmatter))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  async refreshInboxStatus(file: TFile, status: "inbox" | "reviewed"): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      (frontmatter as Record<string, unknown>).omd_home_status = status;
    });
  }

  private renderAiAnswer(output: HTMLElement, answer: AiAnswer): void {
    output.empty();
    output.hidden = false;
    const header = output.createDiv({ cls: "omd-answer-meta" });
    header.createSpan({ text: `${answer.provider} / ${answer.model}` });
    header.createSpan({ text: `${answer.evidence.length} sources` });
    output.createEl("p", { cls: "omd-answer-text", text: answer.text });
    const sources = output.createDiv({ cls: "omd-answer-sources" });
    for (const hit of answer.evidence) {
      const link = sources.createEl("button", { cls: "omd-source-link", type: "button", text: hit.path });
      link.addEventListener("click", () => void this.app.workspace.openLinkText(hit.path, "", false));
    }
  }

  private refreshOpenViews(): void {
    this.refreshHomeViews();
    for (const leaf of this.app.workspace.getLeavesOfType(CALENDAR_VIEW_TYPE)) {
      if (leaf.view instanceof OmdCalendarView) leaf.view.render();
    }
  }

  refreshHomeViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
      if (leaf.view instanceof OmdHomeView) leaf.view.render();
    }
  }

  private loadDeviceLayout(): WidgetPlacement[] {
    try {
      const key = this.layoutStorageKey();
      const primaryValue: unknown = this.app.loadLocalStorage(key);
      const legacyValue: unknown = this.app.loadLocalStorage(this.legacyLayoutStorageKey());
      const storedValue = primaryValue ?? legacyValue;
      const stored = typeof storedValue === "string"
        ? storedValue
        : storedValue === null
          ? null
          : JSON.stringify(storedValue);
      if (!stored) return DEFAULT_LAYOUT.map((item) => ({ ...item }));
      const layout = normalizeLayout(JSON.parse(stored) as WidgetPlacement[]);
      if (this.app.loadLocalStorage(key) === null) this.app.saveLocalStorage(key, layout);
      return layout;
    } catch { return DEFAULT_LAYOUT.map((item) => ({ ...item })); }
  }

  private layoutStorageKey(): string {
    const adapter = this.app.vault.adapter;
    const vaultIdentity = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : this.app.vault.getName();
    const viewport = window.innerWidth < 900 ? "compact" : "wide";
    return `omd-home:layout:${encodeURIComponent(vaultIdentity)}:${viewport}`;
  }

  private legacyLayoutStorageKey(): string { return `omd-home:layout:${this.app.vault.getName()}:wide`; }

  private isSelectedWritableCalendar(id: string): boolean {
    return isSelectedWritableCalendar(id, this.settings.selectedCalendarIds, this.externalCalendars);
  }

  private scheduleCalendarRefresh(): void {
    if (this.calendarRefreshTimer !== null) window.clearTimeout(this.calendarRefreshTimer);
    this.calendarRefreshTimer = window.setTimeout(() => {
      this.calendarRefreshTimer = null;
      void this.refreshCalendarEvents();
    }, 250);
  }

  private vaultPath(): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error("This OMD action requires a desktop filesystem vault");
    return adapter.getBasePath();
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
