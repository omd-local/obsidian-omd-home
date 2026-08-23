import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type OmdHomePlugin from "./main";
import type { ExternalCalendarDescriptor } from "./model";
import {
  buildModelSelectorState,
  describeReadinessCode,
  isFresh,
  modelHasRemoteMetadata,
  modelIsKnownThinkingOnly,
  modelSupportsEmbedding,
  providerMode,
} from "./local-ai-readiness";
import type { LocalAiWorkflowId, StoredAiProvider } from "./ollama-local-types";

const AI_PROVIDERS = new Set<StoredAiProvider>(["ollama", "openai", "anthropic", "deepseek"]);

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
  private catalogLoadInFlight = false;

  constructor(app: App, plugin: OmdHomePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("p", {
      cls: "omd-settings-intro",
      text: "Configure local OMD capabilities and optional macOS calendar access. OMD Home does not install external tools.",
    });

    new Setting(containerEl).setName("Startup").setHeading();

    new Setting(containerEl)
      .setName("Open home on launch")
      .setDesc("Open once when Obsidian starts without closing restored tabs.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.openOnLaunch).onChange(async (value) => {
        this.plugin.settings.openOnLaunch = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName("OMD").setHeading();
    this.pathSetting(containerEl, "OMD executable", "Command or absolute path used for capture and note suggestions.", "omdExecutable");
    new Setting(containerEl)
      .setName("Note enrichment capability")
      .setDesc(this.plugin.enrichmentCapability.message)
      .addButton((button) => button
        .setButtonText(this.plugin.enrichmentCapability.status === "unavailable" ? "Retry" : "Check")
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Checking…");
          const ready = await this.plugin.checkEnrichmentCapability(true);
          new Notice(ready ? "OMD note enrichment is ready" : this.plugin.enrichmentCapability.message);
          this.display();
        }));
    this.pathSetting(containerEl, "Python executable", "Optional override. When blank, use the interpreter embedded in the OMD executable.", "pythonExecutable");
    const pythonBridgeSetting = new Setting(containerEl)
      .setName("OMD Home bridge")
      .setDesc(
        this.plugin.settings.pythonBridgePath
          ? "Using a custom Python bridge path. Clear it to use the bridge bundled inside OMD Home."
          : "Using the bridge bundled inside OMD Home automatically. No bridge path is required.",
      )
      .addText((text) => text
        .setPlaceholder("Optional custom /absolute/path/to/omd_home_bridge.py")
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

    const localAiSection = containerEl.createDiv({ cls: "omd-settings-section omd-settings-local-ai" });
    this.renderLocalAiSection(localAiSection);
    if (!isFresh(this.plugin.localAiState.catalogCheckedAt)
      && !this.plugin.localAiState.activeAction
      && !this.catalogLoadInFlight) {
      this.catalogLoadInFlight = true;
      void this.plugin.ensureLocalAiCatalog().finally(() => {
        this.catalogLoadInFlight = false;
        if (localAiSection.isConnected) this.renderLocalAiSection(localAiSection);
      });
    }

    new Setting(containerEl).setName("Calendar").setHeading();
    if (!Platform.isMacOS) {
      new Setting(containerEl)
        .setName("Apple Calendar unavailable")
        .setDesc("Apple Calendar, including Google and Outlook accounts added to calendar, is supported on macOS only.");
      return;
    }

    const resolvedEventKitPath = this.plugin.resolvedEventKitHelperPath();
    const eventKitSetting = new Setting(containerEl)
      .setName("EventKit helper")
      .setDesc(
        this.plugin.settings.eventKitHelperPath
          ? "Using a custom helper path. Clear it to use the helper installed beside OMD Home."
          : resolvedEventKitPath
            ? `Using the installed helper automatically: ${resolvedEventKitPath}`
            : "No installed helper was found. Build it or enter an absolute path.",
      )
      .addText((text) => text
        .setPlaceholder(resolvedEventKitPath || "/absolute/path/to/omd-eventkit")
        .setValue(this.plugin.settings.eventKitHelperPath)
        .onChange(async (value) => {
          this.plugin.settings.eventKitHelperPath = value.trim();
          await this.plugin.saveSettings();
        }));
    if (this.plugin.settings.eventKitHelperPath) {
      eventKitSetting.addButton((button) => button
        .setButtonText("Use installed")
        .onClick(async () => {
          this.plugin.settings.eventKitHelperPath = "";
          await this.plugin.saveSettings();
          this.display();
        }));
    }

    new Setting(containerEl)
      .setName("Refresh calendars")
      .setDesc("Read available calendars from macOS EventKit, then select them below.")
      .addButton((button) => button
        .setButtonText(this.plugin.calendarLoading ? "Loading…" : "Refresh calendars")
        .setDisabled(this.plugin.calendarLoading)
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Loading…");
          await this.plugin.refreshExternalCalendars();
          this.display();
        }));

    if (this.plugin.calendarFeedback) {
      const feedback = containerEl.createDiv({ cls: `omd-settings-feedback is-${this.plugin.calendarFeedback.tone}` });
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
      containerEl.createEl("p", {
        cls: "omd-settings-empty",
        text: this.plugin.calendarFeedback?.tone === "error"
          ? "Calendars are unavailable. Use the error above to check the helper path or macOS Calendar permission."
          : "No calendars loaded yet. Press Refresh calendars; macOS may ask for Calendar access.",
      });
    }
    for (const calendar of calendars) {
      new Setting(containerEl)
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
            this.display();
          }));
    }

    const writable = calendars.filter(
      (calendar) => calendar.allowsModifications && this.plugin.settings.selectedCalendarIds.includes(calendar.id),
    );
    new Setting(containerEl)
      .setName("Default calendar")
      .setDesc("Required for “vault + calendar” events. Only explicitly selected writable calendars appear here.")
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
  }

  private renderLocalAiSection(container: HTMLElement): void {
    container.empty();
    new Setting(container).setName("Local AI").setHeading();

    const legacyProvider = providerMode(this.plugin.settings.aiProvider) === "legacy-disabled";
    new Setting(container)
      .setName("Provider")
      .setDesc(
        legacyProvider
          ? `Saved provider ${this.plugin.settings.aiProvider} is preserved for Vault Q&A but disabled in Phase 1a. Select Ollama to re-enable local vault answers; enrichment and capture polish still use loopback Ollama.`
          : "Phase 1a supports Ollama only. Hosted providers stay preserved in settings data, while enrichment and capture polish use loopback Ollama.",
      )
      .addButton((button) => button
        .setButtonText(legacyProvider ? "Use Ollama" : "Ollama only")
        .setDisabled(!legacyProvider)
        .onClick(async () => {
          this.plugin.settings.aiProvider = "ollama";
          this.plugin.invalidateLocalAiState("provider");
          await this.plugin.saveSettings();
          this.renderLocalAiSection(container);
        }));

    new Setting(container)
      .setName("Local content boundary")
      .setDesc(
        "Cloud availability does not mean your selected model is online. For a verifiable local-only boundary, OMD Home accepts only http://localhost:11434 or http://127.0.0.1:11434 and requires Ollama local-only mode before sending vault content.",
      );

    new Setting(container)
      .setName("Ollama endpoint")
      .setDesc("Only the default local Ollama endpoints are accepted in phase 1a.")
      .addText((text) => text.setValue(this.plugin.settings.ollamaHost).onChange(async (value) => {
        this.plugin.settings.ollamaHost = value.trim();
        this.plugin.invalidateLocalAiState("host");
        await this.plugin.saveSettings();
      }));

    const localAiStatusSetting = new Setting(container)
      .setName("Local AI status")
      .setDesc(this.plugin.localAiState.daemonDetail)
      .addButton((button) => button
        .setButtonText(this.plugin.localAiState.activeAction === "refresh-models" ? "Refreshing…" : "Refresh models")
        .setDisabled(Boolean(this.plugin.localAiState.activeAction))
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Refreshing…");
          await this.plugin.refreshLocalAiCatalog(true);
          if (container.isConnected) this.renderLocalAiSection(container);
        }))
      .addButton((button) => button
        .setButtonText(this.plugin.localAiState.activeAction === "check-connection" ? "Checking…" : "Check connection")
        .setDisabled(Boolean(this.plugin.localAiState.activeAction))
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Checking…");
          await this.plugin.checkLocalAiConnection();
          if (container.isConnected) this.renderLocalAiSection(container);
        }));
    if (this.plugin.localAiState.activeAction) {
      localAiStatusSetting.addButton((button) => button
        .setButtonText("Cancel")
        .setWarning()
        .onClick(() => {
          this.plugin.cancelLocalAiAction();
          this.renderLocalAiSection(container);
        }));
    }

    if (this.plugin.localAiFeedback) {
      const feedback = container.createDiv({ cls: `omd-settings-feedback is-${this.plugin.localAiFeedback.tone}` });
      feedback.createEl("strong", { text: this.plugin.localAiFeedback.message });
      feedback.createSpan({ text: new Date(this.plugin.localAiFeedback.at).toLocaleTimeString() });
    }

    if (
      this.plugin.localAiState.daemonCode === "cloud_features_enabled"
      || this.plugin.localAiState.daemonCode === "cloud_features_unknown"
    ) {
      new Setting(container)
        .setName("Enable Ollama local-only mode")
        .setDesc("Cloud availability does not mean your current model is online. To make the boundary verifiable, put {\"disable_ollama_cloud\": true} in ~/.ollama/server.json, quit and reopen Ollama, then press Check connection.")
        .addButton((button) => button
          .setButtonText("Copy settings")
          .onClick(async () => {
            try {
              await navigator.clipboard.writeText('{"disable_ollama_cloud": true}');
              new Notice("Copied Ollama local-only settings");
            } catch {
              new Notice("Could not copy settings. Add disable_ollama_cloud to ~/.ollama/server.json manually.");
            }
          }));
    }

    new Setting(container)
      .setName("Daemon summary")
      .setDesc(
        [
          describeReadinessCode(this.plugin.localAiState.daemonCode),
          this.plugin.localAiState.version ? `Ollama ${this.plugin.localAiState.version}` : "",
          this.plugin.localAiState.catalogCheckedAt ? `Checked ${new Date(this.plugin.localAiState.catalogCheckedAt).toLocaleString()}` : "",
        ].filter(Boolean).join(" · ") || "Not checked yet",
      );

    this.modelSetting(container, "Vault Q&A model", "Used only for read-only `@` vault questions.", "aiModel", "qa");
    this.hybridRetrievalSetting(container);
    this.embeddingModelSetting(container);
    new Setting(container)
      .setName("Semantic rerank")
      .setDesc("Optionally re-order retrieved evidence blocks with the local embedding model. If reranking fails, sparse-first order is kept.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.semanticRerankEnabled)
        .setDisabled(!this.plugin.settings.hybridRetrievalEnabled)
        .onChange(async (value) => {
          this.plugin.settings.semanticRerankEnabled = value;
          this.plugin.invalidateLocalAiState("retrieval");
          await this.plugin.saveSettings();
        }));

    new Setting(container)
      .setName("Local note enrichment")
      .setDesc("Generate sends the current note, ranked candidate metadata, and vault tags to the configured local OMD executable and local Ollama. No note changes occur until you confirm the proposal.");

    this.modelSetting(container, "Enrichment model", "Used by OMD's review-first link and tag suggestions.", "enrichmentModel", "enrichment");

    new Setting(container)
      .setName("Suggest links and tags after capture")
      .setDesc("Open a local, review-first proposal after a successful capture. No links or tags are written until you approve them.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.captureSuggestLinksAndTags)
        .onChange(async (value) => {
          this.plugin.settings.captureSuggestLinksAndTags = value;
          await this.plugin.saveSettings();
        }));

    this.modelSetting(container, "Capture polish model", "Used only when capture's optional Markdown polish is enabled.", "capturePolishModel", "capture");
  }

  private pathSetting(
    container: HTMLElement,
    name: string,
    description: string,
    key: "omdExecutable" | "pythonExecutable" | "pythonBridgePath" | "eventKitHelperPath",
  ): void {
    new Setting(container).setName(name).setDesc(description).addText((text) => text
      .setValue(this.plugin.settings[key])
      .onChange(async (value) => {
        this.plugin.settings[key] = value.trim();
        if (key === "omdExecutable") this.plugin.resetEnrichmentCapability();
        await this.plugin.saveSettings();
      }));
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
            ? " (thinking-only; use instruct)"
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
      })
      .addText((text) => {
        text.setPlaceholder("Custom Ollama model id");
        text.setValue(selector.useCustom ? selector.customValue : "");
        text.setDisabled(!selector.useCustom);
        text.onChange(async (value) => {
          if (!selector.useCustom) return;
          this.customModelModes.add(workflow);
          this.plugin.settings[key] = value.trim();
          this.plugin.invalidateLocalAiState("model");
          await this.plugin.saveSettings();
        });
      })
      .addButton((button) => button
        .setButtonText(this.plugin.localAiState.activeAction === `smoke:${workflow}` ? "Running…" : "Smoke")
        .setDisabled(Boolean(this.plugin.localAiState.activeAction) || !this.plugin.settings[key].trim())
        .onClick(async () => {
          button.setDisabled(true).setButtonText("Running…");
          await this.plugin.smokeLocalAiWorkflow(workflow);
          if (container.isConnected) this.renderLocalAiSection(container);
        }));
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

