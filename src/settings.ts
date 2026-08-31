import { App, Notice, Platform, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import {
  AI_PROVIDER_VALUES,
  DEFAULT_AI_MODELS,
  aiProviderDestination,
  aiProviderEnvVar,
  aiProviderLabel,
  isCloudAiProvider,
  isHostedApiProvider,
  isOllamaCloudModel,
  isStoredAiProvider,
  normalizeAiModelMemory,
  providerSetupDescription,
  type AiModelMemory,
} from "./ai-provider.ts";
import { canOpenOllamaDesktopApp } from "./ollama-app";
import type OmdHomePlugin from "./main";
import type { ExternalCalendarDescriptor } from "./model";
import {
  buildModelSelectorState,
  describeReadinessCode,
  modelHasRemoteMetadata,
  modelIsKnownThinkingOnly,
  modelSupportsEmbedding,
} from "./local-ai-readiness";
import type { HostedAiProvider, LocalAiWorkflowId, StoredAiProvider } from "./ollama-local-types";
import { isAutomaticOmdExecutable, omdInstallInstructions } from "./omd-discovery.ts";

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
  hybridRetrievalEnabled: boolean;
  embeddingModel: string;
  semanticRerankEnabled: boolean;
  enrichmentModel: string;
  ollamaHost: string;
  capturePolish: boolean;
  capturePolishModel: string;
  captureSuggestLinksAndTags: boolean;
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
  hybridRetrievalEnabled: true,
  embeddingModel: "bge-m3",
  semanticRerankEnabled: false,
  enrichmentModel: "qwen3:4b-instruct",
  ollamaHost: "http://localhost:11434",
  capturePolish: false,
  capturePolishModel: "qwen3:4b-instruct",
  captureSuggestLinksAndTags: true,
  pinnedNotes: [],
};

