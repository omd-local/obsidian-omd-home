import { App, Notice, Platform, PluginSettingTab, Setting, TextComponent } from "obsidian";
import {
  AI_PROVIDER_VALUES,
  DEFAULT_AI_MODELS,
  aiProviderDestination,
  aiProviderEnvVar,
  aiProviderLabel,
  isCloudAiProvider,
  isHostedApiProvider,
  isStoredAiProvider,
  modelIsCloudBacked,
  modelIsVerifiedOllamaCloud,
  normalizeAiModelMemory,
  providerSetupDescription,
  type AiModelMemory,
} from "./ai-provider.ts";
import { canOpenOllamaDesktopApp } from "./ollama-app";
import type OmdHomePlugin from "./main";
import type { ExternalCalendarDescriptor } from "./model";
import {
  buildModelSelectorState,
  describeLocalCompletionCatalog,
  localModelNamesMatch,
  localWritingModelIsSelectable,
  localWritingModelOptionLabel,
  modelSupportsEmbedding,
  normalizeLocalOllamaHost,
  oneClickInstallableEmbeddingModel,
} from "./local-ai-readiness";
import type {
  HostedAiProvider,
  LocalAiModelEntry,
  LocalAiWorkflowDisplayState,
  LocalAiWorkflowId,
  StoredAiProvider,
} from "./ollama-local-types";
import { isAutomaticOmdExecutable, omdInstallInstructions } from "./omd-discovery.ts";
import {
  OCR_LANGUAGE_PRESETS,
  missingInstalledOcrPacks,
  normalizeOcrLanguageSet,
  type CaptureAsrSetting,
} from "./capture-request.ts";

const CUSTOM_OCR_DEFAULT_DESCRIPTION = "Advanced: enter up to eight installed Tesseract language pack ids joined with +. Script packs such as script/HanS are supported.";
const INVALID_CUSTOM_OCR_NOTICE = "Custom OCR must use up to eight safe Tesseract language pack ids joined with +.";

function disableUnavailableLocalModelOptions(selectEl: HTMLSelectElement, models: LocalAiModelEntry[]): void {
  const unavailableNames = new Set(
    models.filter((model) => !localWritingModelIsSelectable(model)).map((model) => model.name),
  );
  for (const option of Array.from(selectEl.options)) {
    if (!unavailableNames.has(option.value)) continue;
    option.disabled = true;
    option.title = "This downloaded model cannot be used for local text answers.";
  }
}

export interface OmdHomeSettings {
  openOnLaunch: boolean;
  omdExecutable: string;
  pythonExecutable: string;
  pythonBridgePath: string;
  eventKitHelperPath: string;
  selectedCalendarIds: string[];
  defaultExternalCalendarId: string;
  aiProvider: StoredAiProvider;
  aiModel: string;
  aiModels: AiModelMemory;
  allowedCloudAnswerProviders: StoredAiProvider[];
  hybridRetrievalEnabled: boolean;
  embeddingModel: string;
  semanticRerankEnabled: boolean;
  localWritingModel: string;
  ollamaHost: string;
  capturePolish: boolean;
  captureSuggestLinksAndTags: boolean;
  captureOcrLanguage: string;
  captureAsrLanguage: CaptureAsrSetting;
  pinnedNotes: string[];
}

export const DEFAULT_SETTINGS: OmdHomeSettings = {
  openOnLaunch: true,
  omdExecutable: "omd",
  pythonExecutable: "",
  pythonBridgePath: "",
  eventKitHelperPath: "",
  selectedCalendarIds: [],
  defaultExternalCalendarId: "",
  aiProvider: "ollama",
  aiModel: "qwen3:4b-instruct",
  aiModels: { ...DEFAULT_AI_MODELS },
  allowedCloudAnswerProviders: [],
  hybridRetrievalEnabled: true,
  embeddingModel: "bge-m3",
  semanticRerankEnabled: false,
  localWritingModel: "qwen3:4b-instruct",
  ollamaHost: "http://localhost:11434",
  capturePolish: false,
  captureSuggestLinksAndTags: true,
  captureOcrLanguage: "",
  captureAsrLanguage: "inherit-adapter-default",
  pinnedNotes: [],
};

export class OmdHomeSettingTab extends PluginSettingTab {
  private readonly plugin: OmdHomePlugin;
  private readonly customModelModes = new Set<LocalAiWorkflowId>();
  private readonly customModelDrafts = new Map<string, string>();
  private readonly hostedCredentialDrafts = new Map<HostedAiProvider, string>();
  private settingsSaveQueue: Promise<void> = Promise.resolve();
  private localAiAdvancedExpanded = false;

