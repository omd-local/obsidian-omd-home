import { Notice, setIcon, type App, type TFile } from "obsidian";
import type OmdHomePlugin from "./main";
import { looksCapturable, safeFileName } from "./omnibox-utils";

interface ObsidianCommand {
  id: string;
  name: string;
}

interface CommandRegistry {
  listCommands(): ObsidianCommand[];
  executeCommandById(id: string): boolean;
}

export class Omnibox {
  private readonly app: App;
  private readonly plugin: OmdHomePlugin;
  private root?: HTMLElement;
  private input!: HTMLInputElement;
  private results!: HTMLElement;
  private previewTimer: number | null = null;

  constructor(app: App, plugin: OmdHomePlugin) {
    this.app = app;
    this.plugin = plugin;
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
    const actions = this.root.createDiv({ cls: "omd-omnibox-actions" });
    this.quickAction(actions, "link", "Capture URL or file", () => this.plugin.openCaptureModal());
    this.quickAction(actions, "calendar-plus", "New event", () => void this.plugin.createCalendarEvent());
    this.quickAction(actions, "sparkles", "Ask vault", () => this.usePrefix("@"));
    this.results = this.root.createDiv({ cls: "omd-omnibox-results" });
    this.results.hidden = true;

    this.input.addEventListener("input", () => this.schedulePreview());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.execute();
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.input.value = "";
        this.results.hidden = true;
      }
    });
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
      this.results.hidden = true;
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
      await this.plugin.askOmd(query.slice(1).trim(), this.results);
      return;
    }
    if (query.startsWith("+")) {
      await this.createQuickNote(query.slice(1).trim());
      return;
    }
    if (looksCapturable(query)) {
      await this.plugin.captureWithOmd(query);
      return;
    }
    if (query.startsWith(">")) {
      const first = this.commands.listCommands().find((command) => command.name.toLowerCase().includes(query.slice(1).trim().toLowerCase()));
      if (first) this.commands.executeCommandById(first.id);
      else new Notice("No matching command");
      return;
    }
    const first = this.searchVault(query)[0];
    if (first) await this.app.workspace.openLinkText(first.path, "", false);
    else await this.plugin.searchWithOmd(query, this.results);
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
    this.results.hidden = rows.length === 0;
    for (const row of rows) {
      const button = this.results.createEl("button", { cls: "omd-result-row", type: "button" });
      button.createSpan({ cls: "omd-result-title", text: row.title });
      button.createSpan({ cls: "omd-result-detail", text: row.detail });
      button.addEventListener("click", row.action);
    }
  }
}
