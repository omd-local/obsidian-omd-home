import { App, Modal, Notice, Setting } from "obsidian";
import {
  captureLanguageSelectionError,
  createCaptureRequest,
  filterReadyOcrPresets,
  missingInstalledOcrPacks,
  type CaptureAsrOption,
  type CaptureLanguageAvailability,
  type CaptureOcrOption,
  type CaptureRequest,
} from "./capture-request.ts";
import type { OmdSearchHit } from "./model";
import { captureSourceFromDataTransfer, normalizeCaptureSource } from "./omnibox-utils";

const IMAGE_TEXT_BOUNDARY = "Recognition only; it does not translate text or add scanned-PDF page OCR.";

export class CaptureModal extends Modal {
  private source = "";
  private tags = "";
  private polish: boolean;
  private suggest: boolean;
  private ocr: CaptureOcrOption;
  private asr: CaptureAsrOption;
  private readonly vaultCustomOcrLanguage: string | null;
  private sourceInput?: HTMLInputElement;
  private dropZone?: HTMLElement;

  constructor(
    app: App,
    initialRequest: CaptureRequest,
    private readonly languageAvailability: CaptureLanguageAvailability,
    private readonly polishModel: string,
    private readonly onCapture: (request: CaptureRequest) => Promise<void>,
  ) {
    super(app);
    this.polish = initialRequest.polish;
    this.suggest = initialRequest.suggest;
    this.source = normalizeCaptureSource(initialRequest.source);
    this.tags = initialRequest.tags.join(", ");
    this.ocr = this.availableOcrOption(initialRequest.ocr);
    this.asr = this.availableAsrOption(initialRequest.asr);
    this.vaultCustomOcrLanguage = this.ocr.mode === "custom" ? this.ocr.language : null;
  }