  constructor(app: App, plugin: OmdHomePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("omd-settings");

    new Setting(containerEl).setName("Startup").setHeading().settingEl.addClass("omd-settings-heading");

    new Setting(containerEl)
      .setName("Open home on launch")
      .setDesc("Open once when Obsidian starts without closing restored tabs.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.openOnLaunch).onChange(async (value) => {
        this.plugin.settings.openOnLaunch = value;
        await this.saveSettingsInOrder();
      }));

    new Setting(containerEl).setName("OMD").setHeading().settingEl.addClass("omd-settings-heading");
    this.renderOmdSetup(containerEl);

    const localAiSection = containerEl.createDiv({ cls: "omd-settings-section omd-settings-local-ai" });
    this.renderLocalAiSection(localAiSection);

    const calendarSection = containerEl.createDiv({ cls: "omd-settings-section omd-settings-calendar" });
    this.renderCalendarSection(calendarSection);
  }

  private renderCalendarSection(container: HTMLElement): void {
    container.empty();
    new Setting(container).setName("Calendar").setHeading().settingEl.addClass("omd-settings-heading");
    if (!Platform.isMacOS) {
      new Setting(container)
        .setName("Apple Calendar unavailable")
        .setDesc("Apple Calendar integration is supported on macOS only. Markdown events remain available on every device.");
      return;
    }

    const resolvedHelperPath = this.plugin.resolvedEventKitHelperPath();
    const helperAvailable = this.plugin.hasEventKitHelper();
    const connection = new Setting(container)
      .setName(helperAvailable ? "Calendar connection" : "Calendar helper unavailable")
      .setDesc(helperAvailable
        ? "Load Apple Calendar plus Google and Outlook accounts already added to macOS Calendar. You choose which calendars OMD Home can use."
        : "Apple Calendar needs the optional EventKit helper, which is not included in the standard Marketplace files. Open Calendar setup or Advanced Calendar helper below.")
      .addButton((button) => button
        .setButtonText(this.plugin.calendarLoading ? "Loading…" : helperAvailable ? "Refresh calendars" : "Try again")
        .setDisabled(this.plugin.calendarLoading)
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Loading…");
          await this.plugin.refreshExternalCalendars();
          if (container.isConnected) this.renderCalendarSection(container);
        }));
    connection.settingEl.addClass("omd-settings-calendar-status", helperAvailable ? "is-ready" : "is-unavailable");

    if (this.plugin.calendarFeedback) {
      const feedback = container.createDiv({ cls: `omd-settings-feedback is-${this.plugin.calendarFeedback.tone}` });
      feedback.createEl("strong", { text: this.plugin.calendarFeedback.message });
      feedback.createSpan({ text: new Date(this.plugin.calendarFeedback.at).toLocaleTimeString() });
    }

    const calendars = this.plugin.externalCalendars;
    const reconciledSettings = reconcileCalendarSelection(this.plugin.settings, calendars);
    if (
      reconciledSettings.defaultExternalCalendarId !== this.plugin.settings.defaultExternalCalendarId
      || reconciledSettings.selectedCalendarIds.join("\u0000") !== this.plugin.settings.selectedCalendarIds.join("\u0000")
    ) {
      this.plugin.settings = reconciledSettings;
      void this.saveSettingsInOrder();
    }

    if (!calendars.length) {
      container.createEl("p", {
        cls: "omd-settings-empty",
        text: this.plugin.calendarFeedback?.tone === "error"
          ? "Calendars are unavailable. Check the message above, macOS Calendar permission, or the advanced helper override."
          : "No calendars loaded yet. Refresh calendars and allow Calendar access if macOS asks.",
      });
    }
    for (const calendar of calendars) {
      new Setting(container)
        .setName(`${calendar.sourceTitle} / ${calendar.title}`)
        .setDesc(calendar.allowsModifications ? "Read and write" : "Read only")
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.selectedCalendarIds.includes(calendar.id))
          .onChange(async (enabled) => {
            const selected = new Set(this.plugin.settings.selectedCalendarIds);
            enabled ? selected.add(calendar.id) : selected.delete(calendar.id);
            this.plugin.settings = reconcileCalendarSelection({
              ...this.plugin.settings,
              selectedCalendarIds: [...selected],
            }, calendars);
            await this.saveSettingsInOrder();
            await this.plugin.refreshCalendarEvents();
            if (container.isConnected) this.renderCalendarSection(container);
          }));
    }

    const writable = calendars.filter(
      (calendar) => calendar.allowsModifications && this.plugin.settings.selectedCalendarIds.includes(calendar.id),
    );
    new Setting(container)
      .setName("Default calendar")
      .setDesc("New linked events use this calendar. Only selected writable calendars appear here.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Choose a calendar");
        for (const calendar of writable) dropdown.addOption(calendar.id, `${calendar.sourceTitle} / ${calendar.title}`);
        dropdown.setValue(this.plugin.settings.defaultExternalCalendarId).onChange(async (value) => {
          this.plugin.settings = reconcileCalendarSelection({
            ...this.plugin.settings,
            defaultExternalCalendarId: value,
          }, calendars);
          await this.saveSettingsInOrder();
        });
      });

    const advanced = this.settingsDisclosure(
      container,
      "Advanced Calendar helper",
      "Leave this blank to use an optional helper installed beside the plugin. Set an absolute path only for development or recovery.",
    );
    advanced.toggleAttribute("open", !helperAvailable || Boolean(this.plugin.settings.eventKitHelperPath));
    const helperSetting = new Setting(advanced)
      .setName("Helper override")
      .setDesc(this.plugin.settings.eventKitHelperPath
        ? helperAvailable ? "Using the custom helper path." : "The custom helper was not found or is not executable."
        : `Automatic path: ${resolvedHelperPath || "not resolved"}`)
      .addText((text) => text
        .setPlaceholder("Automatic bundled helper")
        .setValue(this.plugin.settings.eventKitHelperPath)
        .onChange(async (value) => {
          this.plugin.settings.eventKitHelperPath = value.trim();
          await this.saveSettingsInOrder();
        }));
    if (this.plugin.settings.eventKitHelperPath) {
      helperSetting.addButton((button) => button
        .setButtonText("Use bundled")
        .onClick(async () => {
          this.plugin.settings.eventKitHelperPath = "";
          await this.saveSettingsInOrder();
          if (container.isConnected) this.renderCalendarSection(container);
        }));
    }
  }

  private renderLocalAiSection(container: HTMLElement): void {
    container.empty();
    new Setting(container).setName("AI answers").setHeading().settingEl.addClass("omd-settings-heading");

    const provider = this.plugin.settings.aiProvider;
    const aiSetupBusy = this.plugin.aiSetupBusy();
    new Setting(container)
      .setName("Answer provider")
      .setDesc(`Choose where @ questions are answered. ${providerSetupDescription(provider)}`)
      .addDropdown((dropdown) => {
        for (const value of AI_PROVIDER_VALUES) dropdown.addOption(value, aiProviderLabel(value));
        dropdown.setValue(provider).setDisabled(aiSetupBusy).onChange(async (value) => {
          await this.changeAnswerProvider(value);
        });
      });

    if (isCloudAiProvider(provider)) {
      const destination = new Setting(container)
        .setName("Request destination")
        .setDesc("Only the question and evidence excerpts shown in the per-request preview can be sent to this fixed destination.");
      destination.controlEl.createSpan({
        cls: "omd-settings-fixed-value",
        text: aiProviderDestination(provider),
      });
      destination.settingEl.addClass("omd-settings-destination");
    }

    if (isCloudAiProvider(provider)) {
      const permission = new Setting(container)
        .setName(`Allow ${aiProviderLabel(provider)} answers`)
        .setDesc(`Allow @ answers to use ${aiProviderDestination(provider)} only while ${aiProviderLabel(provider)} is selected. Before every request, OMD Home shows the destination, model, and bounded evidence excerpts and asks you to approve sending them.`)
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.allowedCloudAnswerProviders.includes(provider))
          .setDisabled(aiSetupBusy)
          .onChange(async (enabled) => {
            await this.changeCloudAnswerPermission(provider, enabled);
          }));
      if (provider === "ollama-cloud") {
        permission.addButton((button) => button
          .setButtonText("Setup guide")
          .onClick(() => this.plugin.openCloudAiGuide()));
      }
      permission.settingEl.addClass("omd-settings-model", "omd-settings-cloud-permission");
    }

    if (isHostedApiProvider(provider)) this.hostedCredentialSetting(container, provider);
    this.answerModelSetting(container, provider);
    this.answerProviderStatusSetting(container, provider);
    if (isHostedApiProvider(provider)
      && (!this.plugin.hostedAiState || this.plugin.hostedAiState.provider !== provider
        || (!this.plugin.hostedAiState.credential && this.plugin.hostedAiState.checkedAt === undefined && !this.plugin.hostedAiState.activeAction))) {
      void this.plugin.ensureHostedCredentialState(provider).finally(() => {
        if (container.isConnected && this.plugin.settings.aiProvider === provider) {
          this.rerenderLocalAiSection();
        }
      });
    }

    if (this.plugin.localAiFeedback) {
      const feedback = container.createDiv({ cls: `omd-settings-feedback is-${this.plugin.localAiFeedback.tone}` });
      feedback.createEl("strong", { text: this.plugin.localAiFeedback.message });
      feedback.createSpan({ text: new Date(this.plugin.localAiFeedback.at).toLocaleTimeString() });
    }

    const advanced = this.settingsDisclosure(
      container,
      "Advanced AI controls",
      "Configure vault retrieval, the local writing model, and Ollama troubleshooting.",
    );
    advanced.open = this.localAiAdvancedExpanded;
    advanced.addEventListener("toggle", () => {
      this.localAiAdvancedExpanded = advanced.open;
    });
    new Setting(advanced).setName("Vault retrieval").setHeading().settingEl.addClass("omd-settings-subheading");
    this.hybridRetrievalSetting(advanced);
    this.embeddingModelSetting(advanced);
    new Setting(advanced)
      .setName("Semantic rerank")
      .setDesc("Reorder selected evidence with the local embedding model. Keyword search order is kept if reranking fails.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.semanticRerankEnabled)
        .setDisabled(aiSetupBusy || !this.plugin.settings.hybridRetrievalEnabled)
        .onChange(async (value) => {
          this.plugin.settings.semanticRerankEnabled = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.saveSettingsInOrder();
        }));

    new Setting(advanced)
      .setName("Local writing tools")
      .setDesc("The capture dialog turns optional writing actions on or off. Choose the loopback Ollama model they share here. These actions never use the cloud answer provider.")
      .setHeading().settingEl.addClass("omd-settings-subheading");
    this.modelSetting(
      advanced,
      "Local writing model",
      "Used by optional Markdown polish and review-first link and tag proposals.",
      "localWritingModel",
      "enrichment",
    );
    new Setting(advanced).setName("Ollama troubleshooting").setHeading().settingEl.addClass("omd-settings-subheading");
    let endpointValidation: ((value: string) => boolean) | undefined;
    let validation: HTMLElement | null = null;
    const endpoint = new Setting(advanced)
      .setName("Ollama endpoint")
      .setDesc("Default: http://localhost:11434. For security, the only alternative is http://127.0.0.1:11434.")
      .addText((text) => {
        const updateValidation = (value: string): boolean => {
          const candidate = value.trim();
          try {
            normalizeLocalOllamaHost(candidate);
            endpoint.settingEl.removeClass("is-invalid");
            text.inputEl.removeAttribute("aria-invalid");
            validation?.empty();
            return true;
          } catch {
            endpoint.settingEl.addClass("is-invalid");
            text.inputEl.setAttribute("aria-invalid", "true");
            validation?.setText("Use http://localhost:11434 or http://127.0.0.1:11434. The last valid endpoint remains saved.");
            return false;
          }
        };
        endpointValidation = updateValidation;
        text.setValue(this.plugin.settings.ollamaHost).setDisabled(aiSetupBusy).onChange(async (value) => {
          if (!updateValidation(value)) return;
          this.plugin.settings.ollamaHost = value.trim();
          this.plugin.invalidateLocalAiState("host");
          await this.saveSettingsInOrder();
        });
      });
    validation = endpoint.settingEl.createDiv({ cls: "omd-settings-endpoint-validation" });
    validation.id = "omd-settings-endpoint-validation";
    validation.setAttribute("role", "alert");
    endpoint.controlEl.querySelector<HTMLInputElement>("input")?.setAttribute("aria-describedby", validation.id);
    endpoint.settingEl.addClass("omd-settings-model", "omd-settings-endpoint");
    endpointValidation?.(this.plugin.settings.ollamaHost);
  }

  private rerenderLocalAiSection(): void {
    const section = this.containerEl.querySelector<HTMLElement>(".omd-settings-local-ai");
    if (section?.isConnected) this.renderLocalAiSection(section);
  }

  private saveSettingsInOrder(): Promise<void> {
    const pending = this.settingsSaveQueue.then(() => this.plugin.saveSettings());
    this.settingsSaveQueue = pending.catch(() => {
      new Notice("Could not save settings. Your changes remain in this session. Try the change again.");
    });
    return pending;
  }

  private async changeAnswerProvider(value: string): Promise<boolean> {
    if (!isStoredAiProvider(value)) return false;
    const previousProvider = this.plugin.settings.aiProvider;
    if (value === previousProvider) return false;
    this.plugin.settings.aiModels[previousProvider] = this.plugin.settings.aiModel.trim();
    this.plugin.settings.aiProvider = value;
    this.plugin.settings.aiModel = this.plugin.settings.aiModels[value];
    this.customModelModes.delete("qa");
    this.plugin.invalidateLocalAiState("provider");
    this.rerenderLocalAiSection();
    await this.saveSettingsInOrder();
    return true;
  }

  private async changeCloudAnswerPermission(provider: StoredAiProvider, enabled: boolean): Promise<boolean> {
    if (!isCloudAiProvider(provider) || this.plugin.settings.aiProvider !== provider) return false;
    const allowed = new Set(this.plugin.settings.allowedCloudAnswerProviders.filter(isCloudAiProvider));
    enabled ? allowed.add(provider) : allowed.delete(provider);
    this.plugin.settings.allowedCloudAnswerProviders = [...allowed];
    this.plugin.invalidateCloudAnswerConsent();
    this.rerenderLocalAiSection();
    await this.saveSettingsInOrder();
    new Notice(enabled
      ? `${aiProviderLabel(provider)} answers allowed. OMD Home will still ask before every request.`
      : `${aiProviderLabel(provider)} answers disabled. No new vault evidence will be sent to this provider.`);
    return true;
  }

  showRetrievalSettings(): void {
    this.localAiAdvancedExpanded = true;
    this.display();
    const target = this.containerEl.querySelector<HTMLElement>(".omd-settings-embedding-model");
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  private async runAiSetupAction<T>(action: () => Promise<T>): Promise<T> {
    const pending = action();
    this.rerenderLocalAiSection();
    try {
      return await pending;
    } finally {
      this.rerenderLocalAiSection();
    }
  }

  private hostedCredentialSetting(container: HTMLElement, provider: HostedAiProvider): void {
    const state = this.plugin.hostedAiState?.provider === provider ? this.plugin.hostedAiState : null;
    const aiSetupBusy = this.plugin.aiSetupBusy();
    const credential = state?.credential;
    const envVar = aiProviderEnvVar(provider);
    if (!Platform.isMacOS || credential?.keychainSupported === false) {
      const setting = new Setting(container)
        .setName("Developer key")
        .setDesc(credential?.source === "env"
          ? `Using ${credential.envVar || envVar} from the OMD environment. Consumer subscriptions do not include API usage.`
          : `Set ${envVar} before starting Obsidian, then run Check setup. In-app saving appears only when macOS Keychain is available. Consumer subscriptions do not include API usage.`);
      setting.settingEl.addClass("omd-settings-model", "omd-settings-secret");
      return;
    }
    const savedDraft = this.hostedCredentialDrafts.get(provider) ?? "";
    const setting = new Setting(container)
      .setName("Developer key")
      .setDesc(credential?.source === "env"
        ? credential.keychainPresent
          ? `Using ${credential.envVar} from the OMD environment. A separate stored Keychain key is present and can be removed below. Consumer subscriptions do not include API usage.`
          : `Using ${credential.envVar} from the OMD environment. Consumer subscriptions do not include API usage.`
        : credential?.source === "keychain"
          ? "Saved in macOS Keychain. Consumer subscriptions do not include API usage."
          : `Paste a developer API key to save it in macOS Keychain, or set ${envVar} before starting Obsidian. The key is never stored in plugin settings. Consumer subscriptions do not include API usage.`);
    const secret = new TextComponent(setting.controlEl)
      .setValue(savedDraft)
      .setPlaceholder(credential?.source === "keychain" ? "Key saved" : "Paste API key")
      .setDisabled(aiSetupBusy)
      .onChange((value) => {
        if (value) this.hostedCredentialDrafts.set(provider, value);
        else this.hostedCredentialDrafts.delete(provider);
      });
    secret.inputEl.type = "password";
    secret.inputEl.autocomplete = "off";
    setting.addButton((button) => button
      .setButtonText(state?.activeAction === "save-key"
        ? "Saving…"
        : state?.activeAction === "check-connection"
          ? "Checking…"
          : "Save & check")
      .setDisabled(aiSetupBusy)
      .onClick(async () => {
        const submittedDraft = this.hostedCredentialDrafts.get(provider) ?? "";
        if (!submittedDraft.trim()) return void new Notice("Paste a developer key first.");
        let saved = false;
        try {
          saved = await this.runAiSetupAction(() => this.plugin.saveHostedApiKey(submittedDraft));
        } catch {
          // The plugin records and surfaces the safe provider error.
        }
        if (saved && this.hostedCredentialDrafts.get(provider) === submittedDraft) {
          this.hostedCredentialDrafts.delete(provider);
          this.rerenderLocalAiSection();
        }
        if (saved) {
          await this.runAiSetupAction(() => this.plugin.checkHostedAiConnection());
        }
      }));
    if (credential?.keychainPresent) {
      setting.addButton((button) => button
        .setButtonText(credential.source === "env" ? "Remove stored key" : "Remove key")
        .setWarning()
        .setDisabled(aiSetupBusy)
        .onClick(async () => {
          await this.runAiSetupAction(() => this.plugin.deleteHostedApiKey());
        }));
    }
    setting.settingEl.addClass("omd-settings-model", "omd-settings-secret");
  }

  private answerModelSetting(container: HTMLElement, provider: StoredAiProvider): void {
    const draftKey = `answer:${provider}`;
    const aiSetupBusy = this.plugin.aiSetupBusy();
    const qaWorkflow = this.plugin.localAiState.workflows.qa;
    const catalogChecked = typeof this.plugin.localAiState.catalogCheckedAt === "number";
    const localModels = this.plugin.localAiState.models.filter((model) => !modelIsCloudBacked(model));
    const selectableLocalModels = localModels.filter(localWritingModelIsSelectable);
    const hostedState = isHostedApiProvider(provider) && this.plugin.hostedAiState?.provider === provider
      ? this.plugin.hostedAiState
      : null;
    const hostedCredentialReady = hostedState?.credential?.source === "env"
      || hostedState?.credential?.source === "keychain";
    const models = provider === "ollama"
      ? localModels
      : provider === "ollama-cloud"
        ? this.plugin.localAiState.models.filter(modelIsVerifiedOllamaCloud)
        : this.plugin.hostedAiState?.provider === provider ? this.plugin.hostedAiState.models : [];
    const current = this.plugin.settings.aiModel.trim();
    const allowCustom = provider !== "ollama-cloud"
      && (!isHostedApiProvider(provider) || hostedCredentialReady);
    const ollamaCatalogProvider = provider === "ollama" || provider === "ollama-cloud";
    const matchingOllamaModel = ollamaCatalogProvider
      ? models.find((model) => localModelNamesMatch(model.name, current))
      : undefined;
    const known = ollamaCatalogProvider
      ? Boolean(matchingOllamaModel)
      : models.some((model) => model.name === current);
    const custom = allowCustom && this.customModelModes.has("qa");
    const checkedLocalSelector = buildModelSelectorState(current, selectableLocalModels);
    const selector = provider === "ollama"
      ? custom
        ? { optionValue: "__custom__", useCustom: true, stale: false, customValue: current }
        : !catalogChecked
          ? { optionValue: current || "__custom__", useCustom: !current, stale: false, customValue: current }
          : checkedLocalSelector.stale && matchingOllamaModel
            ? { ...checkedLocalSelector, optionValue: matchingOllamaModel.name, useCustom: false }
            : checkedLocalSelector
      : current
        ? {
          optionValue: known ? matchingOllamaModel?.name ?? current : "__stale__",
          useCustom: custom,
          stale: !known,
          customValue: current,
        }
        : {
          optionValue: custom ? "__custom__" : "__empty__",
          useCustom: custom,
          stale: false,
          customValue: "",
        };
    const options = models.reduce<Record<string, string>>((result, model) => {
      result[model.name] = provider === "ollama" ? localWritingModelOptionLabel(model) : model.name;
      return result;
    }, {});
    if (provider === "ollama" && !catalogChecked && current && !options[current]) options[current] = current;
    if (allowCustom) options.__custom__ = "Custom…";
    if (selector.stale && !options[selector.optionValue]) {
      options.__stale__ = provider === "ollama"
        ? `${current} (saved, unavailable for local answers)`
        : `${current} (saved, not installed)`;
    }
    if (!models.length && !selector.useCustom && !current) {
      options.__empty__ = isHostedApiProvider(provider) && !hostedCredentialReady
        ? "Add developer key first"
        : "Check setup to load models";
    }
    const credentialBlocked = isHostedApiProvider(provider) && !hostedCredentialReady;
    if (credentialBlocked) {
      for (const key of Object.keys(options)) delete options[key];
      options.__credential__ = "Add developer key first";
    }
    const showCustom = !credentialBlocked && (custom || (!current && selector.useCustom));
    selector.customValue = this.customModelDrafts.get(draftKey) ?? selector.customValue;
    const title = "Answer model";
    const catalogDescription = provider === "ollama"
      ? describeLocalCompletionCatalog(this.plugin.localAiState.models, catalogChecked)
      : "";
    const catalogHint = catalogDescription ? ` ${catalogDescription}` : "";
    const verificationHint = selector.stale && provider !== "ollama"
      ? " The saved model is not in the latest catalog; press Check setup to verify it."
      : "";
    const setting = new Setting(container)
      .setName(title)
      .setDesc(provider === "ollama-cloud"
        ? `Choose a Cloud model exposed by the signed-in local Ollama app. Answers run on Ollama Cloud only after per-request approval.${verificationHint}`
        : provider === "ollama"
          ? `Choose the local Ollama model used to answer read-only @ questions. qwen3:4b-instruct is the default.${catalogHint}${verificationHint}`
          : !hostedCredentialReady
            ? "Add a developer API key first. Then Check setup will load the models available to that key."
            : `Choose the provider model used after per-request approval.${verificationHint}`)
      .addDropdown((dropdown) => {
        dropdown.addOptions(options);
        if (provider === "ollama") disableUnavailableLocalModelOptions(dropdown.selectEl, models);
        dropdown.setValue(credentialBlocked ? "__credential__" : showCustom ? "__custom__" : selector.optionValue)
          .setDisabled(aiSetupBusy || (isHostedApiProvider(provider) && !hostedCredentialReady));
        dropdown.onChange(async (value) => {
          if (this.plugin.settings.aiProvider !== provider) return;
          if (value === "__empty__" || value === "__credential__") return;
          if (value === "__custom__" || value === "__stale__") {
            this.customModelModes.add("qa");
            if (value === "__custom__") {
              new Notice("Enter the exact model id, then run check setup to verify it.");
            }
            this.rerenderLocalAiSection();
            return;
          }
          this.customModelModes.delete("qa");
          this.customModelDrafts.delete(draftKey);
          await this.saveAnswerModel(provider, value);
        });
      });
    if (showCustom) {
      let draft = selector.customValue;
      setting.addText((text) => {
        text
          .setPlaceholder("Exact provider model id")
          .setValue(selector.customValue)
          .setDisabled(aiSetupBusy)
          .onChange((value) => {
            draft = value.trim();
            this.customModelDrafts.set(draftKey, value);
          });
      });
      setting.addButton((button) => button
        .setButtonText("Save model")
        .setDisabled(aiSetupBusy)
        .onClick(async () => {
          if (this.plugin.settings.aiProvider !== provider) return;
          if (!draft.trim()) {
            new Notice("Enter the exact model id first.");
            return;
          }
          await this.saveAnswerModel(provider, draft, "Custom model id saved. Run Check setup to verify it is installed.");
          if (this.plugin.settings.aiProvider === provider) this.customModelModes.add("qa");
        }));
    }
    setting.settingEl.addClass("omd-settings-model", "omd-settings-answer-model");
    if (provider === "ollama") this.modelReadinessRail(container, "Answer model", qaWorkflow, selector.stale);
  }

  private async saveAnswerModel(provider: StoredAiProvider, value: string, notice?: string): Promise<boolean> {
    if (this.plugin.settings.aiProvider !== provider) return false;
    const model = value.trim();
    this.plugin.settings.aiModel = model;
    this.plugin.settings.aiModels[provider] = model;
    this.plugin.invalidateLocalAiState("answer-model");
    this.rerenderLocalAiSection();
    await this.saveSettingsInOrder();
    if (notice) new Notice(notice);
    return true;
  }

  private answerProviderStatusSetting(container: HTMLElement, provider: StoredAiProvider): void {
    const hostedState = isHostedApiProvider(provider) && this.plugin.hostedAiState?.provider === provider
      ? this.plugin.hostedAiState
      : null;
    const activeAction = hostedState?.activeAction || this.plugin.localAiState.activeAction;
    const aiSetupBusy = this.plugin.aiSetupBusy();
    const detail = hostedState?.detail
      ?? (provider === "ollama-cloud"
        ? "Check the signed-in local Ollama app and selected Cloud model."
        : this.plugin.localAiState.daemonDetail);
    const status = new Setting(container)
      .setName("Answer setup")
      .setDesc(isCloudAiProvider(provider)
        ? `${detail} Check setup verifies access and model availability without sending vault content.`
        : detail);
    const canOpenOllama = (provider === "ollama" || provider === "ollama-cloud")
      && canOpenOllamaDesktopApp()
      && this.plugin.localAiState.daemonCode === "daemon_unreachable";
    if (canOpenOllama) {
      status.addButton((button) => button.setButtonText("Open Ollama app").setCta().onClick(async () => {
        await this.plugin.openOllamaApp();
        if (container.isConnected) this.rerenderLocalAiSection();
      }));
    }
    status.addButton((button) => button
      .setButtonText(activeAction === "check-connection" ? "Checking…" : "Check setup")
      .setDisabled(aiSetupBusy)
      .onClick(async () => {
        await this.runAiSetupAction(async () => {
          if (provider === "ollama") return await this.plugin.checkLocalAiConnection();
          if (provider === "ollama-cloud") return await this.plugin.checkOllamaCloudConnection();
          return await this.plugin.checkHostedAiConnection();
        });
      }));
  }

  private modelReadinessRail(
    container: HTMLElement,
    name: string,
    state: Pick<LocalAiWorkflowDisplayState, "code" | "detail">,
    savedUnavailable = false,
  ): void {
    const ready = !savedUnavailable && state.code === "ready";
    const checking = !savedUnavailable && state.code === "checking";
    const neutral = !savedUnavailable && state.code === "unchecked";
    const status = new Setting(container)
      .setName(savedUnavailable
        ? `${name} needs attention`
        : ready
          ? `${name} available`
          : checking
            ? `Checking ${name.toLowerCase()}`
            : neutral
              ? `Verify ${name.toLowerCase()}`
              : `${name} needs attention`)
      .setDesc(savedUnavailable
        ? "The saved model is not available for this local workflow. Choose another downloaded model or run Check setup to refresh the catalog."
        : state.detail);
    status.settingEl.addClass(
      "omd-settings-model-status",
      ready ? "is-ready" : checking ? "is-checking" : neutral ? "is-neutral" : "is-unavailable",
    );
  }

  private settingsDisclosure(container: HTMLElement, label: string, description: string): HTMLDetailsElement {
    const details = container.createEl("details", { cls: "omd-settings-advanced" });
    details.createEl("summary", { text: label });
    details.createEl("p", { text: description });
    return details;
  }

  private renderOmdSetup(container: HTMLElement): void {
    const capability = this.plugin.enrichmentCapability;
    const automatic = this.plugin.usesAutomaticOmdDiscovery();
    const instructions = omdInstallInstructions(process.platform);
    const setting = new Setting(container)
      .setName(omdStatusTitle(capability.status, capability.code, capability.mode))
      .setDesc(capability.message);
    setting.settingEl.addClass("omd-settings-omd-status");
    setting.settingEl.addClass(`is-${capability.status}`);

    if (!automatic && capability.status === "unavailable") {
      setting.addButton((button) => button
        .setButtonText("Use automatic")
        .setCta()
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Detecting...");
          const ready = await this.plugin.useAutomaticOmdDiscovery();
          new Notice(ready ? "OMD was found automatically." : this.plugin.enrichmentCapability.message);
          this.display();
        }));
    }
    if (capability.status === "unavailable" && capability.code === "missing_executable") {
      setting.addButton((button) => {
        button.setButtonText(instructions.buttonLabel);
        if (automatic) button.setCta();
        button.onClick(async () => {
          await this.plugin.copyOmdInstallInstructions();
        });
      });
    }
    if (capability.status === "unavailable") {
      setting.addButton((button) => button
        .setButtonText(capability.code === "missing_executable" ? "Install guide" : "Update guide")
        .onClick(() => this.plugin.openOmdInstallGuide()));
    }
    setting.addButton((button) => button
      .setButtonText(capability.status === "checking"
        ? "Detecting..."
        : capability.status === "unchecked" ? "Detect OMD" : "Check again")
      .setDisabled(capability.status === "checking")
      .onClick(async () => {
        button.setDisabled(true).setButtonText("Detecting...");
        const ready = await this.plugin.checkEnrichmentCapability(true);
        new Notice(ready ? "OMD is ready." : this.plugin.enrichmentCapability.message);
        this.display();
      }));

    const recognition = container.createEl("details", { cls: "omd-settings-advanced" });
    recognition.createEl("summary", { text: "Recognition defaults" });
    const languageAvailability = this.plugin.captureLanguageAvailability();
    const recognitionReady = languageAvailability.status === "supported";
    recognition.createEl("p", {
      text: recognitionReady
        ? `Vault defaults for new image, audio, and video captures. Recognition only; OMD does not translate the captured text. A language selected while capturing applies only to that item; a retry repeats it. ${languageAvailability.message}`
        : `Vault defaults for new image, audio, and video captures. Recognition only; OMD does not translate the captured text. Language preferences remain off until a compatible local converter is detected. ${languageAvailability.message}`,
    });
    const savedOcrLanguage = this.plugin.settings.captureOcrLanguage;
    const readyOcrPresets = languageAvailability.ocrPresets.filter((preset) => (
      languageAvailability.ocrBackendAvailable !== false
      && missingInstalledOcrPacks(preset.value, languageAvailability.ocrInstalledPacks).length === 0
    ));
    const savedIsPreset = OCR_LANGUAGE_PRESETS.includes(savedOcrLanguage as typeof OCR_LANGUAGE_PRESETS[number]);
    const savedOcrSupported = !savedOcrLanguage
      || (savedIsPreset
        ? languageAvailability.ocrPresets.some((preset) => preset.value === savedOcrLanguage)
        : languageAvailability.customOcr);
    const savedOcrReady = savedOcrSupported
      && languageAvailability.ocrBackendAvailable !== false
      && missingInstalledOcrPacks(savedOcrLanguage, languageAvailability.ocrInstalledPacks).length === 0;
    const ocrSetting = new Setting(recognition)
      .setName("Image text language")
      .setDesc(savedOcrLanguage && (!recognitionReady || !savedOcrReady)
        ? "The saved image text preference is unavailable in the detected converter. Choose an installed language or clear the preference."
        : "Default for new image captures. Choose a language only when image text is recognized incorrectly.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "No language preference");
        if (recognitionReady) {
          for (const preset of readyOcrPresets) {
            dropdown.addOption(preset.value, preset.label);
          }
        }
        const savedCustom = savedOcrLanguage && !savedIsPreset;
        if (recognitionReady && savedOcrReady && savedCustom) {
          dropdown.addOption(savedOcrLanguage, `Custom: ${savedOcrLanguage}`);
        }
        if (savedOcrLanguage && (!recognitionReady || !savedOcrReady)) {
          dropdown.addOption(savedOcrLanguage, `${savedOcrLanguage} (saved, unavailable)`);
          const unavailable = Array.from(dropdown.selectEl.options).find((option) => option.value === savedOcrLanguage);
          if (unavailable) unavailable.disabled = true;
        }
        dropdown
          .setValue(savedOcrLanguage)
          .setDisabled(!recognitionReady || (readyOcrPresets.length === 0 && !savedCustom))
          .onChange(async (value) => {
          this.plugin.settings.captureOcrLanguage = value;
          await this.saveSettingsInOrder();
          });
      });
    if ((!recognitionReady || !savedOcrReady) && savedOcrLanguage) {
      ocrSetting.addButton((button) => button.setButtonText("Clear preference").onClick(async () => {
        this.plugin.settings.captureOcrLanguage = "";
        await this.saveSettingsInOrder();
        this.display();
      }));
    }
    if (recognitionReady && languageAvailability.customOcr && languageAvailability.ocrBackendAvailable !== false) {
      const presetValues = languageAvailability.ocrPresets.map((preset) => preset.value);
      const customValue = presetValues.includes(savedOcrLanguage as typeof presetValues[number]) ? "" : savedOcrLanguage;
      new Setting(recognition)
        .setName("Custom image text language")
        .setDesc(CUSTOM_OCR_DEFAULT_DESCRIPTION)
        .addText((text) => {
          text.setPlaceholder("Example: deu+eng").setValue(customValue);
          text.inputEl.addEventListener("change", () => {
            const value = text.getValue().trim() ? normalizeOcrLanguageSet(text.getValue()) : "";
            if (value === null) {
              new Notice(INVALID_CUSTOM_OCR_NOTICE);
              return;
            }
            const missingPacks = missingInstalledOcrPacks(value, languageAvailability.ocrInstalledPacks);
            if (missingPacks.length) {
              new Notice(`Missing installed Tesseract language packs: ${missingPacks.join(", ")}. Install them, then retry.`);
              return;
            }
            this.plugin.settings.captureOcrLanguage = value;
            void this.saveSettingsInOrder().then(() => this.display());
          });
        });
    }
    const savedAsrLanguage = this.plugin.settings.captureAsrLanguage;
    const savedAsrReady = savedAsrLanguage === "inherit-adapter-default"
      || (recognitionReady && (savedAsrLanguage === "auto-detect"
        ? languageAvailability.asrAutoDetect : languageAvailability.asrExplicit));
    const asrSetting = new Setting(recognition)
      .setName("Speech language")
      .setDesc(savedAsrReady
        ? "Default for new audio and video captures. Choose auto-detect when the recording's language is unknown."
        : "The saved speech preference is unavailable in the detected converter. Choose a supported language or clear the preference.")
      .addDropdown((dropdown) => {
        dropdown.addOption("inherit-adapter-default", "No language preference");
        if (recognitionReady && languageAvailability.asrAutoDetect) {
          dropdown.addOption("auto-detect", "Auto-detect speech");
        }
        if (recognitionReady && languageAvailability.asrExplicit) {
          dropdown.addOption("en", "English").addOption("zh", "Chinese");
        }
        if (!savedAsrReady) {
          const label = savedAsrLanguage === "auto-detect" ? "Auto-detect speech" : savedAsrLanguage === "zh" ? "Chinese" : "English";
          dropdown.addOption(savedAsrLanguage, `${label} (saved, unavailable)`);
          const unavailable = Array.from(dropdown.selectEl.options).find((option) => option.value === savedAsrLanguage);
          if (unavailable) unavailable.disabled = true;
        }
        dropdown
          .setValue(savedAsrLanguage)
          .setDisabled(!recognitionReady)
          .onChange(async (value) => {
          this.plugin.settings.captureAsrLanguage = normalizeCaptureAsrLanguage(value);
          await this.saveSettingsInOrder();
          });
      });
    if (!savedAsrReady) {
      asrSetting.addButton((button) => button.setButtonText("Clear preference").onClick(async () => {
        this.plugin.settings.captureAsrLanguage = "inherit-adapter-default";
        await this.saveSettingsInOrder();
        this.display();
      }));
    }

    const advanced = container.createEl("details", { cls: "omd-settings-advanced" });
    advanced.open = !automatic
      || Boolean(this.plugin.settings.pythonExecutable)
      || Boolean(this.plugin.settings.pythonBridgePath);
    advanced.createEl("summary", { text: "Advanced OMD paths" });
    advanced.createEl("p", {
      text: "Leave these blank for automatic setup. Use an override only when OMD Home cannot reach the correct local environment.",
    });

    let executableOverrideChanged = false;
    const executableSetting = new Setting(advanced)
      .setName("OMD executable override")
      .setDesc("Leave blank to scan the app path and common package manager, environment, and user install locations.")
      .addText((text) => {
        text
          .setPlaceholder("Automatic discovery")
          .setValue(isAutomaticOmdExecutable(this.plugin.settings.omdExecutable) ? "" : this.plugin.settings.omdExecutable)
          .onChange(async (value) => {
            const executable = value.trim() || DEFAULT_SETTINGS.omdExecutable;
            if (executable === this.plugin.settings.omdExecutable) return;
            executableOverrideChanged = true;
            this.plugin.settings.omdExecutable = executable;
            this.plugin.resetEnrichmentCapability();
            setting
              .setName("OMD check needed")
              .setDesc("The executable override changed. OMD Home will validate it when you leave the field.");
            setting.settingEl.removeClass("is-ready", "is-unavailable", "is-checking");
            setting.settingEl.addClass("is-unchecked");
            await this.saveSettingsInOrder();
          });
        text.inputEl.addEventListener("blur", () => {
          if (!executableOverrideChanged) return;
          executableOverrideChanged = false;
          void this.plugin.checkEnrichmentCapability(true).finally(() => {
            if (container.isConnected) this.display();
          });
        });
      });
    if (!automatic) {
      executableSetting.addButton((button) => button
        .setButtonText("Use automatic")
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Detecting...");
          const ready = await this.plugin.useAutomaticOmdDiscovery();
          new Notice(ready ? "OMD was found automatically." : this.plugin.enrichmentCapability.message);
          this.display();
        }));
    }

    new Setting(advanced)
      .setName("Python executable override")
      .setDesc("Leave blank for automatic detection from the OMD environment. Advanced users can provide an exact interpreter path.")
      .addText((text) => text
        .setPlaceholder("Automatic from OMD")
        .setValue(this.plugin.settings.pythonExecutable)
        .onChange(async (value) => {
          this.plugin.settings.pythonExecutable = value.trim();
          await this.saveSettingsInOrder();
        }));

    const pythonBridgeSetting = new Setting(advanced)
      .setName("OMD Home bridge override")
      .setDesc(
        this.plugin.settings.pythonBridgePath
          ? "Using a custom Python bridge path. Clear it to use the bridge bundled inside OMD Home."
          : "Using the bridge bundled inside OMD Home automatically. No bridge path is required.",
      )
      .addText((text) => text
        .setPlaceholder("Bundled bridge")
        .setValue(this.plugin.settings.pythonBridgePath)
        .onChange(async (value) => {
          this.plugin.settings.pythonBridgePath = value.trim();
          await this.saveSettingsInOrder();
        }));
    if (this.plugin.settings.pythonBridgePath) {
      pythonBridgeSetting.addButton((button) => button
        .setButtonText("Use bundled")
        .onClick(async () => {
          this.plugin.settings.pythonBridgePath = "";
          await this.saveSettingsInOrder();
          this.display();
        }));
    }

    if (capability.status === "unchecked" || capability.status === "checking") {
      void this.plugin.checkEnrichmentCapability().finally(() => {
        if (container.isConnected) this.display();
      });
    }
  }

  private modelSetting(
    container: HTMLElement,
    name: string,
    description: string,
    key: "localWritingModel",
    workflow: LocalAiWorkflowId,
  ): void {
    const draftKey = `writing:${workflow}`;
    const aiSetupBusy = this.plugin.aiSetupBusy();
    const workflowState = this.plugin.localAiState.workflows[workflow];
    const catalogChecked = typeof this.plugin.localAiState.catalogCheckedAt === "number";
    const localModels = this.plugin.localAiState.models
      .filter((model) => !modelIsCloudBacked(model));
    const selectableModels = localModels.filter(localWritingModelIsSelectable);
    const selector = this.customModelModes.has(workflow)
      ? {
        optionValue: "__custom__",
        useCustom: true,
        stale: false,
        customValue: selectableModels.some((model) => localModelNamesMatch(model.name, this.plugin.settings[key])) ? "" : this.plugin.settings[key],
      }
      : !catalogChecked
        ? {
          optionValue: this.plugin.settings[key] || "__custom__",
          useCustom: !this.plugin.settings[key],
          stale: false,
          customValue: this.plugin.settings[key],
        }
        : (() => {
          const checked = buildModelSelectorState(this.plugin.settings[key], selectableModels);
          const matchingLocalModel = localModels.find((model) => localModelNamesMatch(model.name, this.plugin.settings[key]));
          return checked.stale && matchingLocalModel
            ? { ...checked, optionValue: matchingLocalModel.name, useCustom: false }
            : checked;
        })();
    selector.customValue = this.customModelDrafts.get(draftKey) ?? selector.customValue;
    const options = localModels
      .reduce<Record<string, string>>((result, model) => {
        result[model.name] = localWritingModelOptionLabel(model);
        return result;
      }, {});
    if (!catalogChecked && this.plugin.settings[key] && !options[this.plugin.settings[key]]) {
      options[this.plugin.settings[key]] = this.plugin.settings[key];
    }
    options.__custom__ = "Custom…";
    if (selector.stale && !options[selector.optionValue]) {
      options.__stale__ = `${this.plugin.settings[key]} (saved, unavailable for local writing)`;
    }
    const catalogDescription = describeLocalCompletionCatalog(this.plugin.localAiState.models, catalogChecked);
    const catalogHint = catalogDescription ? ` ${catalogDescription}` : "";
    const setting = new Setting(container)
      .setName(name)
      .setDesc(`${description}${catalogHint}`)
      .addDropdown((dropdown) => {
        dropdown.addOptions(options);
        disableUnavailableLocalModelOptions(dropdown.selectEl, localModels);
        dropdown.setValue(selector.optionValue).setDisabled(aiSetupBusy);
        dropdown.onChange(async (value) => {
          if (value === "__custom__" || value === "__stale__") {
            this.customModelModes.add(workflow);
            this.rerenderLocalAiSection();
            return;
          }
          this.customModelModes.delete(workflow);
          this.customModelDrafts.delete(draftKey);
          this.plugin.settings[key] = value;
          this.plugin.invalidateLocalAiState("model");
          await this.saveSettingsInOrder();
          this.rerenderLocalAiSection();
        });
    });
    if (selector.useCustom) {
      let draft = selector.customValue;
      setting.addText((text) => {
        text.setPlaceholder("Custom Ollama model id");
        text.setValue(selector.customValue).setDisabled(aiSetupBusy);
        text.onChange((value) => {
          draft = value.trim();
          this.customModelDrafts.set(draftKey, value);
        });
      });
      setting.addButton((button) => button
        .setButtonText("Save model")
        .setDisabled(aiSetupBusy)
        .onClick(async () => {
          if (!draft.trim()) {
            new Notice("Enter a custom model id first.");
            return;
          }
          this.customModelModes.add(workflow);
          await this.saveModelValue(key, draft);
          new Notice(`Saved ${name.toLowerCase()}. Press Check setup to verify it.`);
          if (container.isConnected) this.rerenderLocalAiSection();
        }));
    }
    setting.settingEl.addClass("omd-settings-model");
    this.modelReadinessRail(container, name, workflowState, selector.stale);
  }

  private async saveModelValue(
    key: "localWritingModel",
    value: string,
  ): Promise<void> {
    this.plugin.settings[key] = value.trim();
    this.plugin.invalidateLocalAiState("model");
    await this.saveSettingsInOrder();
  }

  private hybridRetrievalSetting(container: HTMLElement): void {
    const aiSetupBusy = this.plugin.aiSetupBusy();
    new Setting(container)
      .setName("Keyword + semantic search")
      .setDesc("Combine keyword matches with related meanings using a local embedding model. Turn off to use keyword search only.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.hybridRetrievalEnabled)
        .setDisabled(aiSetupBusy)
        .onChange(async (value) => {
          this.plugin.settings.hybridRetrievalEnabled = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.saveSettingsInOrder();
          this.rerenderLocalAiSection();
        }));
  }

  private embeddingModelSetting(container: HTMLElement): void {
    const aiSetupBusy = this.plugin.aiSetupBusy();
    const catalogChecked = typeof this.plugin.localAiState.catalogCheckedAt === "number";
    const savedModel = this.plugin.settings.embeddingModel.trim();
    const catalogModel = this.plugin.localAiState.models.find((model) => localModelNamesMatch(model.name, savedModel));
    const embeddingModels = this.plugin.localAiState.models
      .filter((model) => modelSupportsEmbedding(model) && !modelIsCloudBacked(model));
    const options = embeddingModels.reduce<Record<string, string>>((result, model) => {
      result[model.name] = model.name;
      return result;
    }, {});
    const savedMissing = catalogChecked && Boolean(savedModel) && !catalogModel;
    const savedRemote = catalogChecked && Boolean(catalogModel) && modelIsCloudBacked(catalogModel!);
    const savedUnsupported = catalogChecked && Boolean(catalogModel)
      && !savedRemote
      && !modelSupportsEmbedding(catalogModel!);
    const savedUnavailable = savedMissing || savedRemote || savedUnsupported;
    const savedUnavailableLabel = savedRemote
      ? `${savedModel} (cloud-backed; unavailable for local retrieval)`
      : savedUnsupported
        ? `${savedModel} (does not support embeddings)`
        : `${savedModel} (saved, not installed)`;
    if (savedUnavailable) {
      options.__saved__ = savedUnavailableLabel;
    } else if (!catalogChecked && savedModel && !options[savedModel]) {
      options[savedModel] = savedModel;
    }
    const selected = !savedUnavailable && catalogModel
      ? catalogModel.name
      : options[savedModel] ? savedModel : "__saved__";
    const setting = new Setting(container)
      .setName("Embedding model")
      .setDesc(!catalogChecked
        ? "Adds semantic search and optional reranking to keyword search. Run Check setup to load installed models."
        : savedUnavailable
          ? savedMissing
            ? "The saved embedding model is not installed. Keyword search still works; OMD Home will not download or switch models automatically."
            : savedRemote
              ? "The saved model is cloud-backed and cannot be used for local Vault retrieval."
              : "The saved model is installed but does not advertise embedding support."
          : "Adds semantic search and optional reranking to keyword search during vault questions.")
      .addDropdown((dropdown) => {
        if (!Object.keys(options).length) dropdown.addOption("__saved__", this.plugin.settings.embeddingModel || "No local embedding model found");
        else dropdown.addOptions(options);
        dropdown.setValue(selected);
        dropdown.setDisabled(aiSetupBusy);
        dropdown.onChange(async (value) => {
          if (value === "__saved__") return;
          this.plugin.settings.embeddingModel = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.saveSettingsInOrder();
          this.rerenderLocalAiSection();
        });
      })
      .addButton((button) => button
        .setButtonText(this.plugin.localAiState.activeAction === "test-embeddings" ? "Testing…" : "Test embeddings")
        .setDisabled(aiSetupBusy || !this.plugin.settings.embeddingModel.trim())
        .onClick(async () => {
          await this.runAiSetupAction(() => this.plugin.testLocalEmbeddings());
        }));
    const installableModel = savedMissing ? oneClickInstallableEmbeddingModel(savedModel) : null;
    if (installableModel) {
      setting.addButton((button) => button
        .setButtonText(this.plugin.localAiState.activeAction === "install-embedding" ? "Installing…" : "Install model")
        .setDisabled(aiSetupBusy)
        .onClick(async () => {
          await this.runAiSetupAction(() => this.plugin.installEmbeddingModel(installableModel));
        }));
    }
    setting.settingEl.addClass("omd-settings-model");
    const embeddingStatus = new Setting(container)
      .setName(!catalogChecked
        ? "Verify embedding model"
        : savedUnavailable
          ? "Embedding model needs attention"
          : "Embedding model installed")
      .setDesc(!catalogChecked
        ? "Run Check setup to load the local model catalog, then run Test embeddings."
        : savedUnavailable
        ? savedMissing
          ? installableModel
            ? `The saved model is not installed. Install ${installableModel} through the local Ollama service, or choose another installed embedding model. Download size and time depend on the model.`
            : "The saved model is not installed. Install it manually in Ollama or choose another installed embedding model."
          : savedRemote
            ? "Choose a locally installed embedding model. Cloud-backed models are never used for Vault retrieval."
            : "Choose a model that supports embeddings, then run Test embeddings."
        : "Installed locally and available for keyword + semantic search. Run Test embeddings to verify it before relying on semantic reranking.");
    embeddingStatus.settingEl.addClass(
      "omd-settings-model-status",
      !catalogChecked ? "is-neutral" : savedUnavailable ? "is-unavailable" : "is-ready",
    );
    setting.settingEl.addClass("omd-settings-embedding-model");
  }
}

