import { App, PluginSettingTab, Setting } from "obsidian";
import type OmdHomePlugin from "./main";
import type { ExternalCalendarDescriptor } from "./model";

const AI_PROVIDERS = new Set<OmdHomeSettings["aiProvider"]>(["ollama", "openai", "anthropic", "deepseek"]);

export interface OmdHomeSettings {
  openOnLaunch: boolean;
  omdExecutable: string;
  pythonExecutable: string;
  pythonBridgePath: string;
  eventKitHelperPath: string;
  selectedCalendarIds: string[];
  defaultExternalCalendarId: string;
  aiProvider: "ollama" | "openai" | "anthropic" | "deepseek";
  aiModel: string;
  ollamaHost: string;
  capturePolish: boolean;
  capturePolishModel: string;
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
  ollamaHost: "http://localhost:11434",
  capturePolish: false,
  capturePolishModel: "qwen3:4b-instruct",
  pinnedNotes: [],
};

export class OmdHomeSettingTab extends PluginSettingTab {
  private readonly plugin: OmdHomePlugin;

  constructor(app: App, plugin: OmdHomePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "OMD Home" });
    containerEl.createEl("p", {
      cls: "omd-settings-intro",
      text: "Local-first paths and provider choices. API keys remain in OMD's Keychain boundary.",
    });

    new Setting(containerEl)
      .setName("Open Home on launch")
      .setDesc("Open once when Obsidian starts without closing restored tabs.")
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.openOnLaunch).onChange(async (value) => {
        this.plugin.settings.openOnLaunch = value;
        await this.plugin.saveSettings();
      }));

    this.pathSetting(containerEl, "OMD executable", "Command or absolute path used for capture.", "omdExecutable");
    this.pathSetting(containerEl, "Python executable", "Optional override. When blank, use the interpreter embedded in the OMD executable.", "pythonExecutable");
    this.pathSetting(containerEl, "OMD Home bridge", "Absolute path to bridge/omd_home_bridge.py.", "pythonBridgePath");
    this.pathSetting(containerEl, "EventKit helper", "Absolute path to the signed omd-eventkit helper.", "eventKitHelperPath");

    new Setting(containerEl)
      .setName("AI provider")
      .setDesc("Hosted providers still require a task-specific disclosure and confirmation.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ ollama: "Ollama", openai: "OpenAI API", anthropic: "Anthropic API", deepseek: "DeepSeek API" })
        .setValue(this.plugin.settings.aiProvider)
        .onChange(async (value) => {
          this.plugin.settings.aiProvider = value as OmdHomeSettings["aiProvider"];
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("AI model")
      .setDesc("Exact model identifier. OMD validates availability before sending content.")
      .addText((text) => text.setValue(this.plugin.settings.aiModel).onChange(async (value) => {
        this.plugin.settings.aiModel = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Ollama endpoint")
      .setDesc("Loopback is local. Remote endpoints require OMD's advanced policy checks.")
      .addText((text) => text.setValue(this.plugin.settings.ollamaHost).onChange(async (value) => {
        this.plugin.settings.ollamaHost = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Capture polish model")
      .setDesc("Local Ollama model used only when Capture's optional Markdown polish is enabled.")
      .addText((text) => text.setValue(this.plugin.settings.capturePolishModel).onChange(async (value) => {
        this.plugin.settings.capturePolishModel = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Refresh calendars")
      .setDesc("Read available calendars from macOS EventKit, then select them below.")
      .addButton((button) => button.setButtonText("Refresh").onClick(async () => {
        await this.plugin.refreshExternalCalendars();
        this.display();
      }));

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
      containerEl.createEl("p", { cls: "omd-settings-empty", text: "No EventKit calendars loaded." });
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
      .setDesc("Required for “Vault + Calendar” events. Only explicitly selected writable calendars appear here.")
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
        await this.plugin.saveSettings();
      }));
  }
}

export function normalizeOmdHomeSettings(raw: unknown): OmdHomeSettings {
  const input = raw && typeof raw === "object" ? raw as Partial<OmdHomeSettings> : {};
  const aiProvider = typeof input.aiProvider === "string" && AI_PROVIDERS.has(input.aiProvider as OmdHomeSettings["aiProvider"])
    ? input.aiProvider as OmdHomeSettings["aiProvider"]
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
    ollamaHost: cleanString(input.ollamaHost, DEFAULT_SETTINGS.ollamaHost),
    capturePolish: typeof input.capturePolish === "boolean" ? input.capturePolish : DEFAULT_SETTINGS.capturePolish,
    capturePolishModel: cleanString(input.capturePolishModel, DEFAULT_SETTINGS.capturePolishModel),
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