  onOpen(): void {
    this.modalEl.addClass("omd-capture-modal");
    this.titleEl.setText("Capture with OMD");
    this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: "Paste a URL or local file path. OMD saves a recoverable Markdown note in this vault.",
    });
    new Setting(this.contentEl)
      .setName("URL or file")
      .setDesc("For example: https://… or /Users/…/document.pdf")
      .addText((text) => {
        text.inputEl.addClass("omd-capture-source");
        text.setPlaceholder("Example URL or file path")
          .setValue(this.source)
          .onChange((value) => { this.source = normalizeCaptureSource(value); });
        this.sourceInput = text.inputEl;
        window.setTimeout(() => text.inputEl.focus(), 0);
      });
    this.dropZone = this.contentEl.createDiv({ cls: "omd-capture-dropzone" });
    this.dropZone.createEl("strong", { text: "Drop a local file here" });
    this.dropZone.createSpan({ text: "The path is filled in without invoking a shell." });
    this.bindDropTarget(this.dropZone);
    new Setting(this.contentEl)
      .setName("Tags")
      .setDesc("Optional comma-separated Obsidian tags. Nested tags such as project/research are supported.")
      .addText((text) => text
        .setPlaceholder("Example: inbox, research/calendar")
        .setValue(this.tags)
        .onChange((value) => { this.tags = value; }));

    const recognition = this.contentEl.createEl("details", { cls: "omd-capture-recognition" });
    recognition.createEl("summary", { text: "Recognition (optional)" });
    recognition.createEl("p", {
      cls: "omd-capture-help",
      text: "New captures start with the recognition defaults in settings. Changes here apply only to this capture. A retry repeats the failed capture's choices.",
    });
    new Setting(recognition)
      .setName("Image text language")
      .setDesc(`For screenshots and image files. Choose a language only when image text is recognized incorrectly. ${IMAGE_TEXT_BOUNDARY} ${this.languageAvailability.message}`)
      .addDropdown((dropdown) => {
        dropdown.addOption("", "No language preference");
        const readyPresets = filterReadyOcrPresets(
          this.languageAvailability.ocrPresets,
          this.languageAvailability.ocrBackendAvailable,
          this.languageAvailability.ocrInstalledPacks,
        );
        for (const preset of readyPresets) {
          dropdown.addOption(preset.value, preset.label);
        }
        if (this.vaultCustomOcrLanguage) {
          dropdown.addOption("__vault_custom__", `Saved custom language: ${this.vaultCustomOcrLanguage}`);
        }
        dropdown
          .setValue(this.ocrSelection())
          .setDisabled(
            this.languageAvailability.status === "unsupported"
            || (readyPresets.length === 0 && !this.vaultCustomOcrLanguage),
          )
          .onChange((value) => {
            this.setOcrSelection(value);
          });
      });
    new Setting(recognition)
      .setName("Speech language")
      .setDesc("For audio or video. Choose auto-detect when the recording's language is unknown.")
      .addDropdown((dropdown) => {
        dropdown.addOption("inherit-adapter-default", "No language preference");
        if (this.languageAvailability.asrAutoDetect) {
          dropdown.addOption("auto-detect", "Auto-detect speech");
        }
        if (this.languageAvailability.asrExplicit) {
          dropdown.addOption("en", "English").addOption("zh", "Chinese");
        }
        dropdown
          .setValue(this.asrSelection())
          .setDisabled(!this.languageAvailability.asrAutoDetect && !this.languageAvailability.asrExplicit)
          .onChange((value) => { this.setAsrSelection(value); });
      });

    const localAi = this.contentEl.createDiv({ cls: "omd-capture-ai" });
    new Setting(localAi).setName("Optional local AI").setHeading();
    localAi.createEl("p", {
      cls: "omd-capture-help",
      text: `Runs after conversion with ${this.polishModel}. Submitting saves these choices for next time; cancelling does not. A retry repeats the failed capture's choices.`,
    });
    new Setting(localAi)
      .setName("Polish Markdown")
      .setDesc("Improve formatting after structural conversion. The captured Markdown remains recoverable. Long pages can take several minutes.")
      .addToggle((toggle) => toggle.setValue(this.polish).onChange((value) => {
        this.polish = value;
      }));
    new Setting(localAi)
      .setName("Review links and tags")
      .setDesc("After the note is saved, generate a proposal for review. Nothing changes until you approve it.")
      .addToggle((toggle) => toggle.setValue(this.suggest).onChange((value) => {
        this.suggest = value;
      }));
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText("Capture").onClick(async () => {
        if (!this.source) return;
        const tags = this.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
        let request: CaptureRequest;
        try {
          request = createCaptureRequest({
            source: this.source,
            tags,
            polish: this.polish,
            suggest: this.suggest,
            ocr: this.ocr,
            asr: this.asr,
          });
          const languageError = captureLanguageSelectionError(request, this.languageAvailability);
          if (languageError) {
            new Notice(languageError);
            return;
          }
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "Choose valid recognition options.");
          return;
        }
        this.close();
        await this.onCapture(request);
      }));
  }

  onClose(): void { this.contentEl.empty(); }

  private ocrSelection(): string {
    if (this.ocr.mode === "inherit") return "";
    return this.ocr.mode === "preset" ? this.ocr.language : "__vault_custom__";
  }

  private availableOcrOption(option: CaptureOcrOption): CaptureOcrOption {
    if (option.mode === "inherit") return option;
    if (this.languageAvailability.status === "unsupported") return { mode: "inherit" };
    if (option.mode === "custom") {
      return this.languageAvailability.customOcr && this.ocrLanguageAvailable(option.language)
        ? option
        : { mode: "inherit" };
    }
    return this.languageAvailability.ocrPresets.some((preset) => preset.value === option.language)
      && this.ocrLanguageAvailable(option.language)
      ? option
      : { mode: "inherit" };
  }

  private ocrLanguageAvailable(language: string): boolean {
    return this.languageAvailability.ocrBackendAvailable !== false
      && missingInstalledOcrPacks(language, this.languageAvailability.ocrInstalledPacks).length === 0;
  }

  private availableAsrOption(option: CaptureAsrOption): CaptureAsrOption {
    if (option.mode === "inherit-adapter-default") return option;
    if (this.languageAvailability.status === "unsupported") return { mode: "inherit-adapter-default" };
    if (option.mode === "auto-detect") {
      return this.languageAvailability.asrAutoDetect ? option : { mode: "inherit-adapter-default" };
    }
    return this.languageAvailability.asrExplicit ? option : { mode: "inherit-adapter-default" };
  }

  private setOcrSelection(value: string): void {
    if (value === "eng" || value === "chi_sim+eng" || value === "chi_tra+eng") {
      this.ocr = { mode: "preset", language: value };
    } else if (value === "__vault_custom__" && this.vaultCustomOcrLanguage) {
      this.ocr = { mode: "custom", language: this.vaultCustomOcrLanguage };
    } else {
      this.ocr = { mode: "inherit" };
    }
  }

  private asrSelection(): string {
    return this.asr.mode === "explicit" ? this.asr.language : this.asr.mode;
  }

  private setAsrSelection(value: string): void {
    if (value === "auto-detect") this.asr = { mode: "auto-detect" };
    else if (value === "en" || value === "zh") this.asr = { mode: "explicit", language: value };
    else this.asr = { mode: "inherit-adapter-default" };
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
      if (!source) {
        if (event.dataTransfer?.files.length) {
          new Notice("OMD Home could not read this file's local path. Paste its full path into URL or file.");
        }
        return;
      }
      this.source = source;
      if (this.sourceInput) this.sourceInput.value = this.source;
    });
  }
}