function omdStatusTitle(
  status: OmdHomePlugin["enrichmentCapability"]["status"],
  code?: OmdHomePlugin["enrichmentCapability"]["code"],
  mode?: OmdHomePlugin["enrichmentCapability"]["mode"],
): string {
  if (status === "checking") return "Detecting OMD";
  if (status === "ready") return "OMD ready";
  if (status === "unavailable" && code === "missing_executable" && mode === "custom") {
    return "Custom OMD path not found";
  }
  if (status === "unavailable" && code === "missing_executable") return "OMD not installed";
  if (status === "unavailable" && (code === "unsupported_capability" || code === "unsupported_schema")) {
    return "OMD update required";
  }
  if (status === "unavailable") return "OMD needs attention";
  return "OMD converter";
}

export function normalizeOmdHomeSettings(raw: unknown): OmdHomeSettings {
  const input = raw && typeof raw === "object"
    ? raw as Partial<OmdHomeSettings>
    : {};
  const legacyInput = Object.fromEntries(Object.entries(input));
  const aiProviderValue = input.aiProvider;
  const aiProvider = isStoredAiProvider(aiProviderValue) ? aiProviderValue : DEFAULT_SETTINGS.aiProvider;
  const legacyAiModel = typeof input.aiModel === "string"
    ? input.aiModel.trim()
    : aiProvider === "ollama" ? DEFAULT_SETTINGS.aiModel : "";
  const aiModels = normalizeAiModelMemory(input.aiModels, aiProvider, legacyAiModel);
  const allowedCloudAnswerProviders = typeof (input as { allowCloudVaultAnswers?: unknown }).allowCloudVaultAnswers === "boolean"
    ? (input as { allowCloudVaultAnswers?: boolean }).allowCloudVaultAnswers && isCloudAiProvider(aiProvider) ? [aiProvider] : []
    : uniqueStrings((input as { allowedCloudAnswerProviders?: unknown }).allowedCloudAnswerProviders)
      .filter(isStoredAiProvider)
      .filter(isCloudAiProvider);
  const legacyWritingModel = typeof legacyInput.enrichmentModel === "string" && legacyInput.enrichmentModel.trim()
    ? legacyInput.enrichmentModel.trim()
    : typeof legacyInput.capturePolishModel === "string" && legacyInput.capturePolishModel.trim()
      ? legacyInput.capturePolishModel.trim()
      : "";
  return {
    openOnLaunch: typeof input.openOnLaunch === "boolean" ? input.openOnLaunch : DEFAULT_SETTINGS.openOnLaunch,
    omdExecutable: cleanString(input.omdExecutable, DEFAULT_SETTINGS.omdExecutable),
    pythonExecutable: cleanString(input.pythonExecutable, DEFAULT_SETTINGS.pythonExecutable),
    pythonBridgePath: cleanString(input.pythonBridgePath, DEFAULT_SETTINGS.pythonBridgePath),
    eventKitHelperPath: cleanString(input.eventKitHelperPath, DEFAULT_SETTINGS.eventKitHelperPath),
    selectedCalendarIds: uniqueStrings(input.selectedCalendarIds),
    defaultExternalCalendarId: cleanString(input.defaultExternalCalendarId, DEFAULT_SETTINGS.defaultExternalCalendarId),
    aiProvider,
    aiModel: aiModels[aiProvider],
    aiModels,
    allowedCloudAnswerProviders,
    hybridRetrievalEnabled: typeof input.hybridRetrievalEnabled === "boolean"
      ? input.hybridRetrievalEnabled
      : DEFAULT_SETTINGS.hybridRetrievalEnabled,
    embeddingModel: cleanString(input.embeddingModel, DEFAULT_SETTINGS.embeddingModel),
    semanticRerankEnabled: typeof input.semanticRerankEnabled === "boolean"
      ? input.semanticRerankEnabled
      : DEFAULT_SETTINGS.semanticRerankEnabled,
    localWritingModel: cleanString(input.localWritingModel, legacyWritingModel || DEFAULT_SETTINGS.localWritingModel)
      || DEFAULT_SETTINGS.localWritingModel,
    ollamaHost: cleanString(input.ollamaHost, DEFAULT_SETTINGS.ollamaHost),
    capturePolish: typeof input.capturePolish === "boolean" ? input.capturePolish : DEFAULT_SETTINGS.capturePolish,
    captureSuggestLinksAndTags: typeof input.captureSuggestLinksAndTags === "boolean"
      ? input.captureSuggestLinksAndTags
      : DEFAULT_SETTINGS.captureSuggestLinksAndTags,
    captureOcrLanguage: normalizeCaptureOcrLanguage(input.captureOcrLanguage),
    captureAsrLanguage: normalizeCaptureAsrLanguage(input.captureAsrLanguage),
    pinnedNotes: uniqueStrings(input.pinnedNotes),
  };
}

