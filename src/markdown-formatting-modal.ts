import { Modal, Setting, type App, type ButtonComponent } from "obsidian";
import type { MarkdownFormattingMode } from "./markdown-formatting.ts";

let formattingModalSequence = 0;
type FormattingFailurePhase = "generate" | "apply";

export class MarkdownFormattingModal extends Modal {
  private resolved = false;
  private generating = true;
  private closed = false;
  private readonly pendingDecision: Promise<boolean>;
  private resolveDecision!: (apply: boolean) => void;
  private introEl?: HTMLElement;
  private statusEl?: HTMLElement;
  private previewSection?: HTMLElement;
  private previewCode?: HTMLElement;
  private closeButton?: ButtonComponent;
  private localModelButton?: ButtonComponent;
  private applyButton?: ButtonComponent;
  private generateAgainButton?: ButtonComponent;
  private generateAgain?: () => void;
  private readonly previewHeadingId = `omd-formatting-preview-heading-${++formattingModalSequence}`;

  constructor(
    app: App,
    private readonly noteName: string,
    private readonly mode: MarkdownFormattingMode,
    private readonly scopeDescription: string,
    private readonly onCancelGeneration: () => void,
    private readonly onClosed: () => void,
    private readonly onOpenLocalWritingSettings: () => void,
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
    this.introEl = this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: this.scopeDescription,
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
    this.setElementVisible(this.previewSection, false);
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
        button.setButtonText("Change local model").onClick(() => {
          this.close();
          this.onOpenLocalWritingSettings();
        });
        this.localModelButton = button;
        this.setButtonVisible(button, false);
      })
      .addButton((button) => {
        button.setCta().setButtonText("Try again").onClick(() => {
          const generateAgain = this.generateAgain;
          if (!generateAgain) return;
          button.setDisabled(true);
          generateAgain();
        });
        this.generateAgainButton = button;
        this.setButtonVisible(button, false);
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
    this.titleEl.setText("Review formatting");
    this.introEl?.setText("Review the suggested structure for the selected text. Metadata, images, links, and other protected source details stay unchanged.");
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
    this.setElementVisible(this.previewSection, true);
    this.setButtonVisible(this.localModelButton, false);
    this.setButtonVisible(this.generateAgainButton, false);
    if (this.applyButton) {
      this.setButtonVisible(this.applyButton, true);
      this.applyButton.setDisabled(false);
    }
  }

  showConflict(message: string, onGenerateAgain: () => void): void {
    this.generateAgain = onGenerateAgain;
    this.titleEl.setText("Note changed during review");
    this.introEl?.setText("Your newer edits were kept. Generate a fresh preview before applying formatting.");
    if (this.statusEl) {
      this.statusEl.removeClass("is-active");
      this.statusEl.removeClass("is-error");
      this.statusEl.removeClass("is-no-changes");
      this.statusEl.addClass("is-conflict");
      this.statusEl.setAttr("role", "alert");
      this.statusEl.setAttr("aria-live", "assertive");
      this.statusEl.setText(message);
    }
    this.setButtonVisible(this.localModelButton, false);
    this.applyButton?.setDisabled(true);
    this.setButtonVisible(this.applyButton, false);
    if (this.generateAgainButton) {
      this.setButtonVisible(this.generateAgainButton, true);
      this.generateAgainButton.setDisabled(false);
      this.generateAgainButton.buttonEl.focus();
    }
  }

  showFailure(
    message: string,
    onGenerateAgain?: () => void,
    offerLocalModelSettings = false,
    phase: FormattingFailurePhase = "generate",
  ): void {
    this.finishGeneration();
    this.generateAgain = onGenerateAgain;
    this.generateAgainButton?.setButtonText("Try again");
    this.titleEl.setText(phase === "apply" ? "Formatting couldn’t be applied" : "Formatting couldn’t be generated");
    this.introEl?.setText(phase === "apply" ? "Your note is unchanged." : "OMD kept the original note safe.");
    if (this.statusEl) {
      this.statusEl.removeClass("is-active");
      this.statusEl.removeClass("is-conflict");
      this.statusEl.removeClass("is-no-changes");
      this.statusEl.addClass("is-error");
      this.statusEl.setAttr("role", "alert");
      this.statusEl.setAttr("aria-live", "assertive");
      this.statusEl.setText(message);
    }
    this.setElementVisible(this.previewSection, false);
    this.applyButton?.setDisabled(true);
    this.setButtonVisible(this.applyButton, false);
    this.setButtonVisible(this.localModelButton, offerLocalModelSettings);
    if (this.generateAgainButton) {
      this.setButtonVisible(this.generateAgainButton, Boolean(onGenerateAgain));
      this.generateAgainButton.setDisabled(!onGenerateAgain);
    }
    this.closeButton?.setButtonText("Close");
    (onGenerateAgain
      ? this.generateAgainButton
      : offerLocalModelSettings
        ? this.localModelButton
        : this.closeButton)?.buttonEl.focus();
  }

  showTranscriptReviewRequired(message: string, onReviewTranscript: () => void): void {
    this.showFailure(message);
    this.titleEl.setText("Review transcript first");
    this.introEl?.setText("Formatting has not started. Resolve the transcript warning, then return to improve formatting.");
    this.generateAgain = onReviewTranscript;
    if (this.generateAgainButton) {
      this.generateAgainButton.setButtonText("Review transcript");
      this.setButtonVisible(this.generateAgainButton, true);
      this.generateAgainButton.setDisabled(false);
      this.generateAgainButton.buttonEl.focus();
    }
  }

  showNoChanges(message: string): void {
    this.finishGeneration();
    this.generateAgain = undefined;
    this.titleEl.setText("No formatting changes");
    this.introEl?.setText("Your note is unchanged.");
    if (this.statusEl) {
      this.statusEl.removeClass("is-active");
      this.statusEl.removeClass("is-conflict");
      this.statusEl.removeClass("is-error");
      this.statusEl.addClass("is-no-changes");
      this.statusEl.setAttr("role", "status");
      this.statusEl.setAttr("aria-live", "polite");
      this.statusEl.setText(message);
    }
    this.setElementVisible(this.previewSection, false);
    this.setButtonVisible(this.localModelButton, false);
    this.setButtonVisible(this.generateAgainButton, false);
    this.applyButton?.setDisabled(true);
    this.setButtonVisible(this.applyButton, false);
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

  private setButtonVisible(button: ButtonComponent | undefined, visible: boolean): void {
    if (!button) return;
    button.buttonEl.hidden = !visible;
    button.buttonEl.style.display = visible ? "" : "none";
  }

  private setElementVisible(element: HTMLElement | undefined, visible: boolean): void {
    if (!element) return;
    element.hidden = !visible;
    element.style.display = visible ? "" : "none";
  }

  private finish(apply: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveDecision(apply);
  }
}
