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
import { captureSourceFromDataTransfer, isLocalImageSource, normalizeCaptureSource } from "./omnibox-utils";

const IMAGE_TEXT_BOUNDARY = "Does not translate text or recognize scanned PDF pages.";

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
  private sourceError?: HTMLElement;
  private focusTimer: number | null = null;
  private submitting = false;

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
    this.contentEl.empty();
    this.modalEl.addClass("omd-capture-modal");
    this.titleEl.setText("Capture URL or file");
    this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: "Save a web page or local file as Markdown in this vault.",
    });
    const sourceSetting = new Setting(this.contentEl)
      .setName("URL or file path")
      .addText((text) => {
        text.inputEl.addClass("omd-capture-source");
        text.inputEl.setAttribute("aria-label", "URL or file path");
        text.setPlaceholder("https://… or /Users/…/document.pdf")
          .setValue(this.source)
          .onChange((value) => {
            this.source = normalizeCaptureSource(value);
            this.clearSourceError();
          });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || event.isComposing) return;
          event.preventDefault();
          void this.submit();
        });
        this.sourceInput = text.inputEl;
        this.focusTimer = window.setTimeout(() => {
          this.focusTimer = null;
          text.inputEl.focus();
        }, 0);
      });
    sourceSetting.settingEl.addClass("omd-capture-source-setting");
    this.sourceError = this.contentEl.createDiv({ cls: "omd-capture-error", attr: { role: "alert" } });
    this.sourceError.hidden = true;
    this.dropZone = this.contentEl.createDiv({ cls: "omd-capture-dropzone" });
    this.dropZone.createEl("strong", { text: "Drop a local file here" });
    this.dropZone.createSpan({ text: "Or paste its full path above." });
    this.bindDropTarget(this.dropZone);
    const tagsSetting = new Setting(this.contentEl)
      .setName("Tags")
      .setDesc("Optional. Separate tags with commas.")
      .addText((text) => text
        .setPlaceholder("Example: inbox, research/calendar")
        .setValue(this.tags)
        .onChange((value) => { this.tags = value; }));
    tagsSetting.settingEl.addClass("omd-capture-tags-setting");

    const recognition = this.contentEl.createEl("details", { cls: "omd-capture-recognition" });
    recognition.open = isLocalImageSource(this.source);
    recognition.createEl("summary", { text: "Recognition (optional)" });
    recognition.createEl("p", {
      cls: "omd-capture-help",
      text: "Language choices apply to this capture only.",
    });
    new Setting(recognition)
      .setName("Image text language")
      .setDesc(`For images and screenshots. ${IMAGE_TEXT_BOUNDARY} ${this.languageAvailability.message}`)
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
    const speechSetting = new Setting(recognition)
      .setName("Speech language")
      .setDesc("For audio and video recordings.")
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
    speechSetting.settingEl.addClass("omd-capture-section-last");

    const localAi = this.contentEl.createDiv({ cls: "omd-capture-ai" });
    new Setting(localAi).setName("Optional local AI").setHeading();
    localAi.createEl("p", {
      cls: "omd-capture-help",
      text: `Local writing model: ${this.polishModel}. Choices are remembered when you capture.`,
    });
    new Setting(localAi)
      .setName("Polish Markdown")
      .setDesc("Improve Markdown formatting after conversion. Long documents may take several minutes.")
      .addToggle((toggle) => toggle.setValue(this.polish).onChange((value) => {
        this.polish = value;
      }));
    const reviewSetting = new Setting(localAi)
      .setName("Review links and tags")
      .setDesc("Suggest links and tags after capture. Review them before applying.")
      .addToggle((toggle) => toggle.setValue(this.suggest).onChange((value) => {
        this.suggest = value;
      }));
    reviewSetting.settingEl.addClass("omd-capture-section-last");
    const actions = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText("Capture").onClick(() => this.submit()));
    actions.settingEl.addClass("omd-modal-actions");
  }

  onClose(): void {
    if (this.focusTimer !== null) {
      window.clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    const sourceError = captureSourceError(this.source);
    if (sourceError) {
      this.sourceError?.setText(sourceError);
      if (this.sourceError) this.sourceError.hidden = false;
      this.sourceInput?.setAttribute("aria-invalid", "true");
      this.sourceInput?.focus();
      return;
    }
    const tags = this.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    let request: CaptureRequest;
    try {
      request = createCaptureRequest({ source: this.source, tags, polish: this.polish, suggest: this.suggest, ocr: this.ocr, asr: this.asr });
      const languageError = captureLanguageSelectionError(request, this.languageAvailability);
      if (languageError) {
        new Notice(languageError);
        return;
      }
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Choose valid recognition options.");
      return;
    }
    this.submitting = true;
    this.close();
    try {
      await this.onCapture(request);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        new Notice(`Capture failed: ${error instanceof Error ? error.message : "Try again."}`);
        this.open();
      }
    } finally {
      this.submitting = false;
    }
  }

  private clearSourceError(): void {
    if (this.sourceError) this.sourceError.hidden = true;
    this.sourceInput?.removeAttribute("aria-invalid");
  }

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
          new Notice("Could not read this file's path. Paste its full path above.");
        }
        return;
      }
      this.source = source;
      if (this.sourceInput) this.sourceInput.value = this.source;
      this.clearSourceError();
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
    this.modalEl.addClass("omd-consent-modal");
    this.titleEl.setText("Send selected excerpts?");
    this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: "Send your question and the excerpts below to the selected provider. Filenames and paths are excluded unless they appear in the excerpt text.",
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
    details.createEl("summary", { text: "Excerpts to send" });
    const evidenceList = details.createDiv({ cls: "omd-consent-evidence-list" });
    for (const hit of this.preview.evidence) {
      const card = evidenceList.createDiv({ cls: "omd-consent-evidence-card" });
      card.createEl("strong", { text: hit.title || fileNameFromVaultPath(hit.path) });
      card.createEl("code", { text: vaultDisplayPath(hit.path) });
      card.createEl("p", { text: hit.evidence.trim() ? hit.evidence : "No excerpt available." });
    }
    const policyUrl = trustedProviderPolicyUrl(this.preview.destination_domain, this.preview.policy_url);
    if (policyUrl) {
      new Setting(this.contentEl)
        .setName("Provider policy")
        .setDesc(policyUrl)
        .addButton((button) => button
          .setButtonText("Open policy")
          .onClick(() => window.open(policyUrl, "_blank", "noopener,noreferrer")));
    }
    const actions = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => {
        this.finish(false);
        this.close();
      }))
      .addButton((button) => button.setCta().setButtonText("Send and answer").onClick(() => {
        this.finish(true);
        this.close();
      }));
    actions.settingEl.addClass("omd-modal-actions");
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

function captureSourceError(source: string): string | null {
  if (!source) return "Enter a URL or full local file path.";
  if (/^https?:\/\//iu.test(source)) {
    try {
      new URL(source);
      return null;
    } catch {
      return "Enter a valid web address, such as https://example.com/article.";
    }
  }
  if (source.startsWith("/") && !source.includes("\0")) return null;
  return "Enter a URL starting with https:// or a full local file path.";
}

export function trustedProviderPolicyUrl(destination: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const allowedRoots: Record<string, string> = {
    "api.openai.com": "openai.com",
    "api.anthropic.com": "anthropic.com",
    "api.deepseek.com": "deepseek.com",
    "ollama.com": "ollama.com",
  };
  const root = allowedRoots[destination.trim().toLowerCase()];
  if (!root) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== root && !host.endsWith(`.${root}`))) return null;
    return url.toString();
  } catch {
    return null;
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
