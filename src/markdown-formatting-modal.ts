import { Modal, Setting, type App } from "obsidian";

export class MarkdownFormattingModal extends Modal {
  private resolved = false;
  private generating = true;
  private readonly pendingDecision: Promise<boolean>;
  private resolveDecision!: (apply: boolean) => void;
  private statusEl?: HTMLElement;
  private previewSection?: HTMLElement;
  private previewCode?: HTMLElement;
  private applyButton?: HTMLButtonElement;

  constructor(
    app: App,
    private readonly noteName: string,
    private readonly onCancelGeneration: () => void,
  ) {
    super(app);
    this.pendingDecision = new Promise<boolean>((resolve) => {
      this.resolveDecision = resolve;
    });
  }

  onOpen(): void {
    this.modalEl.addClass("omd-formatting-modal");
    this.titleEl.setText("Improve formatting");
    this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: "Add paragraphs and Markdown structure while preserving the wording and language.",
    });
    this.statusEl = this.contentEl.createDiv({
      cls: "omd-formatting-status is-active",
      text: "Improving formatting…",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    this.previewSection = this.contentEl.createEl("section", {
      cls: "omd-formatting-preview",
      attr: { "aria-label": `Formatting preview for ${this.noteName}` },
    });
    this.previewSection.hidden = true;
    this.previewSection.createEl("h3", { text: "Formatting preview" });
    const preview = this.previewSection.createEl("pre", { attr: { tabindex: "0" } });
    this.previewCode = preview.createEl("code", { attr: { dir: "auto" } });

    const actions = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => {
        button.setCta().setButtonText("Apply formatting").setDisabled(true).onClick(() => {
          this.finish(true);
          this.close();
        });
        this.applyButton = button.buttonEl;
      });
    actions.settingEl.addClass("omd-modal-actions");
  }

  openAndWait(): Promise<boolean> {
    this.open();
    return this.pendingDecision;
  }

  showPreview(markdown: string): void {
    this.finishGeneration();
    if (this.statusEl) {
      this.statusEl.removeClass("is-active");
      this.statusEl.setText("Preview ready. The note is unchanged until you apply it.");
    }
    if (this.previewCode) this.previewCode.setText(markdown);
    if (this.previewSection) this.previewSection.hidden = false;
    if (this.applyButton) this.applyButton.disabled = false;
  }

  finishGeneration(): void {
    this.generating = false;
  }

  onClose(): void {
    if (this.generating) this.onCancelGeneration();
    this.contentEl.empty();
    this.finish(false);
  }

  private finish(apply: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveDecision(apply);
  }
}
