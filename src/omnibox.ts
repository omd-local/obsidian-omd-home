import { Notice, setIcon, type App, type TFile } from "obsidian";
import type OmdHomePlugin from "./main";
import {
  captureSourceFromDrop,
  looksCapturable,
  normalizeCaptureSource,
  recordingQuickActions,
  safeFileName,
} from "./omnibox-utils";

interface ObsidianCommand {
  id: string;
  name: string;
}

interface CommandRegistry {
  listCommands(): ObsidianCommand[];
  executeCommandById(id: string): boolean;
}

const RECORDING_ACTION_REFRESH_MS = 180;

export class Omnibox {
  private readonly app: App;
  private readonly plugin: OmdHomePlugin;
  private readonly onResultVisibilityChange?: (visible: boolean) => void;
  private root?: HTMLElement;
  private input!: HTMLInputElement;
  private resultPanel!: HTMLElement;
  private results!: HTMLElement;
  private actionBar!: HTMLElement;
  private recordingActions!: HTMLElement;
  private previewTimer: number | null = null;
  private recordingRefreshTimer: number | null = null;

  constructor(app: App, plugin: OmdHomePlugin, onResultVisibilityChange?: (visible: boolean) => void) {
    this.app = app;
    this.plugin = plugin;
    this.onResultVisibilityChange = onResultVisibilityChange;
  }

  mount(container: HTMLElement): void {
    if (!this.root) this.render();
    if (!this.root) return;
    if (this.root.parentElement === container && container.childElementCount === 1) return;
    container.empty();
    container.appendChild(this.root);
  }

