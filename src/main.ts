import {
  FileSystemAdapter,
  Notice,
  Platform,
  Plugin,
  TFile,
  normalizePath,
  type WorkspaceLeaf,
} from "obsidian";
import embeddedPythonBridge from "../bridge/omd_home_bridge.py";
import { formatAiAnswerForClipboard, formatAnswerElapsedTime } from "./ai-answer";
import { HOME_VIEW_TYPE, OmdHomeView } from "./home-view";
import { CALENDAR_VIEW_TYPE, OmdCalendarView } from "./calendar-view";
import { DEFAULT_LAYOUT, migrateLegacyLayout, normalizeLayout } from "./layout";
import type { CalendarEventRecord, ExternalCalendarDescriptor, OmdProgressEvent, WidgetPlacement } from "./model";
import {
  DEFAULT_SETTINGS,
  normalizeOmdHomeSettings,
  OmdHomeSettingTab,
  reconcileCalendarSelection,
  type OmdHomeSettings,
} from "./settings";
import { OmdBridge, type AiAnswer, type HybridRetrievalOptions } from "./omd-bridge";
import {
  EventKitBridge,
  isEventKitHelperAvailable,
  normalizeEventKitEvent,
  resolveEventKitHelperPath,
} from "./eventkit-bridge";
import { eventNotePath, recordFromFrontmatter, serializeEventNote, updateEventNote } from "./event-note";
import { AiConsentModal, CaptureModal } from "./modals";
import { OmdCapabilityService } from "./enrichment/capability";
import { EnrichmentWorkflowController } from "./enrichment/controller.ts";
import { OmdEnrichmentRunner } from "./enrichment/runner";
import { toUserFacingEnrichmentMessage } from "./enrichment/errors.ts";
import { inspectVaultRelativeMarkdownPath } from "./enrichment/path-safety.ts";
import { capturedOutputVaultPath, isOmdInboxNote } from "./inbox";
import { normalizeCaptureSource } from "./omnibox-utils";
import { executeWithLocalAiGate } from "./local-ai-execution";
import {
  aggregateLocalAiState,
  buildConnectionSummary,
  buildModelEntry,
  createWorkflowSnapshot,
  deriveLocalAiDaemonCode,
  deriveLocalAiModelCode,
  describeDaemonReadiness,
  describeModelReadiness,
  getActiveWorkflowModels,
  isFresh,
  mergeInspectedModelEntry,
  modelHasRemoteMetadata,
  modelSupportsEmbedding,
  normalizeLocalOllamaHost,
  providerMode,
  resolveEmbeddingModelRevision,
} from "./local-ai-readiness";
import { OllamaLocalClient } from "./ollama-local-client";
import {
  LocalAiError,
  type LocalAiActionFeedback,
  type LocalAiConnectionSummary,
  type LocalAiModelInfo,
  type LocalAiRuntimeState,
  type LocalAiSnapshot,
  type LocalAiWorkflowId,
} from "./ollama-local-types";
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
  enrichmentCapability: {
    status: "unchecked" | "checking" | "ready" | "unavailable";
    message: string;
    checkedAt?: number;
  } = {
    status: "unchecked",
    message: "Not checked this session",
  };
  localAiState: LocalAiRuntimeState = aggregateLocalAiState(this.settings, null, [], "");
  localAiFeedback: LocalAiActionFeedback | null = null;
  calendarFeedback: LocalAiActionFeedback | null = null;
  lastError = "";
  lastErrorAt = 0;
  lastErrorContext: "" | "capture" | "calendar" | "ai" | "inbox" = "";
  lastErrorSource = "";
  readonly omdCapabilityService = new OmdCapabilityService();
  readonly omdEnrichmentRunner = new OmdEnrichmentRunner();
  private omdBridge!: OmdBridge;
  private readonly ollamaLocalClient = new OllamaLocalClient();
  private eventKitBridge!: EventKitBridge;
  private enrichmentWorkflowController!: EnrichmentWorkflowController;
  private readonly localAiSummaries = new Map<string, LocalAiConnectionSummary>();
  private localAiFailure: LocalAiConnectionSummary | null = null;
  private calendarRefresh: Promise<void> | null = null;
  calendarLoading = false;
  private calendarRefreshTimer: number | null = null;
  private readonly calendarWriteOverrides = new Map<string, CalendarWriteOverride>();
  private readonly localAiControllers = new Set<AbortController>();
  private localAiActionToken = 0;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.deviceLayout = this.loadDeviceLayout();
    this.omdBridge = new OmdBridge(
      () => this.settings.omdExecutable,
      () => this.settings.pythonExecutable,
      () => this.settings.pythonBridgePath,
      () => embeddedPythonBridge,
    );
    this.eventKitBridge = new EventKitBridge(() => this.resolvedEventKitHelperPath());
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
    this.addCommand({ id: "refresh-local-models", name: "Refresh local AI models", callback: () => void this.refreshLocalAiCatalog(true) });
    this.addCommand({ id: "check-local-ai", name: "Check local AI connection", callback: () => void this.checkLocalAiConnection() });
    this.addCommand({ id: "test-local-ai-embeddings", name: "Test local AI embeddings", callback: () => void this.testLocalEmbeddings() });
    this.addCommand({ id: "refresh-calendars", name: "Refresh macOS calendars", callback: () => void this.refreshExternalCalendars() });
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
      void this.checkEnrichmentCapability();
      void this.ensureLocalAiCatalog();
      if (Platform.isMacOS && this.hasEventKitHelper()) void this.refreshExternalCalendars(false);
      if (this.settings.openOnLaunch) void this.openHome(false);
    });
  }

  onunload(): void {
    if (this.calendarRefreshTimer !== null) window.clearTimeout(this.calendarRefreshTimer);
    this.calendarWriteOverrides.clear();
    for (const controller of this.localAiControllers) controller.abort();
    this.localAiControllers.clear();
    this.omdCapabilityService.dispose();
    this.omdEnrichmentRunner.dispose();
    this.enrichmentWorkflowController?.dispose();
    this.eventKitBridge?.dispose();
    this.omdBridge?.dispose?.();
    this.localAiSummaries.clear();
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeOmdHomeSettings(await this.loadData());
    this.syncLocalAiState("");
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.syncLocalAiState(this.localAiState.activeAction);
  }

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

  openCaptureModal(initialSource = ""): void {
    new CaptureModal(
      this.app,
      initialSource,
      this.settings.capturePolish,
      this.settings.capturePolishModel,
      this.settings.captureSuggestLinksAndTags,
      async (enabled) => {
        this.settings.capturePolish = enabled;
        this.invalidateLocalAiState("capture-polish");
        await this.saveSettings();
      },
      async (enabled) => {
        this.settings.captureSuggestLinksAndTags = enabled;
        await this.saveSettings();
      },
      async (source, tags, polish, suggestLinksAndTags) => this.captureWithOmd(
        source,
        tags,
        polish,
        suggestLinksAndTags,
      ),
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

  async captureWithOmd(
    source: string,
    tags: string[] = [],
    polish = this.settings.capturePolish,
    suggestLinksAndTags = this.settings.captureSuggestLinksAndTags,
  ): Promise<void> {
    if (this.captureActive || this.enrichmentActive) {
      new Notice("Another OMD action is already active.");
      return;
    }
    const normalizedSource = normalizeCaptureSource(source);
    if (!normalizedSource) {
      new Notice("Enter a URL or local file path.");
      return;
    }
    this.captureActive = true;
    this.processingEvents = [];
    this.refreshHomeViews();
    let capturedFile: TFile | null = null;
    let completed = false;
    try {
      this.clearIssue("capture");
      const vault = this.vaultPath();
      const snapshot = createWorkflowSnapshot("capture", this.settings, polish);
      const outputPath = await this.runLocalAiGated(
        snapshot,
        () => createWorkflowSnapshot("capture", this.settings, polish),
        async (gatedSnapshot) => await this.omdBridge.capture(normalizedSource, vault, tags, {
          enabled: gatedSnapshot.enabled,
          model: gatedSnapshot.model,
          host: gatedSnapshot.host,
        }, (event) => {
          this.processingEvents.push(event);
          this.processingEvents = this.processingEvents.slice(-40);
          this.refreshHomeViews();
        }),
      );
      const vaultRelative = capturedOutputVaultPath(outputPath, vault);
      if (!vaultRelative) {
        new Notice("Capture completed, but OMD did not return a verifiable vault note path. The note was not added to OMD inbox.");
      } else {
        const inspection = await inspectVaultRelativeMarkdownPath(vault, vaultRelative);
        const file = inspection.ok && inspection.normalizedPath
          ? this.app.vault.getFileByPath(inspection.normalizedPath)
          : null;
        if (file instanceof TFile) {
          capturedFile = file;
          try {
            await this.refreshInboxStatus(file, "inbox");
          } catch (error) {
            this.recordIssue("inbox", error, file.path);
            new Notice(`Capture completed, but OMD Home could not mark the note as Inbox: ${this.lastError}`);
            this.refreshHomeViews();
          }
        } else {
          new Notice("Capture completed, but its output path could not be verified. The note was not added to OMD inbox.");
        }
      }
      completed = true;
      new Notice("OMD capture complete");
    } catch (error) {
      const detail = message(error);
      const cancelled = isAbortError(error) || /\bcancelled\b/u.test(detail.toLowerCase());
      if (cancelled) {
        this.clearIssue("capture");
      } else if (error instanceof LocalAiError) {
        if (error.code === "invalid_host") this.setLocalAiFailure(error);
        else this.recordIssue("ai", error);
      } else {
        this.recordIssue("capture", error, normalizedSource);
      }
      this.processingEvents.push({
        v: 1,
        event: cancelled ? "cancelled" : "error",
        kind: cancelled ? "cancelled" : "error",
        ts: Date.now() / 1000,
        message: detail,
      });
      this.processingEvents = this.processingEvents.slice(-40);
      new Notice(detail);
      this.refreshHomeViews();
    } finally {
      this.captureActive = false;
      this.refreshHomeViews();
    }
    if (completed) {
      try {
        await this.refreshCalendarEvents();
      } catch (error) {
        this.recordIssue("calendar", error);
        new Notice(`Capture completed, but the calendar could not refresh: ${this.lastError}`);
        this.refreshHomeViews();
      }
    }
    if (completed && capturedFile && suggestLinksAndTags) {
      await this.suggestLinksAndTags(capturedFile);
    }
  }

  cancelActiveOmd(): void {
    let cancelled = false;
    if (this.captureActive) {
      this.cancelLocalAiRequests();
      this.omdBridge.cancelActive();
      cancelled = true;
    }
    if (this.enrichmentActive) {
      cancelled = this.enrichmentWorkflowController.cancel(false) || cancelled;
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
    if (providerMode(this.settings.aiProvider) !== "ollama") {
      const detail = `Saved provider ${this.settings.aiProvider} is disabled in Phase 1a. Select Ollama in OMD Home settings before using vault AI.`;
      this.recordIssue("ai", new Error(detail));
      output.hidden = false;
      output.empty();
      output.createDiv({ cls: "omd-answer-error", text: detail });
      new Notice(detail);
      this.refreshHomeViews();
      return;
    }
    output.hidden = false;
    output.empty();
    let retrievalOptions = this.qaRetrievalOptions();
    output.createDiv({
      cls: "omd-answer-loading",
      text: retrievalOptions.hybridRetrievalEnabled
        ? "Preparing local hybrid evidence. First use can take longer..."
        : "Retrieving local evidence...",
    });
    const startedAt = performance.now();
    try {
      const snapshot = createWorkflowSnapshot("qa", this.settings, this.settings.aiProvider === "ollama");
      const preview = await this.runLocalAiGated(
        snapshot,
        () => createWorkflowSnapshot("qa", this.settings, this.settings.aiProvider === "ollama"),
        async (gatedSnapshot, signal) => {
          retrievalOptions = this.qaRetrievalOptions();
          return await this.omdBridge.previewAi(
            this.vaultPath(),
            query,
            gatedSnapshot.provider,
            gatedSnapshot.model,
            gatedSnapshot.host,
            retrievalOptions,
            signal,
          );
        },
      );
      const execute = async (): Promise<void> => {
        output.empty();
        output.createDiv({ cls: "omd-answer-loading", text: "OMD is reading the selected evidence..." });
        const answer = await this.runLocalAiGated(
          snapshot,
          () => createWorkflowSnapshot("qa", this.settings, this.settings.aiProvider === "ollama"),
          async (gatedSnapshot, signal) => await this.omdBridge.executeAi(
            this.vaultPath(),
            query,
            gatedSnapshot.provider,
            gatedSnapshot.model,
            gatedSnapshot.host,
            preview.consent_grant ?? null,
            retrievalOptions,
            signal,
          ),
        );
        this.clearIssue("ai");
        this.renderAiAnswer(output, answer, performance.now() - startedAt);
      };
      if (preview.preview.privacy_mode === "cloud_for_this_task") {
        new AiConsentModal(this.app, preview, execute).open();
      } else await execute();
    } catch (error) {
      this.reportLocalAiWorkflowIssue(error);
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

  reportEnrichmentIssue(error: unknown, source = ""): void {
    this.reportLocalAiWorkflowIssue(error, source);
  }

  clearEnrichmentIssue(): void {
    this.clearIssue("ai");
    this.refreshHomeViews();
  }

  async checkEnrichmentCapability(force = false): Promise<boolean> {
    if (force) this.omdCapabilityService.clear(this.settings.omdExecutable);
    this.enrichmentCapability = {
      status: "checking",
      message: "Checking the configured OMD executable…",
      checkedAt: Date.now(),
    };
    try {
      await this.omdCapabilityService.requireEnrichNote(this.settings.omdExecutable);
      this.enrichmentCapability = {
        status: "ready",
        message: "OMD enrich-note schema v1 is available.",
        checkedAt: Date.now(),
      };
      return true;
    } catch (error) {
      this.enrichmentCapability = {
        status: "unavailable",
        message: toUserFacingEnrichmentMessage(error),
        checkedAt: Date.now(),
      };
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

  invalidateLocalAiState(reason: "provider" | "host" | "model" | "capture-polish" | "retrieval" = "model"): void {
    this.localAiActionToken += 1;
    this.cancelLocalAiRequests();
    this.localAiFailure = null;
    const host = this.currentLocalAiHost();
    const summary = host ? this.localAiSummaries.get(host) : null;
    if ((reason === "model" || reason === "capture-polish") && host && summary) {
      this.localAiSummaries.set(host, {
        ...summary,
        modelChecks: {},
      });
    }
    this.syncLocalAiState("");
  }

  cancelLocalAiRequests(): void {
    for (const controller of this.localAiControllers) controller.abort();
    this.localAiControllers.clear();
  }

  cancelLocalAiAction(): void {
    this.localAiActionToken += 1;
    this.cancelLocalAiRequests();
    this.setLocalAiFeedback("neutral", "Local AI action cancelled.");
    this.syncLocalAiState("");
  }

  async ensureLocalAiCatalog(): Promise<void> {
    if (isFresh(this.localAiState.catalogCheckedAt)) return;
    await this.refreshLocalAiCatalog(false);
  }

  async refreshLocalAiCatalog(force = true): Promise<void> {
    if (this.localAiState.activeAction) return;
    this.clearIssue("ai");
    this.setLocalAiFeedback("neutral", "Refreshing installed Ollama models…");
    const actionToken = this.beginLocalAiAction("refresh-models");
    try {
      const host = normalizeLocalOllamaHost(this.settings.ollamaHost);
      const checkedAt = Date.now();
      const { version, models } = await this.withLocalAiSignal(async (signal) => ({
        version: await this.ollamaLocalClient.version(host, signal),
        models: await this.ollamaLocalClient.tags(host, signal),
      }));
      const previous = !force ? this.localAiSummaries.get(host) : null;
      this.localAiSummaries.set(host, buildConnectionSummary({
        host,
        checkedAt,
        version: version.version,
        daemonCode: previous?.daemonCode ?? "unchecked",
        daemonDetail: previous?.daemonDetail ?? "Run Check connection to validate the local daemon and selected models.",
        models,
        modelChecks: previous?.modelChecks ?? {},
      }));
      this.localAiFailure = null;
      this.clearIssue("ai");
      const label = models.length === 1 ? "model" : "models";
      const feedback = `Model refresh complete. Found ${models.length} installed ${label}.`;
      this.setLocalAiFeedback("success", feedback);
      if (force) new Notice(feedback);
    } catch (error) {
      if (!isAbortError(error)) {
        this.setLocalAiFailure(error);
        this.setLocalAiFeedback("error", `Model refresh failed. ${message(error)}`);
        if (force) new Notice(message(error));
      }
    } finally {
      this.finishLocalAiAction(actionToken);
    }
  }

  async checkLocalAiConnection(): Promise<boolean> {
    this.clearIssue("ai");
    this.setLocalAiFeedback("neutral", "Checking Ollama, local-only policy, and selected models…");
    const actionToken = this.beginLocalAiAction("check-connection");
    try {
      const host = normalizeLocalOllamaHost(this.settings.ollamaHost);
      const checkedAt = Date.now();
      const checked = await this.withLocalAiSignal(async (signal) => {
        const version = await this.ollamaLocalClient.version(host, signal);
        const status = await this.ollamaLocalClient.status(host, signal)
          .catch((error) => {
            throw remapLocalAiError(error, "status_unavailable", "OMD Home could not verify /api/status from the local Ollama daemon.");
          });
        const catalog = await this.ollamaLocalClient.tags(host, signal);
        const daemonCode = deriveLocalAiDaemonCode(status, catalog);
        const modelChecks: Record<string, LocalAiConnectionSummary["modelChecks"][string]> = {};
        const catalogByName = new Map(catalog.map((model) => [model.name, model]));
        if (daemonCode === "ready") {
          for (const model of this.activeLocalAiModels()) {
            try {
              const info = await this.safeShowModel(host, model, signal);
              const entry = buildModelEntry(info);
              catalogByName.set(model, mergeInspectedModelEntry(catalogByName.get(model), entry, model));
              const code = deriveLocalAiModelCode(info);
              modelChecks[model] = {
                model,
                checkedAt,
                code,
                detail: describeModelReadiness(model, info),
                supportsCompletion: entry.supportsCompletion,
              };
            } catch (error) {
              if (!(error instanceof LocalAiError) || error.code !== "selected_model_missing") throw error;
              modelChecks[model] = {
                model,
                checkedAt,
                code: error.code,
                detail: error.message,
                supportsCompletion: false,
              };
            }
          }
        }
        return {
          version,
          daemonCode,
          models: [...catalogByName.values()].sort((left, right) => left.name.localeCompare(right.name)),
          modelChecks,
        };
      });
      this.localAiSummaries.set(host, buildConnectionSummary({
        host,
        checkedAt,
        version: checked.version.version,
        daemonCode: checked.daemonCode,
        daemonDetail: describeDaemonReadiness(checked.daemonCode),
        models: checked.models,
        modelChecks: checked.modelChecks,
      }));
      this.localAiFailure = null;
      this.clearIssue("ai");
      this.syncLocalAiState(this.localAiState.activeAction);
      const ready = this.localAiState.daemonCode === "ready";
      const feedback = ready
        ? `Connection ready. Ollama ${checked.version.version}; ${checked.models.length} installed ${checked.models.length === 1 ? "model" : "models"}.`
        : `Connection checked. ${this.localAiState.daemonDetail}`;
      this.setLocalAiFeedback(ready ? "success" : "error", feedback);
      new Notice(feedback);
      return ready;
    } catch (error) {
      if (!isAbortError(error)) {
        this.setLocalAiFailure(error);
        this.setLocalAiFeedback("error", `Connection failed. ${message(error)}`);
        new Notice(message(error));
      }
      return false;
    } finally {
      this.finishLocalAiAction(actionToken);
    }
  }

  async smokeLocalAiWorkflow(workflow: LocalAiWorkflowId): Promise<void> {
    this.clearIssue("ai");
    this.setLocalAiFeedback("neutral", `Running ${localAiWorkflowLabel(workflow)} smoke test…`);
    const actionToken = this.beginLocalAiAction(`smoke:${workflow}`);
    try {
      if (workflow === "qa" && providerMode(this.settings.aiProvider) !== "ollama") {
        throw new LocalAiError("unchecked", "Select Ollama before testing the Vault Q&A model.");
      }
      const snapshot = createWorkflowSnapshot(workflow, this.settings);
      const result = await this.runLocalAiGated(
        snapshot,
        () => createWorkflowSnapshot(workflow, this.settings),
        async (gatedSnapshot, signal) => {
          const smoke = await this.ollamaLocalClient.smoke(gatedSnapshot.host, gatedSnapshot.model, signal);
          if (smoke.remoteModel || smoke.remoteHost) {
            throw new LocalAiError("selected_model_remote_blocked", "The smoke response reported remote Ollama metadata and was blocked.");
          }
          return smoke;
        },
      );
      const feedback = `${localAiWorkflowLabel(workflow)} smoke passed in ${result.latencyMs}ms: ${summarizeSmokeResponse(result.responseText)}`;
      this.setLocalAiFeedback("success", feedback);
      new Notice(feedback);
    } catch (error) {
      if (!isAbortError(error)) {
        this.reportLocalAiWorkflowIssue(error);
        this.setLocalAiFeedback("error", `${localAiWorkflowLabel(workflow)} smoke failed. ${message(error)}`);
        new Notice(message(error));
      }
    } finally {
      this.finishLocalAiAction(actionToken);
    }
  }

  async testLocalEmbeddings(): Promise<void> {
    this.clearIssue("ai");
    this.setLocalAiFeedback("neutral", "Testing local embedding retrieval model…");
    const actionToken = this.beginLocalAiAction("test-embeddings");
    try {
      const host = normalizeLocalOllamaHost(this.settings.ollamaHost);
      const model = this.settings.embeddingModel.trim();
      if (!model) throw new LocalAiError("selected_model_missing", "Choose a local embedding model before testing embeddings.");
      const result = await this.withLocalAiSignal(async (signal) => {
        const version = await this.ollamaLocalClient.version(host, signal);
        const status = await this.ollamaLocalClient.status(host, signal)
          .catch((error) => {
            throw remapLocalAiError(error, "status_unavailable", "OMD Home could not verify /api/status from the local Ollama daemon.");
          });
        const models = await this.ollamaLocalClient.tags(host, signal);
        const daemonCode = deriveLocalAiDaemonCode(status, models);
        if (daemonCode !== "ready") throw new LocalAiError(daemonCode, describeDaemonReadiness(daemonCode));
        const selected = await this.safeShowModel(host, model, signal);
        const selectedEntry = buildModelEntry(selected);
        const mergedModels = new Map(models.map((entry) => [entry.name, entry]));
        mergedModels.set(model, mergeInspectedModelEntry(mergedModels.get(model), selectedEntry, model));
        this.localAiSummaries.set(host, buildConnectionSummary({
          host,
          checkedAt: Date.now(),
          version: version.version,
          daemonCode,
          daemonDetail: describeDaemonReadiness(daemonCode),
          models: [...mergedModels.values()].sort((left, right) => left.name.localeCompare(right.name)),
          modelChecks: this.localAiSummaries.get(host)?.modelChecks ?? {},
        }));
        if (modelHasRemoteMetadata(selectedEntry)) {
          throw new LocalAiError("selected_model_remote_blocked", `${model} reported remote Ollama metadata and was blocked.`);
        }
        if (!modelSupportsEmbedding(selectedEntry)) {
          throw new LocalAiError("selected_model_incompatible", `${model} does not advertise embedding support. Choose a local embedding-capable model.`);
        }
        return await this.ollamaLocalClient.embed(host, model, ["vault retrieval probe", "多语言检索探针"], signal);
      });
      this.syncLocalAiState(this.localAiState.activeAction);
      const feedback = `Embedding test passed in ${result.latencyMs}ms: ${result.vectorCount} vectors × ${result.dimensions} dims.`;
      this.setLocalAiFeedback("success", feedback);
      new Notice(feedback);
    } catch (error) {
      if (!isAbortError(error)) {
        this.reportLocalAiWorkflowIssue(error);
        this.setLocalAiFeedback("error", `Embedding test failed. ${message(error)}`);
        new Notice(message(error));
      }
    } finally {
      this.finishLocalAiAction(actionToken);
    }
  }

  async runLocalAiGated<T>(
    snapshot: LocalAiSnapshot,
    getCurrentSnapshot: () => LocalAiSnapshot,
    downstream: (snapshot: LocalAiSnapshot, signal?: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return await this.withLocalAiSignal(async (signal) => await executeWithLocalAiGate(
      snapshot,
      getCurrentSnapshot,
      async (gatedSnapshot, gateSignal) => await this.runLocalAiSafetyGate(gatedSnapshot, gateSignal),
      downstream,
      signal,
    ));
  }

  async refreshExternalCalendars(notify = true): Promise<void> {
    if (!Platform.isMacOS) throw new Error("Apple Calendar integration is available on macOS only");
    if (this.calendarLoading) return;
    this.calendarLoading = true;
    this.setCalendarFeedback("neutral", "Loading calendars from macOS EventKit…");
    try {
      if (!this.hasEventKitHelper()) {
        throw new Error("EventKit helper is unavailable. Build the helper or choose an absolute helper path in settings.");
      }
      this.externalCalendars = await this.eventKitBridge.calendars();
      const reconciled = reconcileCalendarSelection(this.settings, this.externalCalendars);
      if (
        reconciled.defaultExternalCalendarId !== this.settings.defaultExternalCalendarId
        || reconciled.selectedCalendarIds.join("\u0000") !== this.settings.selectedCalendarIds.join("\u0000")
      ) {
        this.settings = reconciled;
        await this.saveSettings();
      }
      this.clearIssue("calendar");
      await this.refreshCalendarEvents();
      const count = this.externalCalendars.length;
      const feedback = count
        ? `Calendar refresh complete. Loaded ${count} ${count === 1 ? "calendar" : "calendars"}.`
        : "EventKit connected, but returned no calendars. Check macOS Calendar accounts and Calendar privacy permission.";
      this.setCalendarFeedback(count ? "success" : "neutral", feedback);
      if (notify) new Notice(feedback);
    } catch (error) {
      this.recordIssue("calendar", error);
      this.setCalendarFeedback("error", `Calendar refresh failed. ${this.lastError}`);
      if (notify) new Notice(this.lastError);
    } finally {
      this.calendarLoading = false;
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
    if (Platform.isMacOS && this.hasEventKitHelper() && this.settings.selectedCalendarIds.length) {
      const { start, end } = calendarFetchWindow(vaultEvents);
      try {
        external = await this.eventKitBridge.events(this.settings.selectedCalendarIds, start, end);
        this.clearIssue("calendar");
      }
      catch (error) {
        externalFetchFailed = true;
        this.recordIssue("calendar", error);
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
    this.clearIssue("inbox");
  }

  private renderAiAnswer(output: HTMLElement, answer: AiAnswer, elapsedMs: number): void {
    output.empty();
    output.hidden = false;
    const header = output.createDiv({ cls: "omd-answer-meta" });
    header.createSpan({ text: `${answer.provider} / ${answer.model}` });
    const actions = header.createDiv({ cls: "omd-answer-actions" });
    actions.createSpan({ text: `${answer.evidence.length} sources` });
    if (answer.retrieval_mode) {
      const retrievalLabel = answer.retrieval_mode === "hybrid" ? "Hybrid" : "Sparse";
      actions.createSpan({
        cls: "omd-answer-retrieval",
        text: answer.retrieval_model ? `${retrievalLabel} · ${answer.retrieval_model}` : retrievalLabel,
      });
    }
    actions.createSpan({
      cls: "omd-answer-timing",
      text: `Returned in ${formatAnswerElapsedTime(elapsedMs)}`,
      attr: { "aria-label": `Answer returned in ${Math.round(elapsedMs)} milliseconds` },
    });
    const copy = actions.createEl("button", {
      cls: "omd-answer-copy",
      type: "button",
      text: "Copy result",
      attr: { "aria-label": "Copy OMD result and source links" },
    });
    copy.addEventListener("click", () => void this.copyAiAnswer(copy, answer));
    if (answer.warnings?.length) {
      const diagnostics = output.createDiv({ cls: "omd-answer-diagnostics" });
      for (const warning of answer.warnings) {
        diagnostics.createSpan({ cls: "omd-answer-warning", text: humanizeRetrievalWarning(warning) });
      }
    }
    output.createEl("p", { cls: "omd-answer-text", text: answer.text });
    const sources = output.createDiv({ cls: "omd-answer-sources" });
    for (const hit of answer.evidence) {
      const link = sources.createEl("button", { cls: "omd-source-link", type: "button", text: hit.path });
      link.addEventListener("click", () => void this.app.workspace.openLinkText(hit.path, "", false));
    }
  }

  private async copyAiAnswer(button: HTMLButtonElement, answer: AiAnswer): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatAiAnswerForClipboard(answer));
      button.textContent = "Copied";
      new Notice("OMD result copied.");
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = "Copy result";
      }, 1_600);
    } catch {
      new Notice("Could not copy the OMD result. Check clipboard permission and try again.");
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
      const legacyValue: unknown = this.app.loadLocalStorage(this.unversionedLayoutStorageKey())
        ?? this.app.loadLocalStorage(this.legacyLayoutStorageKey());
      const storedValue = primaryValue ?? legacyValue;
      const stored = typeof storedValue === "string"
        ? storedValue
        : storedValue === null
          ? null
          : JSON.stringify(storedValue);
      if (!stored) return DEFAULT_LAYOUT.map((item) => ({ ...item }));
      const parsed = normalizeLayout(JSON.parse(stored) as WidgetPlacement[]);
      const migratingLegacyLayout = primaryValue === null || primaryValue === undefined;
      const layout = migrateLegacyLayout(parsed);
      if (migratingLegacyLayout || JSON.stringify(layout) !== JSON.stringify(parsed)) {
        this.app.saveLocalStorage(key, layout);
      }
      return layout;
    } catch { return DEFAULT_LAYOUT.map((item) => ({ ...item })); }
  }

  private layoutStorageKey(): string {
    const adapter = this.app.vault.adapter;
    const vaultIdentity = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : this.app.vault.getName();
    const viewport = window.innerWidth < 900 ? "compact" : "wide";
    return `omd-home:layout:v2:${encodeURIComponent(vaultIdentity)}:${viewport}`;
  }

  private unversionedLayoutStorageKey(): string {
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

  resolvedEventKitHelperPath(): string {
    const adapter = this.app.vault.adapter;
    const vaultBasePath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
    return resolveEventKitHelperPath(
      this.settings.eventKitHelperPath,
      vaultBasePath,
      this.manifest.dir ?? "",
    );
  }

  hasEventKitHelper(): boolean {
    return isEventKitHelperAvailable(this.resolvedEventKitHelperPath());
  }

  private recordIssue(context: "capture" | "calendar" | "ai" | "inbox", error: unknown, source = ""): void {
    this.lastError = message(error);
    this.lastErrorAt = Date.now();
    this.lastErrorContext = context;
    this.lastErrorSource = source;
  }

  private clearIssue(context: "capture" | "calendar" | "ai" | "inbox"): void {
    if (this.lastErrorContext && this.lastErrorContext !== context) return;
    this.lastError = "";
    this.lastErrorAt = 0;
    this.lastErrorContext = "";
    this.lastErrorSource = "";
  }

  private activeLocalAiModels(): string[] {
    return [...new Set(getActiveWorkflowModels(this.settings).map((workflow) => workflow.model.trim()).filter(Boolean))];
  }

  private qaRetrievalOptions(): HybridRetrievalOptions {
    const embeddingModel = this.settings.embeddingModel.trim();
    return {
      hybridRetrievalEnabled: this.settings.hybridRetrievalEnabled,
      embeddingModel,
      embeddingModelRevision: resolveEmbeddingModelRevision(embeddingModel, this.localAiState.models),
      semanticRerankEnabled: this.settings.semanticRerankEnabled,
    };
  }

  private syncLocalAiState(activeAction: LocalAiRuntimeState["activeAction"]): void {
    const summary = this.currentLocalAiSummary();
    const models = summary?.models ?? [];
    this.localAiState = aggregateLocalAiState(this.settings, summary, models, activeAction);
    this.refreshHomeViews();
  }

  private async runLocalAiSafetyGate(snapshot: LocalAiSnapshot, signal?: AbortSignal): Promise<void> {
    if (!snapshot.enabled) return;
    try {
      const status = await this.ollamaLocalClient.status(snapshot.host, signal)
        .catch((error) => {
          throw remapLocalAiError(error, "status_unavailable", "OMD Home could not verify /api/status from the local Ollama daemon.");
        });
      const models = await this.ollamaLocalClient.tags(snapshot.host, signal);
      const daemonCode = deriveLocalAiDaemonCode(status, models);
      const checkedAt = Date.now();
      const previous = this.localAiSummaries.get(snapshot.host);
      if (daemonCode !== "ready") {
        this.localAiSummaries.set(snapshot.host, buildConnectionSummary({
          host: snapshot.host,
          checkedAt,
          version: previous?.version,
          daemonCode,
          daemonDetail: describeDaemonReadiness(daemonCode),
          models,
          modelChecks: previous?.modelChecks ?? {},
        }));
        this.localAiFailure = null;
        this.syncLocalAiState(this.localAiState.activeAction);
        throw new LocalAiError(daemonCode, describeDaemonReadiness(daemonCode));
      }
      let selectedModelShow: LocalAiModelInfo;
      try {
        selectedModelShow = await this.safeShowModel(snapshot.host, snapshot.model, signal);
      } catch (error) {
        if (error instanceof LocalAiError && error.code === "selected_model_missing") {
          this.storeLiveGateModelResult(snapshot, models, {
            model: snapshot.model,
            checkedAt,
            code: error.code,
            detail: error.message,
            supportsCompletion: false,
          });
        }
        throw error;
      }
      const modelCode = deriveLocalAiModelCode(selectedModelShow);
      const modelEntry = buildModelEntry(selectedModelShow);
      this.storeLiveGateModelResult(snapshot, models, {
        model: snapshot.model,
        checkedAt,
        code: modelCode,
        detail: describeModelReadiness(snapshot.model, selectedModelShow),
        supportsCompletion: modelEntry.supportsCompletion,
      }, modelEntry);
      if (modelCode !== "ready") {
        throw new LocalAiError(modelCode, describeModelReadiness(snapshot.model, selectedModelShow));
      }
    } catch (error) {
      if (!isAbortError(error) && !(error instanceof LocalAiError && isModelReadinessCode(error.code))) {
        this.setLocalAiFailure(error, snapshot.host);
      }
      throw error;
    }
  }

  private async safeShowModel(host: string, model: string, signal?: AbortSignal): Promise<LocalAiModelInfo> {
    try {
      return await this.ollamaLocalClient.show(host, model, signal);
    } catch (error) {
      const detail = message(error).toLowerCase();
      if (/not found|no such model|missing/u.test(detail)) {
        throw new LocalAiError("selected_model_missing", `The selected model ${model} is not installed on this Ollama daemon.`);
      }
      throw error;
    }
  }

  private async withLocalAiSignal<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.localAiControllers.add(controller);
    try {
      return await task(controller.signal);
    } finally {
      this.localAiControllers.delete(controller);
    }
  }

  private beginLocalAiAction(action: Exclude<LocalAiRuntimeState["activeAction"], "">): number {
    const token = ++this.localAiActionToken;
    this.syncLocalAiState(action);
    return token;
  }

  private finishLocalAiAction(token: number): void {
    if (token !== this.localAiActionToken) return;
    this.syncLocalAiState("");
  }

  private currentLocalAiHost(): string | null {
    try {
      return normalizeLocalOllamaHost(this.settings.ollamaHost);
    } catch {
      return null;
    }
  }

  private currentLocalAiSummary(): LocalAiConnectionSummary | null {
    const host = this.currentLocalAiHost();
    if (!host) return this.localAiFailure;
    return this.localAiSummaries.get(host) ?? this.localAiFailure;
  }

  private setLocalAiFailure(error: unknown, knownHost?: string): void {
    if (isAbortError(error)) return;
    const code = error instanceof LocalAiError ? error.code : "daemon_unreachable";
    const host = knownHost ?? this.currentLocalAiHost() ?? this.settings.ollamaHost.trim();
    const previous = this.localAiSummaries.get(host);
    const summary = buildConnectionSummary({
      host,
      checkedAt: Date.now(),
      version: previous?.version,
      daemonCode: code,
      daemonDetail: error instanceof Error ? error.message : String(error),
      models: previous?.models ?? [],
      modelChecks: previous?.modelChecks ?? {},
    });
    if (this.currentLocalAiHost() === host) this.localAiSummaries.set(host, summary);
    else this.localAiFailure = summary;
    this.recordIssue("ai", error);
    this.syncLocalAiState(this.localAiState.activeAction);
  }

  private setLocalAiFeedback(tone: LocalAiActionFeedback["tone"], messageText: string): void {
    this.localAiFeedback = { tone, message: messageText, at: Date.now() };
    this.refreshHomeViews();
  }

  private setCalendarFeedback(tone: LocalAiActionFeedback["tone"], messageText: string): void {
    this.calendarFeedback = { tone, message: messageText, at: Date.now() };
    this.refreshHomeViews();
  }

  private reportLocalAiWorkflowIssue(error: unknown, source = ""): void {
    if (isAbortError(error)) return;
    if (error instanceof LocalAiError && ownsLocalAiConnectionState(error.code)) {
      this.setLocalAiFailure(error);
      return;
    }
    this.recordIssue("ai", error, source);
    this.refreshHomeViews();
  }

  private storeLiveGateModelResult(
    snapshot: LocalAiSnapshot,
    models: LocalAiConnectionSummary["models"],
    checkedModel: LocalAiConnectionSummary["modelChecks"][string],
    modelEntry?: LocalAiConnectionSummary["models"][number],
  ): void {
    const previous = this.localAiSummaries.get(snapshot.host);
    const catalog = new Map(models.map((model) => [model.name, model]));
    if (modelEntry) {
      catalog.set(snapshot.model, mergeInspectedModelEntry(catalog.get(snapshot.model), modelEntry, snapshot.model));
    }
    this.localAiSummaries.set(snapshot.host, buildConnectionSummary({
      host: snapshot.host,
      checkedAt: checkedModel.checkedAt,
      version: previous?.version,
      daemonCode: "ready",
      daemonDetail: describeDaemonReadiness("ready"),
      models: [...catalog.values()].sort((left, right) => left.name.localeCompare(right.name)),
      modelChecks: {
        ...(previous?.modelChecks ?? {}),
        [snapshot.model]: checkedModel,
      },
    }));
    this.localAiFailure = null;
    this.syncLocalAiState(this.localAiState.activeAction);
  }
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function remapLocalAiError(error: unknown, code: "version_unavailable" | "status_unavailable", fallback: string): LocalAiError {
  if (error instanceof LocalAiError && (error.code === code || error.code === "daemon_unreachable")) return error;
  return new LocalAiError(code, error instanceof Error ? error.message : fallback);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isModelReadinessCode(code: LocalAiError["code"]): boolean {
  return code === "selected_model_missing"
    || code === "selected_model_incompatible"
    || code === "selected_model_remote_blocked";
}

function ownsLocalAiConnectionState(code: LocalAiError["code"]): boolean {
  return code === "invalid_host"
    || code === "daemon_unreachable"
    || code === "version_unavailable"
    || code === "status_unavailable"
    || code === "cloud_features_enabled"
    || code === "cloud_features_unknown"
    || code === "no_models_installed";
}

function summarizeSmokeResponse(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
}

function humanizeRetrievalWarning(value: string): string {
  if (value === "hybrid_retrieval_unsupported_by_omd") {
    return "This OMD build does not support hybrid retrieval yet, so the answer used sparse retrieval only.";
  }
  if (value === "hybrid_retrieval_model_missing") {
    return "No local embedding model is selected, so the answer used sparse retrieval only.";
  }
  if (value === "hybrid_retrieval_failed") {
    return "Hybrid retrieval fell back to sparse retrieval for this answer.";
  }
  if (value === "semantic_recall_unavailable") {
    return "Semantic recall was unavailable for this answer, so sparse retrieval stayed in effect.";
  }
  if (value === "semantic_rerank_unavailable") {
    return "Semantic reranking was unavailable for this answer, so the sparse-first evidence order was kept.";
  }
  return value.replaceAll("_", " ");
}

function localAiWorkflowLabel(workflow: LocalAiWorkflowId): string {
  if (workflow === "qa") return "Vault Q&A";
  if (workflow === "enrichment") return "Note enrichment";
  return "Capture polish";
}
