import { Modal, Setting, type App, type ButtonComponent } from "obsidian";
import type { MarkdownFormattingMode } from "./markdown-formatting.ts";

let formattingModalSequence = 0;

export class MarkdownFormattingModal extends Modal {
  private resolved = false;
  private generating = true;
  private closed = false;
  private readonly pendingDecision: Promise<boolean>;
  private resolveDecision!: (apply: boolean) => void;
  private statusEl?: HTMLElement;
  private previewSection?: HTMLElement;
  private previewCode?: HTMLElement;
  private closeButton?: ButtonComponent;
  private applyButton?: ButtonComponent;
  private generateAgainButton?: ButtonComponent;
  private generateAgain?: () => void;
  private readonly previewHeadingId = `omd-formatting-preview-heading-${++formattingModalSequence}`;

  constructor(
    app: App,
    private readonly noteName: string,
    private readonly mode: MarkdownFormattingMode,
    private readonly onCancelGeneration: () => void,
    private readonly onClosed: () => void,
  ) {
    super(app);
    this.pendingDecision = new Promise<boolean>((resolve) => {
      this.resolveDecision = resolve;
    });
  }

  onOpen(): void {
    this.modalEl.addClass("omd-formatting-modal");
    const transcriptCleanup = this.mode === "transcript-cleanup";
    this.titleEl.setText(transcriptCleanup ? "Clean transcript" : "Improve formatting");
    this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: transcriptCleanup
        ? "Add punctuation and paragraph breaks while preserving every original word, number, URL, timestamp, and language."
        : "Add paragraphs and Markdown structure while preserving the wording and language.",
    });
    this.statusEl = this.contentEl.createDiv({
      cls: "omd-formatting-status is-active",
      text: transcriptCleanup ? "Cleaning transcript…" : "Improving formatting…",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    this.previewSection = this.contentEl.createEl("section", {
      cls: "omd-formatting-preview",
      attr: { role: "region", "aria-labelledby": this.previewHeadingId },
    });
    this.previewSection.hidden = true;
    this.previewSection.createEl("h3", {
      text: "Formatting preview",
      attr: { id: this.previewHeadingId },
    });
    const preview = this.previewSection.createEl("pre", { attr: { tabindex: "0" } });
    this.previewCode = preview.createEl("code", { attr: { dir: "auto" } });

    const actions = new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("Cancel").onClick(() => this.close());
        this.closeButton = button;
      })
      .addButton((button) => {
        button.setCta().setButtonText("Generate again").onClick(() => {
          const generateAgain = this.generateAgain;
          if (!generateAgain) return;
          button.setDisabled(true);
          generateAgain();
        });
        button.buttonEl.hidden = true;
        this.generateAgainButton = button;
      })
      .addButton((button) => {
        button.setCta().setButtonText(transcriptCleanup ? "Apply transcript cleanup" : "Apply formatting").setDisabled(true).onClick(() => {
          button.setDisabled(true);
          if (this.statusEl) {
            this.statusEl.addClass("is-active");
            this.statusEl.setText("Checking that the note has not changed…");
          }
          this.finish(true);
        });
        this.applyButton = button;
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
      this.statusEl.removeClass("is-conflict");
      this.statusEl.removeClass("is-error");
      this.statusEl.removeClass("is-no-changes");
      this.statusEl.setAttr("role", "status");
      this.statusEl.setAttr("aria-live", "polite");
      this.statusEl.setText(`Preview ready for ${this.noteName}. The note is unchanged until you apply it.`);
    }
    if (this.previewCode) this.previewCode.setText(markdown);
    if (this.previewSection) this.previewSection.hidden = false;
    if (this.generateAgainButton) this.generateAgainButton.buttonEl.hidden = true;
    if (this.applyButton) {
      this.applyButton.buttonEl.hidden = false;
      this.applyButton.setDisabled(false);
    }
  }

  showConflict(message: string, onGenerateAgain: () => void): void {
    this.generateAgain = onGenerateAgain;
    if (this.statusEl) {
      this.statusEl.removeClass("is-active");
      this.statusEl.removeClass("is-error");
      this.statusEl.removeClass("is-no-changes");
      this.statusEl.addClass("is-conflict");
      this.statusEl.setAttr("role", "alert");
      this.statusEl.setAttr("aria-live", "assertive");
      this.statusEl.setText(message);
    }
    if (this.applyButton) {
      this.applyButton.setDisabled(true);
      this.applyButton.buttonEl.hidden = true;
    }
    if (this.generateAgainButton) {
      this.generateAgainButton.buttonEl.hidden = false;
      this.generateAgainButton.setDisabled(false);
      this.generateAgainButton.buttonEl.focus();
    }
  }

  showFailure(message: string, onGenerateAgain?: () => void): void {
    this.finishGeneration();
    this.generateAgain = onGenerateAgain;
    if (this.statusEl) {
      this.statusEl.removeClass("is-active");
      this.statusEl.removeClass("is-conflict");
      this.statusEl.removeClass("is-no-changes");
      this.statusEl.addClass("is-error");
      this.statusEl.setAttr("role", "alert");
      this.statusEl.setAttr("aria-live", "assertive");
      this.statusEl.setText(message);
    }
    if (this.previewSection) this.previewSection.hidden = true;
    if (this.applyButton) {
      this.applyButton.setDisabled(true);
      this.applyButton.buttonEl.hidden = true;
    }
    if (this.generateAgainButton) {
      this.generateAgainButton.buttonEl.hidden = !onGenerateAgain;
      this.generateAgainButton.setDisabled(!onGenerateAgain);
    }
    this.closeButton?.setButtonText("Close");
    (onGenerateAgain ? this.generateAgainButton : this.closeButton)?.buttonEl.focus();
  }

  showNoChanges(message: string): void {
    this.finishGeneration();
    this.generateAgain = undefined;
    if (this.statusEl) {
      this.statusEl.removeClass("is-active");
      this.statusEl.removeClass("is-conflict");
      this.statusEl.removeClass("is-error");
      this.statusEl.addClass("is-no-changes");
      this.statusEl.setAttr("role", "status");
      this.statusEl.setAttr("aria-live", "polite");
      this.statusEl.setText(message);
    }
    if (this.previewSection) this.previewSection.hidden = true;
    if (this.generateAgainButton) this.generateAgainButton.buttonEl.hidden = true;
    if (this.applyButton) {
      this.applyButton.setDisabled(true);
      this.applyButton.buttonEl.hidden = true;
    }
    this.closeButton?.setButtonText("Close");
    this.closeButton?.buttonEl.focus();
  }

  finishGeneration(): void {
    this.generating = false;
  }

  onClose(): void {
    if (this.generating) this.onCancelGeneration();
    this.contentEl.empty();
    this.finish(false);
    if (!this.closed) {
      this.closed = true;
      this.onClosed();
    }
  }

  private finish(apply: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveDecision(apply);
  }
}