  render(): void {
    if (this.root) return;
    this.root = createDiv({ cls: "omd-omnibox-shell" });
    const form = this.root.createEl("form", { cls: "omd-omnibox" });
    const icon = form.createSpan({ cls: "omd-omnibox-icon" });
    setIcon(icon, "search");
    this.input = form.createEl("input", {
      type: "search",
      cls: "omd-omnibox-input",
      attr: {
        "aria-label": "Search, capture, command, note, event, or AI question",
        placeholder: "Search, capture, command, note, event, or ask OMD",
        autocomplete: "off",
        spellcheck: "false",
      },
    });
    const hint = form.createSpan({ cls: "omd-omnibox-hint", text: ">  +  @" });
    hint.setAttribute("aria-hidden", "true");
    this.actionBar = this.root.createDiv({ cls: "omd-omnibox-actions" });
    this.quickAction(this.actionBar, "link", "Capture URL or file", () => this.plugin.openCaptureModal());
    this.quickAction(this.actionBar, "calendar-plus", "New event", () => void this.plugin.createCalendarEvent());
    this.quickAction(this.actionBar, "terminal-square", "Commands", () => this.usePrefix(">"));
    this.quickAction(this.actionBar, "sparkles", "Ask vault", () => this.usePrefix("@"));
    this.recordingActions = this.actionBar.createDiv({ cls: "omd-omnibox-recording-actions" });
    this.renderRecordingActions();
    this.resultPanel = this.root.createDiv({ cls: "omd-omnibox-result-panel" });
    const resultBar = this.resultPanel.createDiv({ cls: "omd-omnibox-result-bar" });
    resultBar.createSpan({ text: "OMD result" });
    const dismiss = resultBar.createEl("button", {
      cls: "clickable-icon omd-omnibox-dismiss",
      type: "button",
      attr: { "aria-label": "Close OMD result" },
    });
    setIcon(dismiss, "x");
    dismiss.addEventListener("click", () => {
      this.input.value = "";
      this.setResultsVisible(false);
      this.input.focus();
    });
    this.results = this.resultPanel.createDiv({ cls: "omd-omnibox-results" });
    this.setResultsVisible(false);

    this.input.addEventListener("input", () => this.schedulePreview());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.execute();
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.input.value = "";
        this.setResultsVisible(false);
      }
    });
    this.bindDropTarget(this.root);
  }

  focus(): void { this.input?.focus(); }

  private usePrefix(prefix: string): void {
    this.input.value = prefix;
    this.input.focus();
    this.input.setSelectionRange(prefix.length, prefix.length);
    this.schedulePreview();
  }

  private quickAction(container: HTMLElement, iconName: string, label: string, action: () => void): void {
    const button = container.createEl("button", { cls: "omd-quick-action", type: "button" });
    const icon = button.createSpan();
    setIcon(icon, iconName);
    button.createSpan({ text: label });
    button.addEventListener("click", action);
  }

  private get commands(): CommandRegistry {
    return (this.app as App & { commands: CommandRegistry }).commands;
  }

  private renderRecordingActions(): void {
    if (!this.recordingActions) return;
    this.recordingActions.empty();
    for (const action of recordingQuickActions(this.commands.listCommands())) {
      this.quickAction(this.recordingActions, action.icon, action.label, () => {
        this.commands.executeCommandById(action.id);
        this.input.focus();
        this.scheduleRecordingActionRefresh();
      });
    }
  }

  private scheduleRecordingActionRefresh(): void {
    if (this.recordingRefreshTimer !== null) window.clearTimeout(this.recordingRefreshTimer);
    this.recordingRefreshTimer = window.setTimeout(() => {
      this.recordingRefreshTimer = null;
      this.renderRecordingActions();
      this.input.focus();
    }, RECORDING_ACTION_REFRESH_MS);
  }

  private schedulePreview(): void {
    if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = null;
      void this.preview();
    }, 80);
  }

  private async preview(): Promise<void> {
    const query = this.input.value.trim();
    if (!query || query.startsWith("+") || query.startsWith("@") || looksCapturable(query)) {
      this.setResultsVisible(false);
      return;
    }
    if (query.startsWith(">")) {
      const needle = query.slice(1).trim().toLowerCase();
      const commands = this.commands.listCommands().filter((command) => command.name.toLowerCase().includes(needle)).slice(0, 7);
      this.showRows(commands.map((command) => ({
        title: command.name,
        detail: command.id,
        action: () => this.commands.executeCommandById(command.id),
      })));
      return;
    }
    const files = this.searchVault(query).slice(0, 7);
    this.showRows(files.map((file) => ({
      title: file.basename,
      detail: file.path,
      action: () => void this.app.workspace.openLinkText(file.path, "", false),
    })));
  }

  private async execute(): Promise<void> {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    const query = this.input.value.trim();
    if (!query) return;
    if (query.startsWith("@")) {
      this.setResultsVisible(true);
      await this.plugin.askOmd(query.slice(1).trim(), this.results);
      return;
    }
    if (query.startsWith("+")) {
      await this.createQuickNote(query.slice(1).trim());
      return;
    }
    if (looksCapturable(query)) {
      await this.plugin.captureWithOmd(normalizeCaptureSource(query));
      return;
    }
    if (query.startsWith(">")) {
      const first = this.commands.listCommands().find((command) => command.name.toLowerCase().includes(query.slice(1).trim().toLowerCase()));
      if (first) this.commands.executeCommandById(first.id);
      else new Notice("No matching command");
      return;
    }
    const first = this.searchVault(query)[0];
    if (first) {
      this.setResultsVisible(false);
      await this.app.workspace.openLinkText(first.path, "", false);
    } else {
      this.setResultsVisible(true);
      await this.plugin.searchWithOmd(query, this.results);
    }
  }

  private searchVault(query: string): TFile[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.app.vault.getMarkdownFiles()
      .map((file) => ({ file, score: terms.reduce((score, term) => score + (file.path.toLowerCase().includes(term) ? 1 : 0), 0) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || b.file.stat.mtime - a.file.stat.mtime)
      .map(({ file }) => file);
  }

  private async createQuickNote(title: string): Promise<void> {
    const safeTitle = title || `Quick note ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}`;
    const path = await this.plugin.uniquePath(`Inbox/${safeFileName(safeTitle)}.md`);
    const content = `---\ntype: inbox\ncaptured_at: ${JSON.stringify(new Date().toISOString())}\n---\n\n# ${safeTitle}\n\n`;
    await this.plugin.ensureFolder("Inbox");
    await this.app.vault.create(path, content);
    await this.app.workspace.openLinkText(path, "", false);
    this.input.value = "";
    new Notice("Saved to inbox");
  }

  private showRows(rows: Array<{ title: string; detail: string; action: () => void }>): void {
    this.results.empty();
    this.setResultsVisible(rows.length > 0);
    for (const row of rows) {
      const button = this.results.createEl("button", { cls: "omd-result-row", type: "button" });
      button.createSpan({ cls: "omd-result-title", text: row.title });
      button.createSpan({ cls: "omd-result-detail", text: row.detail });
      button.addEventListener("click", () => {
        this.setResultsVisible(false);
        row.action();
      });
    }
  }

  private setResultsVisible(visible: boolean): void {
    if (!this.resultPanel) return;
    this.resultPanel.hidden = !visible;
    this.onResultVisibilityChange?.(visible);
  }

  private bindDropTarget(target: HTMLElement): void {
    const setActive = (active: boolean) => target.toggleClass("is-drop-target", active);
    target.addEventListener("dragenter", (event) => {
      event.preventDefault();
      setActive(true);
    });
    target.addEventListener("dragover", (event) => {
      event.preventDefault();
      setActive(true);
    });
    target.addEventListener("dragleave", (event) => {
      if (event.currentTarget === event.target) setActive(false);
    });
    target.addEventListener("drop", (event) => {
      event.preventDefault();
      setActive(false);
      const source = captureSourceFromDataTransfer(event.dataTransfer);
      if (!source) return;
      this.plugin.openCaptureModal(source);
    });
  }
}

function captureSourceFromDataTransfer(dataTransfer: DataTransfer | null): string {
  const file = dataTransfer?.files?.[0];
  const filePath = file && "path" in file && typeof file.path === "string" ? file.path : "";
  return captureSourceFromDrop(
    filePath,
    dataTransfer?.getData("text/uri-list") ?? "",
    dataTransfer?.getData("text/plain") ?? "",
  );
}
