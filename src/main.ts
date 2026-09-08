import {
  FileSystemAdapter,
  Notice,
  Platform,
  Plugin,
  TFile,
  normalizePath,
  type App,
  type WorkspaceLeaf,
} from "obsidian";
import embeddedPythonBridge from "../bridge/omd_home_bridge.py";
import {
  aiProviderDestination,
  aiProviderLabel,
  cloudAnswerPermissionEnabled,
  isHostedApiProvider,
  isOllamaCloudModel,
  isStoredAiProvider,
  selectedAiModel,
} from "./ai-provider.ts";
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
import { OmdBridge, spawnProcess, type AiAnswer, type HybridRetrievalOptions } from "./omd-bridge";
import {
  captureFailureForIssue,
  captureRequestFromSettings,
  createCaptureFailureRecord,
  createCaptureRequest,
  filterReadyOcrPresets,
  hasCaptureLanguageOverrides,
  type CaptureFailureRecord,
  type CaptureLanguageAvailability,
  type CaptureRequest,
} from "./capture-request.ts";
import {
  EventKitBridge,
  isEventKitHelperAvailable,
  normalizeEventKitEvent,
  resolveEventKitHelperPath,
} from "./eventkit-bridge";
import { eventNotePath, recordFromFrontmatter, serializeEventNote, updateEventNote } from "./event-note";
import { CaptureModal, CloudAnswerConsentModal } from "./modals";
import { omdCapabilityIdentityLabel, OmdCapabilityService } from "./enrichment/capability";
import type { OmdCapabilities } from "./enrichment/contract.ts";
import { EnrichmentWorkflowController } from "./enrichment/controller.ts";
import { OmdEnrichmentRunner } from "./enrichment/runner";
import {
  isEnrichmentError,
  OmdEnrichmentError,
  toUserFacingEnrichmentMessage,
  type EnrichmentErrorCode,
} from "./enrichment/errors.ts";
import { inspectVaultRelativeMarkdownPath } from "./enrichment/path-safety.ts";
import {
  capturedOutputVaultPath,
  isOmdInboxNote,
  setOmdHomeStatusInMarkdown,
  waitForCapturedVaultFile,
} from "./inbox";
import {
  isPluginRecordingWrapperCommand,
  resolveRecordingCommand,
  type RecordingCommandRef,
} from "./omnibox-utils";
import { isPinnedNote, setPinnedNote } from "./pinned-notes";
import { captureWorkflowDoneEvent, shouldSurfaceCaptureEvent } from "./omd-events.ts";
import {
  discoverOmdExecutable,
  isAutomaticOmdExecutable,
  OMD_INSTALL_GUIDE_URL,
  omdInstallInstructions,
  resolveOmdExecutablePath,
  type OmdDiscoveryMode,
} from "./omd-discovery.ts";
import { executeWithLocalAiGate } from "./local-ai-execution";
import {
  aggregateLocalAiState,
  buildConnectionSummary,
  buildModelEntry,
  createWorkflowSnapshot,
  deriveLocalAiDaemonCode,
  deriveLocalAiModelCode,
  describeDaemonReadiness,
  describeLocalCompletionCatalog,
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
import { canOpenOllamaDesktopApp, openOllamaDesktopApp } from "./ollama-app";
import {
  LocalAiError,
  type LocalAiActionFeedback,
  type HostedAiRuntimeState,
  type HostedAiProvider,
  type LocalAiConnectionSummary,
  type LocalAiModelInfo,
  type LocalAiRuntimeState,
  type LocalAiSnapshot,
  type LocalAiWorkflowId,
  type StoredAiProvider,
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
  captureCancelable = false;
  enrichmentActive = false;
  enrichmentCapability: {
    status: "unchecked" | "checking" | "ready" | "unavailable";
    message: string;
    checkedAt?: number;
    code?: EnrichmentErrorCode;
    resolvedExecutable?: string;
    mode?: OmdDiscoveryMode;
    packageVersion?: string;
    protocolVersion?: number;
    buildRevision?: string | null;
    capabilities?: OmdCapabilities;
  } = {
    status: "unchecked",
    message: "Not checked this session",
  };
  localAiState: LocalAiRuntimeState = aggregateLocalAiState(this.settings, null, [], "");
  hostedAiState: HostedAiRuntimeState | null = null;
  localAiFeedback: LocalAiActionFeedback | null = null;
  calendarFeedback: LocalAiActionFeedback | null = null;
  lastError = "";
  lastErrorAt = 0;
  lastErrorContext: "" | "capture" | "calendar" | "ai" | "inbox" = "";
  lastErrorSource = "";
  lastCaptureFailure: CaptureFailureRecord | null = null;
  readonly omdCapabilityService = new OmdCapabilityService();
  readonly omdEnrichmentRunner = new OmdEnrichmentRunner();
  private omdBridge!: OmdBridge;
  private readonly ollamaLocalClient = new OllamaLocalClient();
  private eventKitBridge!: EventKitBridge;
  private enrichmentWorkflowController!: EnrichmentWorkflowController;
  private readonly localAiSummaries = new Map<string, LocalAiConnectionSummary>();
  private localAiFailure: LocalAiConnectionSummary | null = null;
  private hostedCredentialHydration: Promise<void> | null = null;
  private hostedCredentialHydrationProvider: HostedAiProvider | null = null;
  private readonly cloudAnswerConsentModals = new Set<CloudAnswerConsentModal>();
  private unloaded = false;
  private calendarRefresh: Promise<void> | null = null;
  calendarLoading = false;
  private calendarRefreshTimer: number | null = null;
  private readonly calendarWriteOverrides = new Map<string, CalendarWriteOverride>();
  private readonly localAiControllers = new Set<AbortController>();
  private captureController: AbortController | null = null;
  private localAiActionToken = 0;
  private issueSequence = 0;
  private lastIssueId = 0;
  private captureFailureSequence = 0;
  private discoveredOmdExecutable = "";
  private omdCapabilityCheck: Promise<boolean> | null = null;
  private omdCapabilityGeneration = 0;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.deviceLayout = this.loadDeviceLayout();
    this.omdBridge = new OmdBridge(
      () => this.resolvedOmdExecutable(),
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
    this.addCommand({
      id: "check-omd-setup",
      name: "Check OMD setup",
      callback: () => void this.checkEnrichmentCapability(true).then((ready) => {
        new Notice(ready ? "OMD is ready." : this.enrichmentCapability.message);
      }),
    });
    this.addCommand({
      id: "open-omd-install-guide",
      name: "Open OMD install guide",
      callback: () => this.openOmdInstallGuide(),
    });
    this.addCommand({ id: "suggest-links-and-tags", name: "Suggest links and tags", callback: () => void this.suggestLinksAndTags() });
    this.addCommand({ id: "refresh-local-models", name: "Refresh local AI models", callback: () => void this.refreshLocalAiCatalog(true) });
    this.addCommand({ id: "check-local-ai", name: "Check local AI connection", callback: () => void this.checkLocalAiConnection() });
    this.addCommand({ id: "smoke-local-ai-qa", name: "Smoke local AI: Vault question", callback: () => void this.smokeLocalAiWorkflow("qa") });
    this.addCommand({ id: "smoke-local-ai-enrichment", name: "Smoke local AI: Note enrichment", callback: () => void this.smokeLocalAiWorkflow("enrichment") });
    this.addCommand({ id: "smoke-local-ai-capture", name: "Smoke local AI: Polish Markdown", callback: () => void this.smokeLocalAiWorkflow("capture") });
    if (canOpenOllamaDesktopApp()) {
      this.addCommand({ id: "open-ollama-app", name: "Open Ollama", callback: () => void this.openOllamaApp() });
    }
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
    this.addCommand({
      id: "toggle-recording",
      name: "Start or stop recording",
      callback: () => this.toggleRecording(),
    });
    this.addCommand({
      id: "start-recording",
      name: "Start recording",
      callback: () => this.startRecording(),
    });
    this.addCommand({
      id: "stop-recording",
      name: "Stop recording",
      callback: () => this.stopRecording(),
    });
    this.addSettingTab(new OmdHomeSettingTab(this.app, this));

    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (file.path.startsWith("Calendar/Events/")) this.scheduleCalendarRefresh();
    }));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile)) return;
      const pinned = this.isNotePinned(file.path);
      menu.addItem((item) => item
        .setTitle(pinned ? "Unpin from OMD Home" : "Pin to OMD Home")
        .setIcon("pin")
        .onClick(() => void this.toggleNotePinned(file.path)));
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
      if (this.settings.aiProvider === "ollama" || this.settings.aiProvider === "ollama-cloud") {
        void this.ensureLocalAiCatalog();
      }
      if (isHostedApiProvider(this.settings.aiProvider)) {
        void this.ensureHostedCredentialState(this.settings.aiProvider);
      }
      if (Platform.isMacOS && this.hasEventKitHelper()) void this.refreshExternalCalendars(false);
      if (this.settings.openOnLaunch) void this.openHome(false);
    });
  }

  onunload(): void {
    this.unloaded = true;
    this.localAiActionToken += 1;
    this.omdCapabilityGeneration += 1;
    for (const modal of this.cloudAnswerConsentModals) modal.close();
    this.cloudAnswerConsentModals.clear();
    if (this.calendarRefreshTimer !== null) window.clearTimeout(this.calendarRefreshTimer);
    this.calendarWriteOverrides.clear();
    for (const controller of this.localAiControllers) controller.abort();
    this.localAiControllers.clear();
    this.captureController?.abort();
    this.captureController = null;
    this.captureCancelable = false;
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
    this.syncHostedAiState("");
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.syncLocalAiState(this.localAiState.activeAction);
    this.syncHostedAiState(this.hostedAiState?.activeAction ?? "");
  }

  usesAutomaticOmdDiscovery(): boolean {
    return isAutomaticOmdExecutable(this.settings.omdExecutable);
  }

  resolvedOmdExecutable(): string {
    return this.discoveredOmdExecutable || this.settings.omdExecutable.trim() || "omd";
  }

  captureLanguageAvailability(): CaptureLanguageAvailability {
    const language = this.enrichmentCapability.capabilities?.capture_language_options;
    if (this.enrichmentCapability.status !== "ready") {
      const unsupported = this.enrichmentCapability.status === "unavailable"
        && (this.enrichmentCapability.code === "unsupported_capability"
          || this.enrichmentCapability.code === "unsupported_schema");
      return captureLanguageAvailabilityState(
        unsupported ? "unsupported" : "unchecked",
        unsupported
          ? "This detected OMD build does not advertise compatible capture language options."
          : "Explicit recognition choices will be validated against the detected OMD build when you press Capture.",
      );
    }
    if (!language?.supported) {
      return captureLanguageAvailabilityState(
        "unsupported",
        "This detected OMD build does not advertise capture language options. Leave language preferences off or update OMD.",
      );
    }
    const ocrFlags = [language.ocr.argument, ...language.ocr.aliases];
    const acceptsHomeOcrArgument = ocrFlags.includes("--ocr-lang");
    const presets = language.ocr.presets
      .filter((preset): preset is typeof preset & { value: "eng" | "chi_sim+eng" | "chi_tra+eng" } => (
        preset.value === "eng" || preset.value === "chi_sim+eng" || preset.value === "chi_tra+eng"
      ))
      .map((preset) => ({ label: preset.label, value: preset.value }));
    const acceptsHomeAsrArgument = language.asr.argument === "--whisper-lang";
    const ocrReadiness = language.ocr.readiness;
    const readinessMessage = ocrReadiness
      ? ocrReadiness.available
        ? "Only installed image text languages appear below."
        : "Image text recognition is not ready on this device. Open recognition defaults in settings for setup guidance."
      : "Image text language availability will be checked when capture starts.";
    return {
      status: "supported",
      message: readinessMessage,
      ocrPresets: acceptsHomeOcrArgument
        ? filterReadyOcrPresets(
          presets,
          ocrReadiness?.available ?? null,
          ocrReadiness ? ocrReadiness.installed_packs : null,
        )
        : [],
      customOcr: acceptsHomeOcrArgument && language.ocr.composite && language.ocr.separator === "+",
      ocrBackendAvailable: ocrReadiness?.available ?? null,
      ocrInstalledPacks: ocrReadiness ? ocrReadiness.installed_packs : null,
      asrAutoDetect: acceptsHomeAsrArgument && language.asr.modes.includes("auto-detect"),
      asrExplicit: acceptsHomeAsrArgument && language.asr.modes.includes("explicit"),
    };
  }

  async copyOmdInstallInstructions(): Promise<boolean> {
    const instructions = omdInstallInstructions(process.platform);
    try {
      await navigator.clipboard.writeText(instructions.commands);
      new Notice(instructions.notice);
      return true;
    } catch {
      new Notice("Could not copy the install steps. Open the OMD install guide instead.");
      return false;
    }
  }

  openOmdInstallGuide(): void {
    window.open(OMD_INSTALL_GUIDE_URL, "_blank", "noopener,noreferrer");
  }

  openCloudAiGuide(): void {
    window.open(
      "https://github.com/omd-local/obsidian-omd-home#ollama-cloud",
      "_blank",
      "noopener,noreferrer",
    );
  }

  async openOllamaApp(): Promise<boolean> {
    this.setLocalAiFeedback("neutral", "Opening Ollama…");
    try {
      await openOllamaDesktopApp();
      const feedback = "Ollama opened. Wait for its local service to finish starting, then select Check setup.";
      this.setLocalAiFeedback("success", feedback);
      new Notice(feedback);
      return true;
    } catch {
      const feedback = "OMD Home could not open Ollama automatically. Open the installed app manually, or install it if missing, then check the connection again.";
      this.setLocalAiFeedback("error", feedback);
      new Notice(feedback);
      return false;
    }
  }

  async checkHostedAiConnection(): Promise<boolean> {
    const provider = this.currentHostedProvider();
    if (!provider || this.unloaded) return false;
    this.clearIssue("ai");
    this.setLocalAiFeedback("neutral", `Checking ${providerLabel(provider)} credentials and the selected model…`);
    const action = this.beginHostedAiAction("check-connection");
    try {
      await this.requireReadyOmdExecutable();
      if (!this.isCurrentHostedAiAction(action, provider)) return false;
      const model = selectedAiModel(this.settings);
      const { catalog, checked } = await this.withLocalAiSignal(async (signal) => {
        const catalog = await this.omdBridge.discoverProviderModels(provider, signal);
        signal.throwIfAborted();
        if (!model) return { catalog, checked: null };
        return {
          catalog,
          checked: await this.omdBridge.checkProviderModel(provider, model, signal),
        };
      });
      if (!this.isCurrentHostedAiAction(action, provider)) return false;
      const catalogModels = catalog.models.map((name) => ({
        name,
        capabilities: ["completion"],
        supportsCompletion: true,
      }));
      if (!checked) {
        this.hostedAiState = {
          provider,
          checkedAt: Date.now(),
          code: "selected_model_missing",
          detail: catalog.models.length
            ? `${providerLabel(provider)} models are loaded. Choose an answer model, then check setup again.`
            : `${providerLabel(provider)} returned an empty model catalog.`,
          models: catalogModels,
          activeAction: "check-connection",
          credential: catalog.credential ?? null,
          destinationDomain: catalog.destinationDomain,
        };
        const feedback = catalog.models.length
          ? `Models loaded. Choose a ${providerLabel(provider)} answer model.`
          : `Connection checked, but ${providerLabel(provider)} returned no models.`;
        this.setLocalAiFeedback(catalog.models.length ? "neutral" : "error", feedback);
        new Notice(feedback);
        return false;
      }
      const modelNames = [...new Set([
        ...catalog.models,
        ...checked.models,
        ...checked.alternativeModels,
      ])];
      this.hostedAiState = {
        provider,
        checkedAt: Date.now(),
        code: checked.available ? "ready" : "model_unavailable",
        detail: checked.available
          ? `${checked.model} is available on ${checked.destinationDomain}. Retrieval stays local, and each cloud answer needs confirmation.`
          : `${checked.model} is not available on ${checked.destinationDomain}.`,
        models: modelNames.map((name) => ({
          name,
          capabilities: ["completion"],
          supportsCompletion: true,
        })),
        activeAction: "check-connection",
        credential: checked.credential ?? catalog.credential ?? null,
        destinationDomain: checked.destinationDomain,
      };
      const ok = checked.available;
      const feedback = ok
        ? `Setup ready. ${providerLabel(provider)} can use ${checked.model}.`
        : `Connection checked. ${checked.model} is unavailable for ${providerLabel(provider)}.`;
      this.setLocalAiFeedback(ok ? "success" : "error", feedback);
      new Notice(feedback);
      return ok;
    } catch (error) {
      if (isAbortError(error) || !this.isCurrentHostedAiAction(action, provider)) return false;
      this.recordIssue("ai", error);
      this.hostedAiState = {
        provider,
        checkedAt: Date.now(),
        code: mapHostedErrorCode(error),
        detail: message(error),
        models: this.hostedAiState?.provider === provider ? this.hostedAiState.models : [],
        activeAction: "check-connection",
        credential: this.hostedAiState?.provider === provider ? this.hostedAiState.credential : null,
        destinationDomain: this.hostedAiState?.provider === provider ? this.hostedAiState.destinationDomain : providerDomain(provider),
      };
      this.setLocalAiFeedback("error", `Connection failed. ${message(error)}`);
      new Notice(this.lastError);
      return false;
    } finally {
      this.finishHostedAiAction(action, provider);
    }
  }

  async checkOllamaCloudConnection(): Promise<boolean> {
    this.clearIssue("ai");
    this.setLocalAiFeedback("neutral", "Checking the Ollama app, Cloud availability, and selected cloud model…");
    const actionToken = this.beginLocalAiAction("check-connection");
    try {
      const host = normalizeLocalOllamaHost(this.settings.ollamaHost);
      const checkedAt = Date.now();
      const model = selectedAiModel(this.settings);
      const checked = await this.withLocalAiSignal(async (signal) => {
        const version = await this.ollamaLocalClient.version(host, signal);
        const status = await this.ollamaLocalClient.status(host, signal);
        const catalog = await this.ollamaLocalClient.tags(host, signal);
        if (status.cloud?.disabled !== false) {
          throw new LocalAiError(
            "cloud_features_unknown",
            "Ollama Cloud is not available. Sign in to the Ollama app and enable Cloud, then check setup again.",
          );
        }
        const cloudModels = catalog.filter(isOllamaCloudModel);
        if (!cloudModels.length) {
          throw new LocalAiError(
            "no_models_installed",
            "No Ollama Cloud model was detected. Run a cloud model once in Ollama, then check setup again.",
          );
        }
        if (!model) {
          return {
            version,
            models: catalog,
            selectedModelReady: false,
          };
        }
        const info = await this.ollamaLocalClient.show(host, model, signal);
        const inspected = buildModelEntry(info);
        if (!isOllamaCloudModel(inspected)) {
          throw new LocalAiError("selected_model_incompatible", `${model} is not identified as an Ollama Cloud model.`);
        }
        const merged = new Map(catalog.map((entry) => [entry.name, entry]));
        merged.set(model, mergeInspectedModelEntry(merged.get(model), inspected, model));
        return {
          version,
          models: [...merged.values()].sort((left, right) => left.name.localeCompare(right.name)),
          selectedModelReady: true,
        };
      });
      this.localAiSummaries.set(host, buildConnectionSummary({
        host,
        checkedAt,
        version: checked.version.version,
        daemonCode: "ready",
        daemonDetail: "Ollama is reachable. Cloud-backed and local models are inspected separately before use.",
        models: checked.models,
        modelChecks: this.localAiSummaries.get(host)?.modelChecks ?? {},
      }));
      this.localAiFailure = null;
      this.syncLocalAiState(this.localAiState.activeAction);
      if (!checked.selectedModelReady) {
        const feedback = "Ollama Cloud models loaded. Choose an answer model, then check setup again.";
        this.setLocalAiFeedback("neutral", feedback);
        new Notice(feedback);
        return false;
      }
      const feedback = `Ollama Cloud setup ready. ${model} is available through the local Ollama app.`;
      this.setLocalAiFeedback("success", feedback);
      new Notice(feedback);
      return true;
    } catch (error) {
      if (!isAbortError(error)) {
        this.setLocalAiFailure(error);
        this.setLocalAiFeedback("error", `Ollama Cloud setup failed. ${message(error)}`);
        new Notice(message(error));
      }
      return false;
    } finally {
      this.finishLocalAiAction(actionToken);
    }
  }

  async saveHostedApiKey(apiKey: string): Promise<boolean> {
    if (this.unloaded) return false;
    const provider = this.currentHostedProvider();
    if (!provider) throw new Error("Select a hosted provider first.");
    this.setLocalAiFeedback("neutral", `Saving the ${providerLabel(provider)} API key…`);
    const action = this.beginHostedAiAction("save-key");
    try {
      await this.requireReadyOmdExecutable();
      if (!this.isCurrentHostedAiAction(action, provider)) return false;
      const credential = await this.omdBridge.storeHostedApiKey(provider, apiKey);
      if (!this.isCurrentHostedAiAction(action, provider)) return false;
      if (credential.source === "missing") throw new Error("OMD did not confirm that the API key was saved.");
      this.hostedAiState = {
        ...(this.hostedAiState?.provider === provider ? this.hostedAiState : buildHostedState(provider)),
        provider,
        credential,
        checkedAt: Date.now(),
        code: "unchecked",
        detail: `${providerLabel(provider)} key saved. Choose a model or check setup next.`,
        activeAction: "save-key",
      };
      this.setLocalAiFeedback(
        "success",
        credential.source === "keychain"
          ? `${providerLabel(provider)} key saved to macOS Keychain.`
          : `${providerLabel(provider)} key available from ${credential.envVar}.`,
      );
      new Notice(this.localAiFeedback?.message ?? "Key saved.");
      return true;
    } catch (error) {
      if (isAbortError(error) || !this.isCurrentHostedAiAction(action, provider)) return false;
      this.recordIssue("ai", error);
      this.setLocalAiFeedback("error", `Could not save the API key. ${message(error)}`);
      new Notice(this.lastError);
      throw error;
    } finally {
      this.finishHostedAiAction(action, provider);
    }
  }

  async deleteHostedApiKey(): Promise<void> {
    const provider = this.currentHostedProvider();
    if (!provider || this.unloaded) return;
    this.setLocalAiFeedback("neutral", `Removing the ${providerLabel(provider)} API key…`);
    const action = this.beginHostedAiAction("delete-key");
    try {
      await this.requireReadyOmdExecutable();
      if (!this.isCurrentHostedAiAction(action, provider)) return;
      const credential = await this.omdBridge.deleteHostedApiKey(provider);
      if (!this.isCurrentHostedAiAction(action, provider)) return;
      this.hostedAiState = {
        ...(this.hostedAiState?.provider === provider ? this.hostedAiState : buildHostedState(provider)),
        provider,
        credential,
        checkedAt: Date.now(),
        code: "credentials_missing",
        detail: `${providerLabel(provider)} key removed. Add a key before checking this provider again.`,
        activeAction: "delete-key",
      };
      this.setLocalAiFeedback("success", `${providerLabel(provider)} key removed.`);
      new Notice(this.localAiFeedback?.message ?? "Key removed.");
    } catch (error) {
      if (isAbortError(error) || !this.isCurrentHostedAiAction(action, provider)) return;
      this.recordIssue("ai", error);
      this.setLocalAiFeedback("error", `Could not remove the API key. ${message(error)}`);
      new Notice(this.lastError);
    } finally {
      this.finishHostedAiAction(action, provider);
    }
  }

  async useAutomaticOmdDiscovery(): Promise<boolean> {
    this.settings.omdExecutable = DEFAULT_SETTINGS.omdExecutable;
    await this.saveSettings();
    this.resetEnrichmentCapability();
    return await this.checkEnrichmentCapability(true);
  }

  async requireReadyOmdExecutable(): Promise<string> {
    const force = this.enrichmentCapability.status === "unavailable";
    const ready = await this.checkEnrichmentCapability(force);
    if (!ready) {
      throw new OmdEnrichmentError(
        this.enrichmentCapability.code ?? "omd_failed",
        this.enrichmentCapability.message,
      );
    }
    return this.resolvedOmdExecutable();
  }

  async requireCaptureOmdExecutable(request: CaptureRequest, signal?: AbortSignal): Promise<string> {
    const result = await discoverOmdExecutable(
      this.settings.omdExecutable,
      {
        platform: process.platform,
        homeDirectory: process.env.HOME ?? process.env.USERPROFILE ?? "",
        condaPrefix: process.env.CONDA_PREFIX,
        virtualEnvironment: process.env.VIRTUAL_ENV,
      },
      async (executable) => {
        if (hasCaptureLanguageOverrides(request)) {
          await this.omdCapabilityService.requireCaptureLanguages(executable, request, signal);
        } else {
          await probeOmdCaptureExecutable(executable, signal);
        }
      },
      async (candidate) => await resolveOmdExecutablePath(candidate, process.platform, spawnProcess, signal),
    );
    return result.executable;
  }

  isNotePinned(path: string): boolean {
    return isPinnedNote(this.settings.pinnedNotes, path);
  }

  async toggleNotePinned(path: string): Promise<boolean> {
    const pinned = !this.isNotePinned(path);
    this.settings.pinnedNotes = setPinnedNote(this.settings.pinnedNotes, path, pinned);
    await this.saveSettings();
    this.refreshHomeViews();
    new Notice(pinned ? "Pinned to OMD Home." : "Unpinned from OMD Home.");
    return pinned;
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

  openCaptureModal(initialSource: string | CaptureRequest = "", retryFailureId?: number): void {
    if (this.captureActive || this.enrichmentActive) {
      new Notice("Another OMD action is already active.");
      return;
    }
    const initialRequest = typeof initialSource === "string"
      ? captureRequestFromSettings(initialSource, this.settings)
      : createCaptureRequest(initialSource);
    new CaptureModal(
      this.app,
      initialRequest,
      this.captureLanguageAvailability(),
      this.settings.localWritingModel,
      async (request) => {
        // Claim the capture before changing preferences. In particular,
        // invalidateLocalAiState() aborts local AI work, so it must never run
        // for a second capture submitted while another OMD action is active.
        if (this.captureActive || this.enrichmentActive) {
          new Notice("Another OMD action is already active.");
          return;
        }
        this.captureActive = true;
        this.refreshHomeViews();
        const polishChanged = this.settings.capturePolish !== request.polish;
        try {
          this.settings.capturePolish = request.polish;
          this.settings.captureSuggestLinksAndTags = request.suggest;
          if (polishChanged) this.invalidateLocalAiState("capture-polish");
          try {
            await this.saveSettings();
          } catch {
            new Notice("Capture will continue, but OMD Home could not remember these choices.");
          }
          await this.captureWithOmd(request, retryFailureId, true);
        } finally {
          // captureWithOmd normally clears this in its own finally block. This
          // covers an early return before that lifecycle is established.
          if (this.captureActive && !this.captureController) {
            this.captureActive = false;
            this.refreshHomeViews();
          }
        }
      },
    ).open();
  }

  currentCaptureFailure(): CaptureFailureRecord | null {
    return this.lastCaptureFailure;
  }

  get enrichmentCancelable(): boolean {
    return this.enrichmentWorkflowController?.canCancel ?? false;
  }

  captureFailureForCurrentIssue(): CaptureFailureRecord | null {
    return captureFailureForIssue(this.lastCaptureFailure, this.lastIssueId);
  }

  retryFailedCapture(failureId: number): void {
    const failure = this.lastCaptureFailure;
    if (!failure || failure.id !== failureId) {
      new Notice("That capture failure is no longer available.");
      return;
    }
    this.openCaptureModal(failure.request, failure.id);
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
    request: CaptureRequest,
    retryFailureId?: number,
    captureAlreadyClaimed = false,
  ): Promise<void> {
    if ((this.captureActive && !captureAlreadyClaimed) || this.enrichmentActive) {
      new Notice("Another OMD action is already active.");
      return;
    }
    const captureRequest = createCaptureRequest(request);
    const retryFailure = retryFailureId === undefined
      ? null
      : this.lastCaptureFailure?.id === retryFailureId
        ? this.lastCaptureFailure
        : null;
    if (retryFailureId !== undefined && !retryFailure) {
      new Notice("That capture retry is no longer current.");
      return;
    }
    const { polish } = captureRequest;
    if (!captureRequest.source) {
      new Notice("Enter a URL or local file path.");
      return;
    }
    if (retryFailure) this.resetEnrichmentCapability();
    this.captureActive = true;
    const captureController = new AbortController();
    this.captureController = captureController;
    this.captureCancelable = true;
    this.processingEvents = [];
    this.refreshHomeViews();
    let capturedFile: TFile | null = null;
    let completed = false;
    let inboxReady = false;
    let completionWarningShown = false;
    try {
      if (!retryFailure) this.clearIssue("capture");
      const executable = await this.requireCaptureOmdExecutable(captureRequest, captureController.signal);
      const vault = this.vaultPath();
      const snapshot = createWorkflowSnapshot("capture", this.settings, polish);
      const outputPath = await this.runLocalAiGated(
        snapshot,
        () => createWorkflowSnapshot("capture", this.settings, polish),
        async (gatedSnapshot) => await this.omdBridge.capture(
          executable,
          captureRequest,
          vault,
          {
            enabled: gatedSnapshot.enabled,
            model: gatedSnapshot.model,
            host: gatedSnapshot.host,
          },
          (event) => {
            if (!shouldSurfaceCaptureEvent(event)) return;
            this.processingEvents.push(event);
            this.processingEvents = this.processingEvents.slice(-40);
            this.refreshHomeViews();
          },
          captureController.signal,
        ),
        captureController.signal,
      );
      captureController.signal.throwIfAborted();
      this.captureCancelable = false;
      if (this.captureController === captureController) this.captureController = null;
      this.refreshHomeViews();
      const vaultRelative = capturedOutputVaultPath(outputPath, vault);
      if (!vaultRelative) {
        throw new Error(
          "OMD reported completion, but the generated vault note could not be verified. No note was added to OMD Inbox.",
        );
      } else {
        const inspection = await inspectVaultRelativeMarkdownPath(vault, vaultRelative);
        if (inspection.ok && inspection.normalizedPath) {
          try {
            await this.refreshCapturedInboxStatus(inspection.normalizedPath);
            inboxReady = true;
            const indexedFile = this.app.vault.getFileByPath(inspection.normalizedPath);
            capturedFile = indexedFile instanceof TFile ? indexedFile : null;
            if (captureRequest.suggest && !capturedFile) {
              capturedFile = await waitForCapturedVaultFile(inspection.normalizedPath, (path) => {
                const candidate = this.app.vault.getFileByPath(path);
                return candidate instanceof TFile ? candidate : null;
              });
              if (!capturedFile) {
                completionWarningShown = true;
                new Notice("Capture complete and saved to OMD inbox. Link and tag suggestions will be available after Obsidian indexes the note.");
              }
            }
          } catch (error) {
            completionWarningShown = true;
            this.recordIssue("inbox", error, inspection.normalizedPath);
            this.processingEvents.push({
              v: 1,
              event: "error",
              kind: "inbox_failed",
              ts: Date.now() / 1_000,
              message: "Capture saved, but Inbox update failed",
              output: inspection.normalizedPath,
            });
            this.processingEvents = this.processingEvents.slice(-40);
            new Notice(`Capture completed, but OMD Home could not mark the note as Inbox: ${this.lastError}`);
            this.refreshHomeViews();
          }
        } else {
          throw new Error(
            "OMD reported completion, but its generated Markdown file was missing or failed the vault safety check. No note was added to OMD Inbox.",
          );
        }
      }
      completed = true;
      if (retryFailure) {
        this.clearIssueById(retryFailure.issueId);
        if (this.lastCaptureFailure?.id === retryFailure.id) this.lastCaptureFailure = null;
      }
      if (inboxReady) {
        this.processingEvents.push(captureWorkflowDoneEvent(vaultRelative));
        this.processingEvents = this.processingEvents.slice(-40);
        if (!completionWarningShown) new Notice("OMD capture complete");
      }
    } catch (error) {
      const detail = message(error);
      const cancelled = isAbortError(error) || /\bcancelled\b/u.test(detail.toLowerCase());
      let issueId = 0;
      let issueContext: "capture" | "ai" = "capture";
      if (!cancelled && error instanceof LocalAiError) {
        issueContext = "ai";
        if (error.code === "invalid_host") issueId = this.setLocalAiFailure(error);
        else issueId = this.recordIssue("ai", error);
      } else if (!cancelled) {
        issueId = this.recordIssue("capture", error, captureRequest.source);
      }
      if (!cancelled) {
        const failure = createCaptureFailureRecord(
          ++this.captureFailureSequence,
          issueId,
          issueContext,
          this.lastErrorAt,
          this.lastError,
          captureRequest,
        );
        this.lastCaptureFailure = failure;
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
      this.captureCancelable = false;
      if (this.captureController === captureController) this.captureController = null;
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
    if (completed && capturedFile && captureRequest.suggest) {
      await this.suggestLinksAndTags(capturedFile);
    }
  }

  cancelActiveOmd(): void {
    let cancelled = false;
    if (this.captureCancelable && this.captureController) {
      this.captureController?.abort();
      this.captureCancelable = false;
      cancelled = true;
      this.refreshHomeViews();
    }
    if (this.enrichmentCancelable) {
      cancelled = this.enrichmentWorkflowController.cancel(false) || cancelled;
    }
    if (!cancelled) {
      new Notice(this.enrichmentActive
        ? "OMD is applying changes and cannot be cancelled."
        : "OMD is idle");
    }
  }

  async searchWithOmd(query: string, output: HTMLElement): Promise<void> {
    try {
      await this.requireReadyOmdExecutable();
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
    if (this.unloaded) return;
    if (!query) return void new Notice("Enter a question after @");
    const provider = this.settings.aiProvider;
    const model = selectedAiModel(this.settings).trim();
    output.hidden = false;
    output.empty();
    let retrievalOptions = this.qaRetrievalOptions();
    output.createDiv({
      cls: "omd-answer-loading",
      text: this.settings.hybridRetrievalEnabled
        ? "Preparing local hybrid evidence. First use can take longer..."
        : "Retrieving local evidence...",
    });
    const startedAt = performance.now();
    try {
      let answer: AiAnswer;
      if (provider === "ollama") {
        await this.requireReadyOmdExecutable();
        const preview = await this.previewLocalAnswer(query);
        retrievalOptions = preview.retrieval;
        output.empty();
        output.createDiv({ cls: "omd-answer-loading", text: "OMD is reading the selected evidence..." });
        answer = await this.executeLocalAnswer(query, preview.preview, retrievalOptions);
      } else {
        if (!cloudAnswerPermissionEnabled(this.settings)) {
          const detail = `${aiProviderLabel(provider)} answers are off. Enable Allow ${aiProviderLabel(provider)} answers in Settings → OMD Home → AI answers, then ask again.`;
          this.recordIssue("ai", new Error(detail));
          output.empty();
          output.createDiv({ cls: "omd-answer-error", text: detail });
          new Notice(detail);
          return;
        }
        await this.requireReadyOmdExecutable();
        const preview = await this.previewCloudAnswer(query, provider, model);
        if (this.unloaded) return;
        retrievalOptions = preview.retrieval;
        output.empty();
        const consentModal = new CloudAnswerConsentModal(this.app, {
          question: query,
          provider: aiProviderLabel(preview.provider),
          model: preview.preview.preview.model,
          destination_domain: preview.preview.preview.destination_domain,
          estimated_input_tokens: preview.preview.preview.estimated_input_tokens,
          character_count: preview.preview.preview.character_count,
          evidence: preview.preview.evidence,
          data_handling_summary: preview.preview.preview.data_handling_summary,
          policy_url: preview.preview.preview.policy_url,
        });
        this.cloudAnswerConsentModals.add(consentModal);
        let approved: boolean;
        try {
          approved = await consentModal.openAndWait();
        } finally {
          this.cloudAnswerConsentModals.delete(consentModal);
        }
        if (this.unloaded) return;
        if (!approved) {
          this.clearIssue("ai");
          this.setLocalAiFeedback("neutral", "Cloud answer cancelled. No vault evidence was sent.");
          output.createDiv({
            cls: "omd-answer-empty",
            text: "Cloud answer cancelled. No vault evidence was sent.",
          });
          new Notice("Cloud answer cancelled. No vault evidence was sent.");
          return;
        }
        this.assertCloudPreviewStillCurrent(preview);
        output.empty();
        output.createDiv({
          cls: "omd-answer-loading",
          text: `Sending the selected evidence to ${aiProviderLabel(preview.provider)}...`,
        });
        answer = await this.executeCloudAnswer(query, preview);
      }
      this.clearIssue("ai");
      this.renderAiAnswer(output, answer, performance.now() - startedAt);
    } catch (error) {
      if (this.unloaded || isAbortError(error)) return;
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
    if (this.omdCapabilityCheck && !force) return await this.omdCapabilityCheck;
    if (!force && this.enrichmentCapability.status === "ready") return true;
    if (force) {
      this.omdCapabilityGeneration += 1;
      this.omdCapabilityService.cancelActive();
      this.omdCapabilityService.clear();
    }
    const generation = ++this.omdCapabilityGeneration;
    const pending = this.runOmdCapabilityCheck(generation);
    this.omdCapabilityCheck = pending;
    try {
      return await pending;
    } finally {
      if (this.omdCapabilityCheck === pending) this.omdCapabilityCheck = null;
    }
  }

  resetEnrichmentCapability(): void {
    this.omdCapabilityGeneration += 1;
    this.discoveredOmdExecutable = "";
    this.omdCapabilityCheck = null;
    this.omdCapabilityService.cancelActive();
    this.omdCapabilityService.clear();
    this.enrichmentCapability = { status: "unchecked", message: "Not checked since the executable changed" };
    this.refreshHomeViews();
  }

  private async runOmdCapabilityCheck(generation: number): Promise<boolean> {
    const automatic = this.usesAutomaticOmdDiscovery();
    let checkedCapabilities: OmdCapabilities | undefined;
    this.enrichmentCapability = {
      status: "checking",
      message: automatic ? "Looking for OMD in common install locations..." : "Checking the custom OMD executable...",
      checkedAt: Date.now(),
      mode: automatic ? "automatic" : "custom",
    };
    this.refreshHomeViews();
    try {
      const result = await discoverOmdExecutable(
        this.settings.omdExecutable,
        {
          platform: process.platform,
          homeDirectory: process.env.HOME ?? process.env.USERPROFILE ?? "",
          condaPrefix: process.env.CONDA_PREFIX,
          virtualEnvironment: process.env.VIRTUAL_ENV,
        },
        async (executable) => await this.omdCapabilityService.requireEnrichNote(executable),
        async (candidate) => await resolveOmdExecutablePath(candidate, process.platform, spawnProcess),
      );
      if (generation !== this.omdCapabilityGeneration) return false;
      const detectedCapabilities = await this.omdCapabilityService.requireEnrichNote(result.executable);
      checkedCapabilities = detectedCapabilities;
      if (generation !== this.omdCapabilityGeneration) return false;
      this.discoveredOmdExecutable = result.executable;
      this.enrichmentCapability = {
        status: "ready",
        message: omdReadyMessage(result.executable, result.mode, detectedCapabilities),
        checkedAt: Date.now(),
        resolvedExecutable: result.executable,
        mode: result.mode,
        packageVersion: detectedCapabilities.package_version,
        protocolVersion: detectedCapabilities.protocol_version,
        buildRevision: detectedCapabilities.build_revision,
        capabilities: detectedCapabilities,
      };
      return true;
    } catch (error) {
      if (generation !== this.omdCapabilityGeneration) return false;
      this.discoveredOmdExecutable = "";
      const code = isEnrichmentError(error) ? error.code : "omd_failed";
      this.enrichmentCapability = {
        status: "unavailable",
        message: omdUnavailableMessage(error, automatic),
        checkedAt: Date.now(),
        code,
        mode: automatic ? "automatic" : "custom",
        capabilities: checkedCapabilities,
      };
      return false;
    } finally {
      if (generation === this.omdCapabilityGeneration) this.refreshHomeViews();
    }
  }

  invalidateLocalAiState(
    reason: "provider" | "host" | "answer-model" | "model" | "capture-polish" | "retrieval" = "model",
  ): void {
    this.localAiActionToken += 1;
    this.cancelLocalAiRequests();
    this.localAiFailure = null;
    if (reason === "provider" || reason === "answer-model") {
      this.localAiFeedback = null;
      this.clearIssue("ai");
    }
    if (reason === "answer-model" && this.hostedAiState?.provider === this.currentHostedProvider()) {
      this.hostedAiState = {
        ...this.hostedAiState,
        checkedAt: undefined,
        code: "unchecked",
        detail: `Run Check setup to validate ${providerLabel(this.hostedAiState.provider)} and the selected model.`,
        activeAction: "",
      };
    }
    const host = this.currentLocalAiHost();
    const summary = host ? this.localAiSummaries.get(host) : null;
    if ((reason === "answer-model" || reason === "model" || reason === "capture-polish") && host && summary) {
      this.localAiSummaries.set(host, {
        ...summary,
        modelChecks: {},
      });
    }
    this.syncLocalAiState("");
    this.syncHostedAiState("");
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
    this.syncHostedAiState("");
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
        daemonDetail: previous?.daemonDetail ?? "Run Check setup to validate the local daemon and selected models.",
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
        ? `Connection checked. Ollama ${checked.version.version}. ${describeLocalCompletionCatalog(checked.models, true)}`
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
    parentSignal?: AbortSignal,
  ): Promise<T> {
    return await this.withLocalAiSignal(async (signal) => await executeWithLocalAiGate(
      snapshot,
      getCurrentSnapshot,
      async (gatedSnapshot, gateSignal) => await this.runLocalAiSafetyGate(gatedSnapshot, gateSignal),
      downstream,
      signal,
    ), parentSignal);
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

  async refreshCapturedInboxStatus(path: string): Promise<void> {
    const indexedFile = await waitForCapturedVaultFile(path, (candidatePath) => {
      const candidate = this.app.vault.getFileByPath(candidatePath);
      return candidate instanceof TFile ? candidate : null;
    });
    const written = indexedFile
      ? await this.app.vault.process(indexedFile, (content) => setOmdHomeStatusInMarkdown(content, "inbox"))
      : await this.app.vault.adapter.process(path, (content) => setOmdHomeStatusInMarkdown(content, "inbox"));
    if (setOmdHomeStatusInMarkdown(written, "inbox") !== written) {
      throw new Error("The captured note was saved, but its Inbox status was not written.");
    }
    this.clearIssue("inbox");
  }

  private renderAiAnswer(output: HTMLElement, answer: AiAnswer, elapsedMs: number): void {
    output.empty();
    output.hidden = false;
    const header = output.createDiv({ cls: "omd-answer-meta" });
    const provider = isStoredAiProvider(answer.provider) ? aiProviderLabel(answer.provider) : answer.provider;
    header.createSpan({ text: `${provider} / ${answer.model}` });
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

  private recordIssue(context: "capture" | "calendar" | "ai" | "inbox", error: unknown, source = ""): number {
    const issueId = ++this.issueSequence;
    this.lastError = message(error);
    this.lastErrorAt = Date.now();
    this.lastErrorContext = context;
    this.lastErrorSource = source;
    this.lastIssueId = issueId;
    return issueId;
  }

  private clearIssue(context: "capture" | "calendar" | "ai" | "inbox"): void {
    if (this.lastErrorContext && this.lastErrorContext !== context) return;
    this.lastError = "";
    this.lastErrorAt = 0;
    this.lastErrorContext = "";
    this.lastErrorSource = "";
    this.lastIssueId = 0;
  }

  private clearIssueById(issueId: number): void {
    if (issueId !== this.lastIssueId) return;
    this.lastError = "";
    this.lastErrorAt = 0;
    this.lastErrorContext = "";
    this.lastErrorSource = "";
    this.lastIssueId = 0;
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

  private async prepareQaRetrieval(signal?: AbortSignal): Promise<{
    options: HybridRetrievalOptions;
    warning: string | null;
  }> {
    const requested = this.qaRetrievalOptions();
    if (!requested.hybridRetrievalEnabled) return { options: requested, warning: null };
    try {
      const host = normalizeLocalOllamaHost(this.settings.ollamaHost);
      const status = await this.ollamaLocalClient.status(host, signal);
      const models = await this.ollamaLocalClient.tags(host, signal);
      const daemonCode = deriveLocalAiDaemonCode(status, models);
      if (daemonCode === "no_models_installed") throw new LocalAiError(daemonCode, describeDaemonReadiness(daemonCode));
      const embeddingModel = requested.embeddingModel.trim();
      if (!embeddingModel) throw new LocalAiError("selected_model_missing", "Choose a local embedding model.");
      const inspected = buildModelEntry(await this.safeShowModel(host, embeddingModel, signal));
      if (modelHasRemoteMetadata(inspected)) {
        throw new LocalAiError("selected_model_remote_blocked", `${embeddingModel} reported remote Ollama metadata.`);
      }
      if (!modelSupportsEmbedding(inspected)) {
        throw new LocalAiError("selected_model_incompatible", `${embeddingModel} does not advertise embedding support.`);
      }
      const catalogEntry = models.find((model) => model.name === embeddingModel);
      return {
        options: {
          ...requested,
          embeddingModelRevision: inspected.digest ?? catalogEntry?.digest ?? requested.embeddingModelRevision,
        },
        warning: null,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        options: {
          ...requested,
          hybridRetrievalEnabled: false,
          semanticRerankEnabled: false,
          embeddingModelRevision: undefined,
        },
        warning: "hybrid_retrieval_local_safety_fallback",
      };
    }
  }

  private async previewLocalAnswer(query: string): Promise<{
    preview: Awaited<ReturnType<OmdBridge["previewAi"]>>;
    retrieval: HybridRetrievalOptions;
  }> {
    const snapshot = createWorkflowSnapshot("qa", this.settings, true);
    let retrieval = this.qaRetrievalOptions();
    let retrievalWarning: string | null = null;
    const preview = await this.runLocalAiGated(
      snapshot,
      () => createWorkflowSnapshot("qa", this.settings, true),
      async (gatedSnapshot, signal) => {
        const prepared = await this.prepareQaRetrieval(signal);
        retrieval = prepared.options;
        retrievalWarning = prepared.warning;
        return await this.omdBridge.previewAi(
          this.vaultPath(),
          query,
          gatedSnapshot.provider,
          gatedSnapshot.model,
          gatedSnapshot.host,
          retrieval,
          signal,
        );
      },
    );
    return {
      preview: retrievalWarning ? mergeRetrievalWarnings(preview, [retrievalWarning]) : preview,
      retrieval,
    };
  }

  private async previewCloudAnswer(query: string, provider: StoredAiProvider, model: string): Promise<{
    provider: StoredAiProvider;
    model: string;
    endpoint: string;
    preview: Awaited<ReturnType<OmdBridge["previewAi"]>>;
    retrieval: HybridRetrievalOptions;
  }> {
    if (provider === "ollama") {
      throw new Error("Cloud preview is unavailable for the local Ollama provider.");
    }
    if (!model) {
      throw new LocalAiError(
        "selected_model_missing",
        `Choose an answer model for ${aiProviderLabel(provider)} before continuing.`,
      );
    }
    let retrieval = this.qaRetrievalOptions();
    let retrievalWarning: string | null = null;
    const endpoint = provider === "ollama-cloud"
      ? normalizeLocalOllamaHost(this.settings.ollamaHost)
      : this.currentLocalAiHost() ?? DEFAULT_SETTINGS.ollamaHost;
    const preview = await this.withLocalAiSignal(async (signal) => {
      const prepared = await this.prepareQaRetrieval(signal);
      retrieval = prepared.options;
      retrievalWarning = prepared.warning;
      return await this.omdBridge.previewAi(
        this.vaultPath(),
        query,
        provider,
        model,
        endpoint,
        retrieval,
        signal,
      );
    });
    return {
      provider,
      model,
      endpoint,
      preview: retrievalWarning ? mergeRetrievalWarnings(preview, [retrievalWarning]) : preview,
      retrieval,
    };
  }

  private async executeLocalAnswer(
    query: string,
    preview: Awaited<ReturnType<OmdBridge["previewAi"]>>,
    retrieval: HybridRetrievalOptions,
  ): Promise<AiAnswer> {
    const snapshot = createWorkflowSnapshot("qa", this.settings, true);
    const answer = await this.runLocalAiGated(
      snapshot,
      () => createWorkflowSnapshot("qa", this.settings, true),
      async (gatedSnapshot, signal) => await this.omdBridge.executeAi(
        this.vaultPath(),
        query,
        gatedSnapshot.provider,
        gatedSnapshot.model,
        gatedSnapshot.host,
        false,
        preview.consent_grant ?? null,
        retrieval,
        signal,
      ),
    );
    return mergeRetrievalWarnings(answer, preview.warnings ?? []);
  }

  private async executeCloudAnswer(
    query: string,
    preview: {
      provider: StoredAiProvider;
      model: string;
      endpoint: string;
      preview: Awaited<ReturnType<OmdBridge["previewAi"]>>;
      retrieval: HybridRetrievalOptions;
    },
  ): Promise<AiAnswer> {
    const answer = await this.withLocalAiSignal(async (signal) => await this.omdBridge.executeAi(
      this.vaultPath(),
      query,
      preview.provider,
      preview.model,
      preview.endpoint,
      true,
      preview.preview.consent_grant ?? null,
      preview.retrieval,
      signal,
    ));
    return mergeRetrievalWarnings(answer, preview.preview.warnings ?? []);
  }

  private assertCloudPreviewStillCurrent(preview: {
    provider: StoredAiProvider;
    model: string;
    endpoint: string;
  }): void {
    const provider = this.settings.aiProvider;
    const model = selectedAiModel(this.settings).trim();
    const endpoint = provider === "ollama-cloud"
      ? normalizeLocalOllamaHost(this.settings.ollamaHost)
      : this.currentLocalAiHost() ?? DEFAULT_SETTINGS.ollamaHost;
    if (provider !== preview.provider
      || model !== preview.model
      || endpoint !== preview.endpoint
      || !cloudAnswerPermissionEnabled(this.settings)) {
      throw new LocalAiError(
        "snapshot_mismatch",
        "The selected cloud answer route changed after preview. Review the latest settings and preview again.",
      );
    }
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

  private async withLocalAiSignal<T>(
    task: (signal: AbortSignal) => Promise<T>,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const relayAbort = () => controller.abort();
    if (this.unloaded || parentSignal?.aborted) controller.abort();
    else parentSignal?.addEventListener("abort", relayAbort, { once: true });
    this.localAiControllers.add(controller);
    try {
      controller.signal.throwIfAborted();
      const result = await task(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      parentSignal?.removeEventListener("abort", relayAbort);
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

  private setLocalAiFailure(error: unknown, knownHost?: string): number {
    if (isAbortError(error)) return 0;
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
    const issueId = this.recordIssue("ai", error);
    this.syncLocalAiState(this.localAiState.activeAction);
    return issueId;
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

  private currentHostedProvider(): HostedAiProvider | null {
    return isHostedApiProvider(this.settings.aiProvider) ? this.settings.aiProvider : null;
  }

  async ensureHostedCredentialState(provider: HostedAiProvider, force = false): Promise<void> {
    if (this.unloaded || this.currentHostedProvider() !== provider) return;
    if (!force && this.hostedAiState?.provider === provider
      && (this.hostedAiState.credential || this.hostedAiState.checkedAt !== undefined || this.hostedAiState.activeAction)) return;
    if (!force && this.hostedCredentialHydration && this.hostedCredentialHydrationProvider === provider) {
      return await this.hostedCredentialHydration;
    }
    const pending = this.loadHostedCredentialState(provider);
    this.hostedCredentialHydration = pending;
    this.hostedCredentialHydrationProvider = provider;
    try {
      await pending;
    } finally {
      if (this.hostedCredentialHydration === pending) {
        this.hostedCredentialHydration = null;
        this.hostedCredentialHydrationProvider = null;
      }
    }
  }

  private async loadHostedCredentialState(provider: HostedAiProvider): Promise<void> {
    const startedAt = Date.now();
    const action = this.localAiActionToken;
    try {
      await this.requireReadyOmdExecutable();
      if (!this.isCurrentHostedAiAction(action, provider)) return;
      const credential = await this.omdBridge.hostedCredentialState(provider);
      if (!this.isCurrentHostedAiAction(action, provider)) return;
      const existing = this.hostedAiState?.provider === provider ? this.hostedAiState : null;
      if (existing?.activeAction) return;
      if (existing?.checkedAt && existing.checkedAt > startedAt) return;
      const model = selectedAiModel(this.settings);
      this.hostedAiState = {
        ...(existing ?? buildHostedState(provider)),
        provider,
        checkedAt: Date.now(),
        code: credential.source === "missing"
          ? "credentials_missing"
          : model ? "unchecked" : "selected_model_missing",
        detail: credential.source === "missing"
          ? `Add or confirm a ${providerLabel(provider)} API key, then check setup.`
          : model
            ? `Run Check setup to validate ${providerLabel(provider)} and the selected model.`
            : `Choose a ${providerLabel(provider)} answer model, then check setup.`,
        credential,
        destinationDomain: providerDomain(provider),
      };
      this.refreshHomeViews();
    } catch (error) {
      if (isAbortError(error) || !this.isCurrentHostedAiAction(action, provider)) return;
      const existing = this.hostedAiState?.provider === provider ? this.hostedAiState : null;
      if (existing?.activeAction || (existing?.checkedAt !== undefined && existing.checkedAt > startedAt)) return;
      this.hostedAiState = {
        ...(existing ?? buildHostedState(provider)),
        checkedAt: Date.now(),
        code: mapHostedErrorCode(error),
        detail: `Could not check ${providerLabel(provider)} credentials. ${message(error)} Run Check setup to retry.`,
      };
      this.refreshHomeViews();
    }
  }

  private syncHostedAiState(activeAction: HostedAiRuntimeState["activeAction"]): void {
    const provider = this.currentHostedProvider();
    if (!provider) {
      this.hostedAiState = null;
      return;
    }
    if (!this.hostedAiState || this.hostedAiState.provider !== provider) {
      this.hostedAiState = { ...buildHostedState(provider), activeAction };
      return;
    }
    this.hostedAiState = { ...this.hostedAiState, activeAction };
  }

  private beginHostedAiAction(action: Exclude<HostedAiRuntimeState["activeAction"], "">): number {
    const token = ++this.localAiActionToken;
    this.syncHostedAiState(action);
    return token;
  }

  private isCurrentHostedAiAction(token: number, provider: HostedAiProvider): boolean {
    return !this.unloaded && token === this.localAiActionToken && this.currentHostedProvider() === provider;
  }

  private finishHostedAiAction(token: number, provider: HostedAiProvider): void {
    if (!this.isCurrentHostedAiAction(token, provider)) return;
    this.syncHostedAiState("");
  }

  toggleRecording(): void {
    if (this.runRecordingCommand("toggle", "Recording toggled.")) return;
    new Notice("No recorder toggle is available. Use start recording or stop recording from the command palette.");
  }

  startRecording(): void {
    if (this.runRecordingCommand("start", "Recording started.")) return;
    new Notice("Enable audio recorder in settings -> core plugins, then try again.");
  }

  stopRecording(): void {
    if (this.runRecordingCommand("stop", "Recording stopped.")) return;
    new Notice("Enable audio recorder in settings -> core plugins, then try again.");
  }

  private runRecordingCommand(kind: "start" | "stop" | "toggle", successMessage: string): boolean {
    const commands = (this.app as App & {
      commands: {
        listCommands(): RecordingCommandRef[];
        executeCommandById(id: string): boolean;
      };
    }).commands;
    const command = resolveRecordingCommand(
      commands.listCommands().filter(
        (candidate) => !isPluginRecordingWrapperCommand(candidate.id, this.manifest.id),
      ),
      kind,
    );
    if (!command) return false;
    if (!commands.executeCommandById(command.id)) return false;
    new Notice(successMessage);
    return true;
  }
}

async function probeOmdCaptureExecutable(executable: string, signal?: AbortSignal): Promise<void> {
  try {
    const result = await spawnProcess(executable, ["capture", "--help"], {
      signal,
      timeoutMs: 5_000,
      maxStdoutChars: 16_000,
      maxStderrChars: 16_000,
    });
    if (result.code !== 0) {
      throw new OmdEnrichmentError("omd_failed", "The configured OMD executable does not provide the capture command.");
    }
  } catch (error) {
    if (error instanceof OmdEnrichmentError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OmdEnrichmentError("cancelled", "The OMD capture setup check was cancelled.", { cause: error });
    }
    const detail = error instanceof Error ? error.message : "";
    if (/ENOENT|not found|could not find/iu.test(detail)) {
      throw new OmdEnrichmentError("missing_executable", "The configured OMD executable could not be found.", { cause: error as Error });
    }
    if (/timed out/iu.test(detail)) {
      throw new OmdEnrichmentError("capability_timeout", "The OMD capture setup check timed out after five seconds.", { cause: error as Error });
    }
    throw new OmdEnrichmentError("omd_failed", "OMD could not be checked before capture.", { cause: error as Error });
  }
}

function captureLanguageAvailabilityState(
  status: "unchecked" | "unsupported",
  messageText: string,
): CaptureLanguageAvailability {
  const options = status === "unchecked"
    ? [
      { label: "English", value: "eng" as const },
      { label: "简体中文 + English", value: "chi_sim+eng" as const },
      { label: "繁體中文 + English", value: "chi_tra+eng" as const },
    ]
    : [];
  return {
    status,
    message: messageText,
    ocrPresets: options,
    customOcr: status === "unchecked",
    ocrBackendAvailable: null,
    ocrInstalledPacks: null,
    asrAutoDetect: status === "unchecked",
    asrExplicit: status === "unchecked",
  };
}

function omdReadyMessage(
  executable: string,
  mode: OmdDiscoveryMode,
  capability: OmdCapabilities,
): string {
  const location = mode === "custom" ? "Custom executable" : "Resolved executable";
  const identity = omdCapabilityIdentityLabel(capability);
  return identity
    ? `OMD is ready. ${location}: ${executable}. Detected ${identity}.`
    : `OMD is ready. ${location}: ${executable}.`;
}

function omdUnavailableMessage(error: unknown, automatic: boolean): string {
  if (isEnrichmentError(error) && error.code === "missing_executable") {
    return automatic
      ? "OMD was not found in the app path or common install locations. Install OMD, then check again."
      : "The custom OMD executable could not be found. Use automatic discovery or update the override in Advanced OMD paths.";
  }
  if (isEnrichmentError(error)
    && (error.code === "unsupported_capability" || error.code === "unsupported_schema")) {
    return automatic
      ? "An OMD installation was found, but it is too old for this OMD Home build. Update OMD, then check again."
      : "The custom OMD installation is too old for this OMD Home build. Update it or use automatic discovery.";
  }
  return toUserFacingEnrichmentMessage(error);
}

function providerLabel(provider: HostedAiProvider): string {
  return aiProviderLabel(provider);
}

function providerDomain(provider: HostedAiProvider): string {
  return aiProviderDestination(provider);
}

function buildHostedState(provider: HostedAiProvider): HostedAiRuntimeState {
  return {
    provider,
    code: "unchecked",
    detail: `Add or confirm a ${aiProviderLabel(provider)} API key, then check setup.`,
    models: [],
    activeAction: "",
    credential: null,
    destinationDomain: aiProviderDestination(provider),
  };
}

function mapHostedErrorCode(error: unknown): HostedAiRuntimeState["code"] {
  const detail = message(error).toLowerCase();
  if (/credential|api key|keychain/u.test(detail)) return "credentials_missing";
  if (/model.+(?:unavailable|missing|not found)/u.test(detail)) return "model_unavailable";
  if (/catalog|validate provider models|model check/u.test(detail)) return "provider_catalog_unavailable";
  if (/connect|network|transport|timeout|http/u.test(detail)) return "provider_unreachable";
  return "provider_catalog_unavailable";
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

function mergeRetrievalWarnings<T extends { warnings?: string[] }>(value: T, warnings: string[]): T {
  if (!warnings.length) return value;
  const unique = [...new Set([...(value.warnings ?? []), ...warnings])];
  return { ...value, warnings: unique };
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
  if (value === "hybrid_retrieval_local_safety_fallback") {
    return "The local embedding setup could not be verified, so this answer used sparse vault search only.";
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
  return "Polish Markdown";
}