export class OmdHomeSettingTab extends PluginSettingTab {
  private readonly plugin: OmdHomePlugin;
  private readonly customModelModes = new Set<LocalAiWorkflowId>();

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
        : "The Calendar helper was not found. Reinstall the complete plugin release or open Advanced Calendar helper below.")
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
      "Leave this blank to use the helper bundled with the plugin. Set an absolute path only for development or recovery.",
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
    new Setting(container)
      .setName("Answer provider")
      .setDesc("Use local Ollama for @ answers. Hosted choices currently configure credentials and models only. Retrieval and source selection stay on your computer.")
      .addDropdown((dropdown) => {
        for (const value of AI_PROVIDER_VALUES) dropdown.addOption(value, aiProviderLabel(value));
        dropdown.setValue(provider).onChange(async (value) => {
          if (!isStoredAiProvider(value)) return;
          this.plugin.settings.aiModels[provider] = this.plugin.settings.aiModel.trim();
          this.plugin.settings.aiProvider = value;
          this.plugin.settings.aiModel = this.plugin.settings.aiModels[value];
          this.customModelModes.delete("qa");
          this.plugin.invalidateLocalAiState("provider");
          await this.plugin.saveSettings();
          if (isHostedApiProvider(value)) {
            void this.plugin.ensureHostedCredentialState(value).finally(() => {
              if (container.isConnected) this.renderLocalAiSection(container);
            });
          }
          this.renderLocalAiSection(container);
        });
      });

    new Setting(container)
      .setName(isCloudAiProvider(provider) ? "Cloud boundary" : "Local-only boundary")
      .setDesc(`${providerSetupDescription(provider)} Destination: ${aiProviderDestination(provider)}.`);

    if (isHostedApiProvider(provider)) this.hostedCredentialSetting(container, provider);
    this.answerModelSetting(container, provider);
    this.answerProviderStatusSetting(container, provider);
    if (isHostedApiProvider(provider)
      && (!this.plugin.hostedAiState || this.plugin.hostedAiState.provider !== provider || !this.plugin.hostedAiState.credential)) {
      void this.plugin.ensureHostedCredentialState(provider).finally(() => {
        if (container.isConnected) this.renderLocalAiSection(container);
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
      "Tune local retrieval, capture enrichment, and the loopback Ollama endpoint.",
    );
    new Setting(advanced).setName("Vault retrieval").setHeading();
    this.hybridRetrievalSetting(advanced);
    this.embeddingModelSetting(advanced);
    new Setting(advanced)
      .setName("Semantic rerank")
      .setDesc("Reorder selected evidence with the local embedding model. Sparse order is kept if reranking fails.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.semanticRerankEnabled)
        .setDisabled(!this.plugin.settings.hybridRetrievalEnabled)
        .onChange(async (value) => {
          this.plugin.settings.semanticRerankEnabled = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.plugin.saveSettings();
        }));

    new Setting(advanced)
      .setName("Local capture and links")
      .setDesc("Enrichment and capture polish are separate local passes. Both use loopback Ollama; keep the two model selectors the same if you want one model for both.")
      .setHeading();
    this.modelSetting(advanced, "Enrichment model", "Review-first link and tag suggestions.", "enrichmentModel", "enrichment");
    new Setting(advanced)
      .setName("Suggest links and tags after capture")
      .setDesc("Open a review proposal after capture. Nothing is written until you approve it.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.captureSuggestLinksAndTags)
        .onChange(async (value) => {
          this.plugin.settings.captureSuggestLinksAndTags = value;
          await this.plugin.saveSettings();
        }));
    this.modelSetting(advanced, "Capture polish model", "Used only when capture polish is enabled.", "capturePolishModel", "capture");

    new Setting(advanced).setName("Ollama troubleshooting").setHeading();
    new Setting(advanced)
      .setName("Ollama endpoint")
      .setDesc("Only the default loopback Ollama endpoints are accepted.")
      .addText((text) => text.setValue(this.plugin.settings.ollamaHost).onChange(async (value) => {
        this.plugin.settings.ollamaHost = value.trim();
        this.plugin.invalidateLocalAiState("host");
        await this.plugin.saveSettings();
      }));
    if (this.plugin.localAiState.daemonCode === "cloud_features_enabled"
      || this.plugin.localAiState.daemonCode === "cloud_features_unknown") {
      new Setting(advanced)
        .setName("Ollama local-only configuration")
        .setDesc("Enable local-only mode in Ollama server settings, then fully restart Ollama and check setup again.")
        .addButton((button) => button.setButtonText("Copy configuration").onClick(async () => {
          try {
            await navigator.clipboard.writeText('{"disable_ollama_cloud": true}');
            new Notice("Copied Ollama local-only configuration");
          } catch {
            new Notice("Could not copy the configuration.");
          }
        }));
    }
  }

  private hostedCredentialSetting(container: HTMLElement, provider: HostedAiProvider): void {
    const state = this.plugin.hostedAiState?.provider === provider ? this.plugin.hostedAiState : null;
    const credential = state?.credential;
    const envVar = aiProviderEnvVar(provider);
    if (!Platform.isMacOS || credential?.keychainSupported === false) {
      const setting = new Setting(container)
        .setName("Developer key")
        .setDesc(credential?.source === "env"
          ? `Using ${credential.envVar || envVar} from the OMD environment. Consumer subscriptions do not include API usage. Hosted Vault Q&A stays disabled in this beta.`
          : `Set ${envVar} before starting Obsidian, then run Check setup. In-app saving appears only when macOS Keychain is available. Hosted Vault Q&A stays disabled in this beta.`);
      setting.settingEl.addClass("omd-settings-model", "omd-settings-secret");
      return;
    }
    let draft = "";
    const setting = new Setting(container)
      .setName("Developer key")
      .setDesc(credential?.source === "env"
        ? `Using ${credential.envVar} from the OMD environment. Consumer subscriptions do not include API usage. Hosted Vault Q&A stays disabled in this beta.`
        : credential?.source === "keychain"
          ? "Saved in macOS Keychain. Consumer subscriptions do not include API usage. Hosted Vault Q&A stays disabled in this beta."
          : `Paste a developer API key to save it in macOS Keychain, or set ${envVar} before starting Obsidian. The key is never stored in plugin settings.`);
    const secret = new SecretComponent(this.app, setting.controlEl)
      .setValue("")
      .onChange((value) => { draft = value; });
    const input = setting.controlEl.querySelector("input");
    if (input) input.setAttribute("placeholder", credential?.source === "keychain" ? "Key saved" : "Paste API key");
    setting.addButton((button) => button
      .setButtonText(state?.activeAction === "save-key" ? "Saving…" : "Save key")
      .setDisabled(Boolean(state?.activeAction))
      .onClick(async () => {
        if (!draft.trim()) return void new Notice("Paste a developer key first.");
        button.setDisabled(true).setButtonText("Saving…");
        let saved = false;
        try {
          await this.plugin.saveHostedApiKey(draft);
          saved = true;
        } catch {
          // The plugin records and surfaces the safe provider error.
        }
        if (!saved) {
          button.setDisabled(false).setButtonText("Save key");
          return;
        }
        secret.setValue("");
        draft = "";
        if (container.isConnected) this.renderLocalAiSection(container);
      }));
    if (credential?.source === "keychain") {
      setting.addButton((button) => button
        .setButtonText("Remove key")
        .setWarning()
        .setDisabled(Boolean(state?.activeAction))
        .onClick(async () => {
          await this.plugin.deleteHostedApiKey();
          if (container.isConnected) this.renderLocalAiSection(container);
        }));
    }
    setting.settingEl.addClass("omd-settings-model", "omd-settings-secret");
  }

  private answerModelSetting(container: HTMLElement, provider: StoredAiProvider): void {
    const models = provider === "ollama"
      ? this.plugin.localAiState.models.filter((model) => !isOllamaCloudModel(model))
      : provider === "ollama-cloud"
        ? this.plugin.localAiState.models.filter(isOllamaCloudModel)
        : this.plugin.hostedAiState?.provider === provider ? this.plugin.hostedAiState.models : [];
    const current = this.plugin.settings.aiModel.trim();
    const options = models.reduce<Record<string, string>>((result, model) => {
      const suffix = provider === "ollama" && model.capabilities.length > 0 && !model.supportsCompletion
          ? " (not text-capable)"
          : "";
      result[model.name] = `${model.name}${suffix}`;
      return result;
    }, {});
    const allowCustom = provider !== "ollama-cloud";
    const known = Boolean(options[current]);
    if (allowCustom) options.__custom__ = "Custom model id…";
    if (current && !known) options.__saved__ = `${current} (saved, not listed)`;
    if (!Object.keys(options).length) options.__empty__ = "Check setup to load models";
    const custom = allowCustom && (this.customModelModes.has("qa") || (!known && Boolean(current)));
    const setting = new Setting(container)
      .setName("Answer model")
      .setDesc(provider === "ollama-cloud"
        ? "Cloud-backed models detected by the local Ollama app. This selection is remembered for setup only in this build."
        : provider === "ollama"
          ? "The local model used for read-only @ questions. Prefer a chat or instruct model."
          : "The provider model validated by Check setup. This selection is remembered for setup only in this build.")
      .addDropdown((dropdown) => {
        dropdown.addOptions(options);
        dropdown.setValue(known ? current : custom ? "__custom__" : current ? "__saved__" : "__empty__");
        dropdown.onChange(async (value) => {
          if (value === "__empty__" || value === "__saved__") return;
          if (value === "__custom__") {
            this.customModelModes.add("qa");
            new Notice("Enter the exact model id, then run Check setup to verify it.");
            this.renderLocalAiSection(container);
            return;
          }
          this.customModelModes.delete("qa");
          await this.saveAnswerModel(provider, value);
          this.renderLocalAiSection(container);
        });
      });
    if (custom) {
      setting.addText((text) => {
        text
          .setPlaceholder("Exact provider model id")
          .setValue(current)
          .onChange(async (value) => await this.saveAnswerModel(provider, value));
        text.inputEl.addEventListener("blur", () => {
          if (!text.getValue().trim()) return;
          new Notice("Custom model id saved. Run Check setup to verify it is installed.");
        });
      });
    }
    setting.settingEl.addClass("omd-settings-model", "omd-settings-answer-model");
  }

  private async saveAnswerModel(provider: StoredAiProvider, value: string): Promise<void> {
    const model = value.trim();
    this.plugin.settings.aiModel = model;
    this.plugin.settings.aiModels[provider] = model;
    this.plugin.invalidateLocalAiState("answer-model");
    await this.plugin.saveSettings();
  }

  private answerProviderStatusSetting(container: HTMLElement, provider: StoredAiProvider): void {
    const hostedState = isHostedApiProvider(provider) && this.plugin.hostedAiState?.provider === provider
      ? this.plugin.hostedAiState
      : null;
    const activeAction = hostedState?.activeAction || this.plugin.localAiState.activeAction;
    const detail = hostedState?.detail
      ?? (provider === "ollama-cloud"
        ? "Check the local Ollama app, Cloud availability, and selected cloud model."
        : this.plugin.localAiState.daemonDetail);
    const status = new Setting(container)
      .setName("Answer setup")
      .setDesc(isCloudAiProvider(provider) ? `${detail} Check setup verifies credentials and model availability only.` : detail);
    const canOpenOllama = (provider === "ollama" || provider === "ollama-cloud")
      && canOpenOllamaDesktopApp()
      && this.plugin.localAiState.daemonCode === "daemon_unreachable";
    if (canOpenOllama) {
      status.addButton((button) => button.setButtonText("Open Ollama app").setCta().onClick(async () => {
        await this.plugin.openOllamaApp();
        if (container.isConnected) this.renderLocalAiSection(container);
      }));
    }
    status.addButton((button) => button
      .setButtonText(activeAction === "check-connection" ? "Checking…" : "Check setup")
      .setDisabled(Boolean(activeAction))
      .onClick(async () => {
        button.setDisabled(true).setButtonText("Checking…");
        if (provider === "ollama") await this.plugin.checkLocalAiConnection();
        else if (provider === "ollama-cloud") await this.plugin.checkOllamaCloudConnection();
        else await this.plugin.checkHostedAiConnection();
        if (container.isConnected) this.renderLocalAiSection(container);
      }));
  }

  private settingsDisclosure(container: HTMLElement, label: string, description: string): HTMLElement {
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
      .setDesc("Leave blank to read the interpreter from the detected OMD launcher shebang.")
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
    key: "aiModel" | "enrichmentModel" | "capturePolishModel",
    workflow: LocalAiWorkflowId,
  ): void {
    const workflowState = this.plugin.localAiState.workflows[workflow];
    const selector = this.customModelModes.has(workflow)
      ? {
        optionValue: "__custom__",
        useCustom: true,
        stale: false,
        customValue: this.plugin.localAiState.models.some((model) => model.name === this.plugin.settings[key]) ? "" : this.plugin.settings[key],
      }
      : buildModelSelectorState(this.plugin.settings[key], this.plugin.localAiState.models);
    const options = this.plugin.localAiState.models
      .reduce<Record<string, string>>((result, model) => {
        const suffix = modelHasRemoteMetadata(model)
          ? " (remote blocked)"
          : modelIsKnownThinkingOnly(model)
            ? ""
          : model.capabilities.length > 0 && !model.supportsCompletion
            ? " (not text-capable)"
          : model.capabilities.length === 0
            ? " (unchecked)"
            : "";
        result[model.name] = `${model.name}${suffix}`;
        return result;
      }, {});
    options.__custom__ = "Custom…";
    if (selector.stale) options.__stale__ = `${this.plugin.settings[key]} (saved, not installed)`;
    const setting = new Setting(container)
      .setName(name)
      .setDesc(`${description} ${describeReadinessCode(workflowState.code)}. ${workflowState.detail}`)
      .addDropdown((dropdown) => {
        dropdown.addOptions(options);
        dropdown.setValue(selector.optionValue);
        dropdown.onChange(async (value) => {
          if (value === "__custom__" || value === "__stale__") {
            this.customModelModes.add(workflow);
            this.renderLocalAiSection(container);
            return;
          }
          this.customModelModes.delete(workflow);
          this.plugin.settings[key] = value;
          this.plugin.invalidateLocalAiState("model");
          await this.plugin.saveSettings();
          this.renderLocalAiSection(container);
        });
      });
    if (selector.useCustom) {
      setting.addText((text) => {
        text.setPlaceholder("Custom Ollama model id");
        text.setValue(selector.customValue);
        text.onChange(async (value) => {
          this.customModelModes.add(workflow);
          this.plugin.settings[key] = value.trim();
          this.plugin.invalidateLocalAiState("model");
          await this.plugin.saveSettings();
        });
      });
    }
    setting.settingEl.addClass("omd-settings-model");
  }

  private hybridRetrievalSetting(container: HTMLElement): void {
    new Setting(container)
      .setName("Hybrid retrieval")
      .setDesc("Fuse sparse note recall with optional local multilingual embeddings for vault questions. Disable this to stay sparse-only.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.hybridRetrievalEnabled)
        .onChange(async (value) => {
          this.plugin.settings.hybridRetrievalEnabled = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.plugin.saveSettings();
          this.renderLocalAiSection(container);
        }));
  }

  private embeddingModelSetting(container: HTMLElement): void {
    const embeddingModels = this.plugin.localAiState.models
      .filter((model) => modelSupportsEmbedding(model) && !modelHasRemoteMetadata(model));
    const options = embeddingModels.reduce<Record<string, string>>((result, model) => {
      result[model.name] = model.name;
      return result;
    }, {});
    if (!options[this.plugin.settings.embeddingModel]) {
      options.__saved__ = `${this.plugin.settings.embeddingModel} (saved, not installed)`;
    }
    const selected = options[this.plugin.settings.embeddingModel] ? this.plugin.settings.embeddingModel : "__saved__";
    const setting = new Setting(container)
      .setName("Embedding model")
      .setDesc("Used only for local multilingual retrieval and optional reranking during vault questions.")
      .addDropdown((dropdown) => {
        if (!Object.keys(options).length) dropdown.addOption("__saved__", this.plugin.settings.embeddingModel || "No local embedding model found");
        else dropdown.addOptions(options);
        dropdown.setValue(selected);
        dropdown.onChange(async (value) => {
          if (value === "__saved__") return;
          this.plugin.settings.embeddingModel = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.plugin.saveSettings();
          this.renderLocalAiSection(container);
        });
      })
      .addButton((button) => button
        .setButtonText(this.plugin.localAiState.activeAction === "test-embeddings" ? "Testing…" : "Test embeddings")
        .setDisabled(Boolean(this.plugin.localAiState.activeAction) || !this.plugin.settings.embeddingModel.trim())
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Testing…");
          await this.plugin.testLocalEmbeddings();
          if (container.isConnected) this.renderLocalAiSection(container);
        }));
    setting.settingEl.addClass("omd-settings-model");
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
  const input = raw && typeof raw === "object" ? raw as Partial<OmdHomeSettings> : {};
  const aiProviderValue = input.aiProvider;
  const aiProvider = isStoredAiProvider(aiProviderValue) ? aiProviderValue : DEFAULT_SETTINGS.aiProvider;
  const legacyAiModel = typeof input.aiModel === "string"
    ? input.aiModel.trim()
    : aiProvider === "ollama" ? DEFAULT_SETTINGS.aiModel : "";
  const aiModels = normalizeAiModelMemory(input.aiModels, aiProvider, legacyAiModel);
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
    hybridRetrievalEnabled: typeof input.hybridRetrievalEnabled === "boolean"
      ? input.hybridRetrievalEnabled
      : DEFAULT_SETTINGS.hybridRetrievalEnabled,
    embeddingModel: cleanString(input.embeddingModel, DEFAULT_SETTINGS.embeddingModel),
    semanticRerankEnabled: typeof input.semanticRerankEnabled === "boolean"
      ? input.semanticRerankEnabled
      : DEFAULT_SETTINGS.semanticRerankEnabled,
    enrichmentModel: cleanString(input.enrichmentModel, DEFAULT_SETTINGS.enrichmentModel),
    ollamaHost: cleanString(input.ollamaHost, DEFAULT_SETTINGS.ollamaHost),
    capturePolish: typeof input.capturePolish === "boolean" ? input.capturePolish : DEFAULT_SETTINGS.capturePolish,
    capturePolishModel: cleanString(input.capturePolishModel, DEFAULT_SETTINGS.capturePolishModel),
    captureSuggestLinksAndTags: typeof input.captureSuggestLinksAndTags === "boolean"
      ? input.captureSuggestLinksAndTags
      : DEFAULT_SETTINGS.captureSuggestLinksAndTags,
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