export function normalizeOmdHomeSettings(raw: unknown): OmdHomeSettings {
  const input = raw && typeof raw === "object" ? raw as Partial<OmdHomeSettings> : {};
  const aiProviderValue = input.aiProvider;
  const aiProvider = typeof aiProviderValue === "string" && AI_PROVIDERS.has(aiProviderValue)
    ? aiProviderValue
    : DEFAULT_SETTINGS.aiProvider;
  return {
    openOnLaunch: typeof input.openOnLaunch === "boolean" ? input.openOnLaunch : DEFAULT_SETTINGS.openOnLaunch,
    omdExecutable: cleanString(input.omdExecutable, DEFAULT_SETTINGS.omdExecutable),
    pythonExecutable: cleanString(input.pythonExecutable, DEFAULT_SETTINGS.pythonExecutable),
    pythonBridgePath: cleanString(input.pythonBridgePath, DEFAULT_SETTINGS.pythonBridgePath),
    eventKitHelperPath: cleanString(input.eventKitHelperPath, DEFAULT_SETTINGS.eventKitHelperPath),
    selectedCalendarIds: uniqueStrings(input.selectedCalendarIds),
    defaultExternalCalendarId: cleanString(input.defaultExternalCalendarId, DEFAULT_SETTINGS.defaultExternalCalendarId),
    aiProvider,
    aiModel: cleanString(input.aiModel, DEFAULT_SETTINGS.aiModel),
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