export class CloudAnswerConsentModal extends Modal {
  private resolved = false;
  private readonly pendingDecision: Promise<boolean>;
  private resolveDecision!: (value: boolean) => void;

  constructor(
    app: App,
    private readonly preview: {
      question: string;
      provider: string;
      model: string;
      destination_domain: string;
      estimated_input_tokens: number;
      character_count: number;
      data_handling_summary: string;
      policy_url?: string | null;
      evidence: OmdSearchHit[];
    },
  ) {
    super(app);
    this.pendingDecision = new Promise<boolean>((resolve) => {
      this.resolveDecision = resolve;
    });
  }

  onOpen(): void {
    this.titleEl.setText("Send selected vault evidence?");
    this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: "Retrieval happened locally first. Only your question and the selected evidence excerpts are sent if you continue.",
    });
    new Setting(this.contentEl).setName("Question").setDesc(this.preview.question);
    new Setting(this.contentEl).setName("Provider").setDesc(this.preview.provider);
    new Setting(this.contentEl).setName("Model").setDesc(this.preview.model);
    new Setting(this.contentEl).setName("Destination").setDesc(this.preview.destination_domain);
    new Setting(this.contentEl)
      .setName("Selected evidence")
      .setDesc(`${this.preview.evidence.length} ${this.preview.evidence.length === 1 ? "source" : "sources"}`);
    new Setting(this.contentEl)
      .setName("Estimated input")
      .setDesc(`${this.preview.estimated_input_tokens} tokens from ${this.preview.character_count} characters`);
    new Setting(this.contentEl).setName("Data handling").setDesc(this.preview.data_handling_summary);
    const details = this.contentEl.createEl("details", { cls: "omd-consent-evidence", attr: { open: "open" } });
    details.createEl("summary", { text: "Review the exact evidence excerpts that will be sent" });
    const evidenceList = details.createDiv({ cls: "omd-consent-evidence-list" });
    for (const hit of this.preview.evidence) {
      const card = evidenceList.createDiv({ cls: "omd-consent-evidence-card" });
      card.createEl("strong", { text: hit.title || fileNameFromVaultPath(hit.path) });
      card.createEl("code", { text: vaultDisplayPath(hit.path) });
      card.createEl("p", { text: hit.evidence.trim() || "No excerpt available." });
    }
    if (this.preview.policy_url) {
      new Setting(this.contentEl)
        .setName("Provider policy")
        .setDesc(this.preview.policy_url)
        .addButton((button) => button
          .setButtonText("Open policy")
          .onClick(() => window.open(this.preview.policy_url || "", "_blank", "noopener,noreferrer")));
    }
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => {
        this.finish(false);
        this.close();
      }))
      .addButton((button) => button.setCta().setButtonText("Send and answer").onClick(() => {
        this.finish(true);
        this.close();
      }));
  }

  async openAndWait(): Promise<boolean> {
    this.open();
    return await this.pendingDecision;
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish(false);
  }

  private finish(value: boolean): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveDecision(value);
  }
}

function vaultDisplayPath(path: string): string {
  return `[[${path.trim().replace(/^\/+/u, "")}]]`;
}

function fileNameFromVaultPath(path: string): string {
  const normalized = path.trim().replace(/\/+$/u, "");
  const segments = normalized.split("/");
  return segments.at(-1) || "Untitled source";
}