export function reconcileCalendarSelection(
  settings: OmdHomeSettings,
  calendars: ExternalCalendarDescriptor[],
): OmdHomeSettings {
  if (!calendars.length) return settings;
  const knownCalendarIds = new Set(calendars.map((calendar) => calendar.id));
  const selectedCalendarIds = settings.selectedCalendarIds.filter((id) => knownCalendarIds.has(id));
  return {
    ...settings,
    selectedCalendarIds,
    defaultExternalCalendarId: normalizeDefaultExternalCalendarId(
      settings.defaultExternalCalendarId,
      calendars,
      selectedCalendarIds,
    ),
  };
}

export function normalizeDefaultExternalCalendarId(
  defaultCalendarId: string,
  calendars: ExternalCalendarDescriptor[],
  selectedCalendarIds: string[],
): string {
  if (!defaultCalendarId) return "";
  const calendar = calendars.find((entry) => entry.id === defaultCalendarId);
  if (!calendar?.allowsModifications) return "";
  return selectedCalendarIds.includes(defaultCalendarId) ? defaultCalendarId : "";
}

function cleanString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))];
}

function normalizeCaptureOcrLanguage(value: unknown): string {
  return typeof value === "string" ? normalizeOcrLanguageSet(value) ?? "" : "";
}

function normalizeCaptureAsrLanguage(value: unknown): OmdHomeSettings["captureAsrLanguage"] {
  return value === "auto-detect" || value === "en" || value === "zh"
    ? value
    : "inherit-adapter-default";
}
