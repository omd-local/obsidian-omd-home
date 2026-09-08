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
  localWritingModelIsSelectable,
  localWritingModelOptionLabel,
  modelSupportsEmbedding,
  normalizeLocalOllamaHost,
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
  private readonly hostedCredentialDrafts = new Map<HostedAiProvider, string>();
  private localAiAdvancedExpanded = false;

  constructor(app: App, plugin: OmdHomePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Startup").setHeading();

    new Setting(containerEl)
      .setName("Open home on launch")
      .setDesc("Open once when Obsidian starts without closing restored tabs.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.openOnLaunch).onChange(async (value) => {
        this.plugin.settings.openOnLaunch = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("OMD").setHeading();
    this.renderOmdSetup(containerEl);

    const localAiSection = containerEl.createDiv({ cls: "omd-settings-section omd-settings-local-ai" });
    this.renderLocalAiSection(localAiSection);

    const calendarSection = containerEl.createDiv({ cls: "omd-settings-section omd-settings-calendar" });
    this.renderCalendarSection(calendarSection);
  }

  private renderCalendarSection(container: HTMLElement): void {
    container.empty();
    new Setting(container).setName("Calendar").setHeading();
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
      void this.plugin.saveSettings();
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
            await this.plugin.saveSettings();
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
          await this.plugin.saveSettings();
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
          await this.plugin.saveSettings();
        }));
    if (this.plugin.settings.eventKitHelperPath) {
      helperSetting.addButton((button) => button
        .setButtonText("Use bundled")
        .onClick(async () => {
          this.plugin.settings.eventKitHelperPath = "";
          await this.plugin.saveSettings();
          if (container.isConnected) this.renderCalendarSection(container);
        }));
    }
  }

  private renderLocalAiSection(container: HTMLElement): void {
    container.empty();
    new Setting(container).setName("AI answers").setHeading();

    const provider = this.plugin.settings.aiProvider;
    const aiSetupBusy = this.plugin.aiSetupBusy();
    new Setting(container)
      .setName("Answer provider")
      .setDesc(`Choose where @ questions are answered. ${providerSetupDescription(provider)}`)
      .addDropdown((dropdown) => {
        for (const value of AI_PROVIDER_VALUES) dropdown.addOption(value, aiProviderLabel(value));
        dropdown.setValue(provider).setDisabled(aiSetupBusy).onChange(async (value) => {
          if (!isStoredAiProvider(value)) return;
          this.plugin.settings.aiModels[provider] = this.plugin.settings.aiModel.trim();
          this.plugin.settings.aiProvider = value;
          this.plugin.settings.aiModel = this.plugin.settings.aiModels[value];
          this.customModelModes.delete("qa");
          this.plugin.invalidateLocalAiState("provider");
          await this.plugin.saveSettings();
          this.rerenderLocalAiSection();
        });
      });

    if (isCloudAiProvider(provider)) {
      const permission = new Setting(container)
        .setName(`Allow ${aiProviderLabel(provider)} answers`)
        .setDesc(`Allow @ answers to use ${aiProviderDestination(provider)} only while ${aiProviderLabel(provider)} is selected. Before every request, OMD Home shows the destination, model, and bounded evidence excerpts and asks you to approve sending them.`)
        .addToggle((toggle) => toggle
          .setValue(this.plugin.settings.allowedCloudAnswerProviders.includes(provider))
          .setDisabled(aiSetupBusy)
          .onChange(async (enabled) => {
            const allowed = new Set(this.plugin.settings.allowedCloudAnswerProviders.filter(isCloudAiProvider));
            enabled ? allowed.add(provider) : allowed.delete(provider);
            this.plugin.settings.allowedCloudAnswerProviders = [...allowed];
            this.plugin.invalidateCloudAnswerConsent();
            await this.plugin.saveSettings();
            new Notice(enabled
              ? `${aiProviderLabel(provider)} answers allowed. OMD Home will still ask before every request.`
              : `${aiProviderLabel(provider)} answers disabled. No new vault evidence will be sent to this provider.`);
            this.rerenderLocalAiSection();
          }));
      if (provider === "ollama-cloud") {
        permission.addButton((button) => button
          .setButtonText("Setup guide")
          .onClick(() => this.plugin.openCloudAiGuide()));
      }
      permission.settingEl.addClass("omd-settings-cloud-permission");
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
    new Setting(advanced).setName("Vault retrieval").setHeading();
    this.hybridRetrievalSetting(advanced);
    this.embeddingModelSetting(advanced);
    new Setting(advanced)
      .setName("Semantic rerank")
      .setDesc("Reorder selected evidence with the local embedding model. Sparse order is kept if reranking fails.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.semanticRerankEnabled)
        .setDisabled(aiSetupBusy || !this.plugin.settings.hybridRetrievalEnabled)
        .onChange(async (value) => {
          this.plugin.settings.semanticRerankEnabled = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.plugin.saveSettings();
        }));

    new Setting(advanced)
      .setName("Local writing tools")
      .setDesc("The capture dialog turns optional writing actions on or off. Choose the loopback Ollama model they share here. These actions never use the cloud answer provider.")
      .setHeading();
    this.modelSetting(
      advanced,
      "Local writing model",
      "Used by optional Markdown polish and review-first link and tag proposals.",
      "localWritingModel",
      "enrichment",
    );
    new Setting(advanced).setName("Ollama troubleshooting").setHeading();
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
            validation?.empty();
            return true;
          } catch {
            endpoint.settingEl.addClass("is-invalid");
            validation?.setText("Use http://localhost:11434 or http://127.0.0.1:11434. The last valid endpoint remains saved.");
            return false;
          }
        };
        endpointValidation = updateValidation;
        text.setValue(this.plugin.settings.ollamaHost).setDisabled(aiSetupBusy).onChange(async (value) => {
          if (!updateValidation(value)) return;
          this.plugin.settings.ollamaHost = value.trim();
          this.plugin.invalidateLocalAiState("host");
          await this.plugin.saveSettings();
        });
      });
    validation = endpoint.settingEl.createDiv({ cls: "omd-settings-endpoint-validation" });
    endpoint.settingEl.addClass("omd-settings-endpoint");
    endpointValidation?.(this.plugin.settings.ollamaHost);
  }

  private rerenderLocalAiSection(): void {
    const section = this.containerEl.querySelector<HTMLElement>(".omd-settings-local-ai");
    if (section?.isConnected) this.renderLocalAiSection(section);
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
        ? `Using ${credential.envVar} from the OMD environment. Consumer subscriptions do not include API usage.`
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
      .setButtonText(state?.activeAction === "save-key" ? "Saving…" : "Save key")
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
      }));
    if (credential?.source === "keychain") {
      setting.addButton((button) => button
        .setButtonText("Remove key")
        .setWarning()
        .setDisabled(aiSetupBusy)
        .onClick(async () => {
          await this.runAiSetupAction(() => this.plugin.deleteHostedApiKey());
        }));
    }
    setting.settingEl.addClass("omd-settings-model", "omd-settings-secret");
  }

  private answerModelSetting(container: HTMLElement, provider: StoredAiProvider): void {
    const aiSetupBusy = this.plugin.aiSetupBusy();
    const qaWorkflow = this.plugin.localAiState.workflows.qa;
    const catalogChecked = typeof this.plugin.localAiState.catalogCheckedAt === "number";
    const localModels = this.plugin.localAiState.models.filter((model) => !modelIsCloudBacked(model));
    const selectableLocalModels = localModels.filter(localWritingModelIsSelectable);
    const models = provider === "ollama"
      ? localModels
      : provider === "ollama-cloud"
        ? this.plugin.localAiState.models.filter(modelIsCloudBacked)
        : this.plugin.hostedAiState?.provider === provider ? this.plugin.hostedAiState.models : [];
    const current = this.plugin.settings.aiModel.trim();
    const allowCustom = provider !== "ollama-cloud";
    const known = models.some((model) => model.name === current);
    const custom = allowCustom && this.customModelModes.has("qa");
    const checkedLocalSelector = buildModelSelectorState(current, selectableLocalModels);
    const selector = provider === "ollama"
      ? custom
        ? { optionValue: "__custom__", useCustom: true, stale: false, customValue: current }
        : !catalogChecked
          ? { optionValue: current || "__custom__", useCustom: !current, stale: false, customValue: current }
          : checkedLocalSelector.stale && models.some((model) => model.name === current)
            ? { ...checkedLocalSelector, optionValue: current, useCustom: false }
            : checkedLocalSelector
      : current
        ? {
          optionValue: known ? current : "__stale__",
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
    if (!models.length && !selector.useCustom && !current) options.__empty__ = "Check setup to load models";
    const showCustom = custom || (!current && selector.useCustom);
    const title = provider === "ollama" ? "Text completion model" : "Answer model";
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
          ? `Choose the local text completion model used for read-only @ questions. qwen3:4b-instruct is the default.${catalogHint}${verificationHint}`
          : `Choose the provider model used after per-request approval.${verificationHint}`)
      .addDropdown((dropdown) => {
        dropdown.addOptions(options);
        if (provider === "ollama") disableUnavailableLocalModelOptions(dropdown.selectEl, models);
        dropdown.setValue(showCustom ? "__custom__" : selector.optionValue).setDisabled(aiSetupBusy);
        dropdown.onChange(async (value) => {
          if (value === "__empty__") return;
          if (value === "__custom__" || value === "__stale__") {
            this.customModelModes.add("qa");
            if (value === "__custom__") {
              new Notice("Enter the exact model id, then run check setup to verify it.");
            }
            this.rerenderLocalAiSection();
            return;
          }
          this.customModelModes.delete("qa");
          await this.saveAnswerModel(provider, value);
          this.rerenderLocalAiSection();
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
          });
      });
      setting.addButton((button) => button
        .setButtonText("Save model")
        .setDisabled(aiSetupBusy)
        .onClick(async () => {
          if (!draft.trim()) {
            new Notice("Enter the exact model id first.");
            return;
          }
          await this.saveAnswerModel(provider, draft, "Custom model id saved. Run Check setup to verify it is installed.");
          this.customModelModes.add("qa");
          this.rerenderLocalAiSection();
        }));
    }
    setting.settingEl.addClass("omd-settings-model", "omd-settings-answer-model");
    if (provider === "ollama") this.modelReadinessRail(container, "Text completion model", qaWorkflow, selector.stale);
  }

  private async saveAnswerModel(provider: StoredAiProvider, value: string, notice?: string): Promise<void> {
    const model = value.trim();
    this.plugin.settings.aiModel = model;
    this.plugin.settings.aiModels[provider] = model;
    this.plugin.invalidateLocalAiState("answer-model");
    await this.plugin.saveSettings();
    if (notice) new Notice(notice);
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
      .setDesc("Default for new image captures. Choose a language only when image text is recognized incorrectly.")
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
        dropdown
          .setValue(recognitionReady && savedOcrReady ? savedOcrLanguage : "")
          .setDisabled(!recognitionReady || (readyOcrPresets.length === 0 && !savedCustom))
          .onChange(async (value) => {
          this.plugin.settings.captureOcrLanguage = value;
          await this.plugin.saveSettings();
          });
      });
    if ((!recognitionReady || !savedOcrReady) && savedOcrLanguage) {
      ocrSetting.addButton((button) => button.setButtonText("Clear preference").onClick(async () => {
        this.plugin.settings.captureOcrLanguage = "";
        await this.plugin.saveSettings();
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
            const value = normalizeOcrLanguageSet(text.getValue());
            if (!value) {
              new Notice(INVALID_CUSTOM_OCR_NOTICE);
              return;
            }
            const missingPacks = missingInstalledOcrPacks(value, languageAvailability.ocrInstalledPacks);
            if (missingPacks.length) {
              new Notice(`Missing installed Tesseract language packs: ${missingPacks.join(", ")}. Install them, then retry.`);
              return;
            }
            this.plugin.settings.captureOcrLanguage = value;
            void this.plugin.saveSettings().then(() => this.display());
          });
        });
    }
    const asrSetting = new Setting(recognition)
      .setName("Speech language")
      .setDesc("Default for new audio and video captures. Choose auto-detect when the recording's language is unknown.")
      .addDropdown((dropdown) => {
        dropdown.addOption("inherit-adapter-default", "No language preference");
        if (recognitionReady && languageAvailability.asrAutoDetect) {
          dropdown.addOption("auto-detect", "Auto-detect speech");
        }
        if (recognitionReady && languageAvailability.asrExplicit) {
          dropdown.addOption("en", "English").addOption("zh", "Chinese");
        }
        dropdown
          .setValue(recognitionReady ? this.plugin.settings.captureAsrLanguage : "inherit-adapter-default")
          .setDisabled(!recognitionReady)
          .onChange(async (value) => {
          this.plugin.settings.captureAsrLanguage = normalizeCaptureAsrLanguage(value);
          await this.plugin.saveSettings();
          });
      });
    if (!recognitionReady && this.plugin.settings.captureAsrLanguage !== "inherit-adapter-default") {
      asrSetting.addButton((button) => button.setButtonText("Clear preference").onClick(async () => {
        this.plugin.settings.captureAsrLanguage = "inherit-adapter-default";
        await this.plugin.saveSettings();
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
            await this.plugin.saveSettings();
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
          await this.plugin.saveSettings();
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
          await this.plugin.saveSettings();
        }));
    if (this.plugin.settings.pythonBridgePath) {
      pythonBridgeSetting.addButton((button) => button
        .setButtonText("Use bundled")
        .onClick(async () => {
          this.plugin.settings.pythonBridgePath = "";
          await this.plugin.saveSettings();
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
        customValue: selectableModels.some((model) => model.name === this.plugin.settings[key]) ? "" : this.plugin.settings[key],
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
          return checked.stale && localModels.some((model) => model.name === this.plugin.settings[key])
            ? { ...checked, optionValue: this.plugin.settings[key], useCustom: false }
            : checked;
        })();
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
          this.plugin.settings[key] = value;
          this.plugin.invalidateLocalAiState("model");
          await this.plugin.saveSettings();
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
    await this.plugin.saveSettings();
  }

  private hybridRetrievalSetting(container: HTMLElement): void {
    const aiSetupBusy = this.plugin.aiSetupBusy();
    new Setting(container)
      .setName("Hybrid retrieval")
      .setDesc("Fuse sparse note recall with optional local multilingual embeddings for vault questions. Disable this to stay sparse-only.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.hybridRetrievalEnabled)
        .setDisabled(aiSetupBusy)
        .onChange(async (value) => {
          this.plugin.settings.hybridRetrievalEnabled = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.plugin.saveSettings();
          this.rerenderLocalAiSection();
        }));
  }

  private embeddingModelSetting(container: HTMLElement): void {
    const aiSetupBusy = this.plugin.aiSetupBusy();
    const catalogChecked = typeof this.plugin.localAiState.catalogCheckedAt === "number";
    const embeddingModels = this.plugin.localAiState.models
      .filter((model) => modelSupportsEmbedding(model) && !modelIsCloudBacked(model));
    const options = embeddingModels.reduce<Record<string, string>>((result, model) => {
      result[model.name] = model.name;
      return result;
    }, {});
    const savedUnavailable = catalogChecked && !options[this.plugin.settings.embeddingModel];
    if (savedUnavailable) {
      options.__saved__ = `${this.plugin.settings.embeddingModel} (saved, not installed)`;
    } else if (!catalogChecked && this.plugin.settings.embeddingModel && !options[this.plugin.settings.embeddingModel]) {
      options[this.plugin.settings.embeddingModel] = this.plugin.settings.embeddingModel;
    }
    const selected = options[this.plugin.settings.embeddingModel] ? this.plugin.settings.embeddingModel : "__saved__";
    const setting = new Setting(container)
      .setName("Embedding model")
      .setDesc(!catalogChecked
        ? "Used only for local multilingual retrieval and optional reranking. Run Check setup to load installed models."
        : savedUnavailable
          ? "The saved embedding model is unavailable locally. Hybrid retrieval stays safe: it will not download or use a different model automatically."
          : "Used only for local multilingual retrieval and optional reranking during vault questions.")
      .addDropdown((dropdown) => {
        if (!Object.keys(options).length) dropdown.addOption("__saved__", this.plugin.settings.embeddingModel || "No local embedding model found");
        else dropdown.addOptions(options);
        dropdown.setValue(selected);
        dropdown.setDisabled(aiSetupBusy);
        dropdown.onChange(async (value) => {
          if (value === "__saved__") return;
          this.plugin.settings.embeddingModel = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.plugin.saveSettings();
          this.rerenderLocalAiSection();
        });
      })
      .addButton((button) => button
        .setButtonText(this.plugin.localAiState.activeAction === "test-embeddings" ? "Testing…" : "Test embeddings")
        .setDisabled(aiSetupBusy || !this.plugin.settings.embeddingModel.trim())
        .onClick(async () => {
          await this.runAiSetupAction(() => this.plugin.testLocalEmbeddings());
        }));
    if (savedUnavailable && this.plugin.settings.embeddingModel.trim().toLowerCase() === "bge-m3") {
      setting.addButton((button) => button
        .setButtonText("Copy download command")
        .onClick(async () => {
          try {
            await navigator.clipboard.writeText("ollama pull bge-m3");
            new Notice("Download command copied. Run `ollama pull bge-m3` in a terminal to install the recommended local embedding model.");
          } catch {
            new Notice("Could not copy the command. Run `ollama pull bge-m3` in a terminal.");
          }
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
        ? this.plugin.settings.embeddingModel.trim().toLowerCase() === "bge-m3"
          ? "Recommended model bge-m3 is not installed. Copy the command above to download it yourself; OMD Home never installs models automatically."
          : "Choose an installed local embedding model or install the saved model yourself, then run Test embeddings."
        : "Installed locally and available for hybrid retrieval. Run Test embeddings to verify it before relying on semantic reranking.");
    embeddingStatus.settingEl.addClass(
      "omd-settings-model-status",
      !catalogChecked ? "is-neutral" : savedUnavailable ? "is-unavailable" : "is-ready",
    );
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
