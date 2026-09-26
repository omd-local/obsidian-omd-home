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
import {
  captureSourceFromDataTransfer,
  captureSourceInputError,
  isLocalImageSource,
  localAccessPathError,
  normalizeLocalAccessPath,
  socialCaptureProvider,
} from "./omnibox-utils";

const IMAGE_TEXT_BOUNDARY = "Does not translate text or recognize scanned PDF pages.";
const CAPTURE_ACCESS_STATUS_ID = "omd-capture-source-access-status";
const SOCIAL_SHARE_PLATFORMS = "Douyin or Xiaohongshu / Rednote";

type CaptureMutableControl = {
  element: HTMLElement;
  isDisabled: () => boolean;
  setDisabled: (disabled: boolean) => void;
};

export interface CaptureSourceAccessDraft {
  douyinCookiesPath: string;
  xhsCookiesPath: string;
}

export interface CapturePreflightResult {
  cookieRuntimeRecheck: boolean;
}

export class CaptureModal extends Modal {
  private source = "";
  private tags = "";
  private polish: boolean;
  private suggest: boolean;
  private ocr: CaptureOcrOption;
  private asr: CaptureAsrOption;
  private readonly vaultCustomOcrLanguage: string | null;
  private douyinCookiesPath: string;
  private xhsCookiesPath: string;
  private sourceInput?: HTMLTextAreaElement;
  private dropZone?: HTMLElement;
  private sourceError?: HTMLElement;
  private sourceAccessDetails?: HTMLDetailsElement;
  private sourceAccessStatus?: HTMLElement;
  private readonly cookieInputs: Partial<Record<"douyin" | "xhs", HTMLInputElement>> = {};
  private mutableControls: CaptureMutableControl[] = [];
  private disabledBeforePreflight: Array<{ control: CaptureMutableControl; disabled: boolean }> = [];
  private captureButton?: HTMLButtonElement;
  private preflightController: AbortController | null = null;
  private focusTimer: number | null = null;
  private submitting = false;
  private readonly initialSourceAccess: CaptureSourceAccessDraft;

  constructor(
    app: App,
    initialRequest: CaptureRequest,
    initialSourceAccess: CaptureSourceAccessDraft,
    private readonly languageAvailability: CaptureLanguageAvailability,
    private readonly polishModel: string,
    private readonly onPreflight: (
      request: CaptureRequest,
      cookiesPath: string,
      signal: AbortSignal,
    ) => Promise<CapturePreflightResult | void>,
    private readonly onCapture: (request: CaptureRequest, sourceAccess: CaptureSourceAccessDraft) => Promise<void>,
  ) {
    super(app);
    this.initialSourceAccess = { ...initialSourceAccess };
    this.polish = initialRequest.polish;
    this.suggest = initialRequest.suggest;
    this.source = initialRequest.submittedSource ?? initialRequest.source;
    this.douyinCookiesPath = initialSourceAccess.douyinCookiesPath;
    this.xhsCookiesPath = initialSourceAccess.xhsCookiesPath;
    this.tags = initialRequest.tags.join(", ");
    this.ocr = this.availableOcrOption(initialRequest.ocr);
    this.asr = this.availableAsrOption(initialRequest.asr);
    this.vaultCustomOcrLanguage = this.ocr.mode === "custom" ? this.ocr.language : null;
  }

  onOpen(): void {
    this.contentEl.empty();
    this.mutableControls = [];
    this.disabledBeforePreflight = [];
    this.modalEl.addClass("omd-capture-modal");
    this.titleEl.setText("Capture URL or file");
    this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: `Save a web page, a ${SOCIAL_SHARE_PLATFORMS} share message, or a local file as Markdown.`,
    });
    const sourceSetting = new Setting(this.contentEl)
      .setName("URL, share text, or file path")
      .addTextArea((text) => {
        text.inputEl.addClass("omd-capture-source");
        text.inputEl.setAttribute("aria-label", "URL, share text, or file path");
        text.setPlaceholder("https://… · pasted share text · /Users/…/document.pdf")
          .setValue(this.source)
          .onChange((value) => {
            this.source = value;
            if (this.sourceAccessDetails && this.draftSocialProvider()) {
              this.sourceAccessDetails.open = true;
            }
            this.clearSourceError();
            this.clearSourceAccessStatus();
          });
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || event.isComposing || (!event.metaKey && !event.ctrlKey)) return;
          event.preventDefault();
          void this.submit();
        });
        this.sourceInput = text.inputEl;
        this.trackNativeControl(text.inputEl);
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
      .addText((text) => {
        text.setPlaceholder("Example: inbox, research/calendar")
          .setValue(this.tags)
          .onChange((value) => { this.tags = value; });
        this.trackNativeControl(text.inputEl);
      });
    tagsSetting.settingEl.addClass("omd-capture-tags-setting");

    const sourceAccess = this.contentEl.createEl("details", { cls: "omd-capture-source-access" });
    this.sourceAccessDetails = sourceAccess;
    sourceAccess.open = socialCaptureProvider(this.initialCanonicalSource()) !== null;
    sourceAccess.createEl("summary", { text: "Site access" });
    sourceAccess.createEl("p", {
      cls: "omd-capture-help",
      text: "Local Netscape cookies.txt paths for public posts that require your existing session. Only the path is saved; cookie contents stay inside the local OMD process.",
    });
    this.sourceAccessStatus = sourceAccess.createDiv({
      cls: "omd-capture-access-status",
      attr: { id: CAPTURE_ACCESS_STATUS_ID, role: "status", "aria-live": "polite" },
    });
    this.sourceAccessStatus.hidden = true;
    this.cookiePathSetting(sourceAccess, "douyin", "Douyin cookies", this.douyinCookiesPath, (value) => {
      this.douyinCookiesPath = value;
    });
    this.cookiePathSetting(sourceAccess, "xhs", "Xiaohongshu / Rednote cookies", this.xhsCookiesPath, (value) => {
      this.xhsCookiesPath = value;
    });

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
        this.trackNativeControl(dropdown.selectEl);
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
        this.trackNativeControl(dropdown.selectEl);
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
      .addToggle((toggle) => {
        toggle.setValue(this.polish).onChange((value) => {
          this.polish = value;
        });
        this.trackComponentControl(toggle.toggleEl, (disabled) => { toggle.setDisabled(disabled); });
      });
    const reviewSetting = new Setting(localAi)
      .setName("Review links and tags")
      .setDesc("Suggest links and tags after capture. Review them before applying.")
      .addToggle((toggle) => {
        toggle.setValue(this.suggest).onChange((value) => {
          this.suggest = value;
        });
        this.trackComponentControl(toggle.toggleEl, (disabled) => { toggle.setDisabled(disabled); });
      });
    reviewSetting.settingEl.addClass("omd-capture-section-last");
    const actions = new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => {
        button.setCta().setButtonText("Capture").onClick(() => this.submit());
        this.captureButton = button.buttonEl;
      });
    actions.settingEl.addClass("omd-modal-actions");
  }

  onClose(): void {
    this.preflightController?.abort();
    this.preflightController = null;
    this.setPreflightBusy(false);
    if (this.focusTimer !== null) {
      window.clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    if (this.submitting) return;
    const sourceError = captureSourceInputError(this.source);
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
    const provider = socialCaptureProvider(request.source);
    if (provider) {
      const selectedPath = provider === "douyin" ? this.douyinCookiesPath : this.xhsCookiesPath;
      const pathError = localAccessPathError(selectedPath);
      if (pathError) {
        this.showSourceAccessStatus(pathError, provider);
        return;
      }
    }
    const sourceAccess = {
      douyinCookiesPath: this.validPathOrPrevious(this.douyinCookiesPath, this.initialSourceAccess.douyinCookiesPath),
      xhsCookiesPath: this.validPathOrPrevious(this.xhsCookiesPath, this.initialSourceAccess.xhsCookiesPath),
    };
    if (provider === "douyin") {
      sourceAccess.douyinCookiesPath = normalizeLocalAccessPath(this.douyinCookiesPath);
    } else if (provider === "xhs") {
      sourceAccess.xhsCookiesPath = normalizeLocalAccessPath(this.xhsCookiesPath);
    }
    if (provider && this.sourceAccessDetails) this.sourceAccessDetails.open = true;
    const selectedCookiesPath = provider === "douyin"
      ? sourceAccess.douyinCookiesPath
      : provider === "xhs" ? sourceAccess.xhsCookiesPath : "";
    this.submitting = true;
    this.setPreflightBusy(true);
    if (this.captureButton) {
      this.captureButton.disabled = true;
      this.captureButton.setText("Checking…");
    }
    if (provider) this.showSourceAccessStatus("Checking site access…");
    const preflightController = new AbortController();
    this.preflightController = preflightController;
    let preflightResult: CapturePreflightResult | void;
    try {
      preflightResult = await this.onPreflight(request, selectedCookiesPath, preflightController.signal);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        if (provider) {
          this.showSourceAccessStatus(error instanceof Error ? error.message : "Could not check site access. Try again.");
        } else {
          new Notice(error instanceof Error ? error.message : "Could not check this source. Try again.");
        }
      }
      if (this.preflightController === preflightController) this.preflightController = null;
      this.submitting = false;
      this.setPreflightBusy(false);
      if (this.captureButton) {
        this.captureButton.disabled = false;
        this.captureButton.setText("Capture");
      }
      return;
    }
    if (preflightController.signal.aborted) {
      if (this.preflightController === preflightController) this.preflightController = null;
      this.submitting = false;
      this.setPreflightBusy(false);
      return;
    }
    if (this.preflightController === preflightController) this.preflightController = null;
    if (provider === "xhs" && preflightResult?.cookieRuntimeRecheck) {
      new Notice("Xiaohongshu shortlink access will be checked again after it redirects.");
    }
    this.clearSourceAccessStatus();
    this.setPreflightBusy(false);
    this.close();
    try {
      await this.onCapture(request, sourceAccess);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        new Notice(error instanceof Error ? error.message : "Capture could not start. Try again.");
        this.open();
      }
    } finally {
      this.submitting = false;
    }
  }

  private initialCanonicalSource(): string {
    try {
      return createCaptureRequest({ source: this.source }).source;
    } catch {
      return "";
    }
  }

  private validPathOrPrevious(draft: string, previous: string): string {
    return localAccessPathError(draft) ? previous : normalizeLocalAccessPath(draft);
  }

  private draftSocialProvider(): ReturnType<typeof socialCaptureProvider> {
    return socialCaptureProvider(this.initialCanonicalSource());
  }

  private cookiePathSetting(
    container: HTMLElement,
    provider: "douyin" | "xhs",
    name: string,
    value: string,
    update: (value: string) => void,
  ): void {
    let setDisplayedPath = (_next: string) => {};
    const setting = new Setting(container)
      .setName(name)
      .setDesc("Absolute path to a local cookies.txt file.")
      .addText((text) => {
        text.inputEl.setAttribute("dir", "ltr");
        this.cookieInputs[provider] = text.inputEl;
        this.trackNativeControl(text.inputEl);
        setDisplayedPath = (next) => { text.setValue(next); };
        text.setPlaceholder("/Users/…/cookies.txt")
          .setValue(value)
          .onChange((next) => {
            update(next);
            this.clearSourceAccessStatus();
          });
      });
    if (value) {
      setting.addButton((button) => {
        button.setButtonText("Clear").onClick(() => {
          update("");
          setDisplayedPath("");
          button.buttonEl.remove();
          this.clearSourceAccessStatus();
        });
        this.trackNativeControl(button.buttonEl);
      });
    }
  }

  private showSourceError(message: string): void {
    this.sourceError?.setText(message);
    if (this.sourceError) this.sourceError.hidden = false;
    this.sourceInput?.setAttribute("aria-invalid", "true");
    this.sourceInput?.focus();
  }

  private clearSourceError(): void {
    if (this.sourceError) this.sourceError.hidden = true;
    this.sourceInput?.removeAttribute("aria-invalid");
  }

  private showSourceAccessStatus(message: string, invalidProvider?: "douyin" | "xhs"): void {
    if (this.sourceAccessDetails) this.sourceAccessDetails.open = true;
    this.sourceAccessStatus?.setText(message);
    if (this.sourceAccessStatus) this.sourceAccessStatus.hidden = false;
    if (!invalidProvider) return;
    const input = this.cookieInputs[invalidProvider];
    input?.setAttribute("aria-invalid", "true");
    input?.setAttribute("aria-describedby", CAPTURE_ACCESS_STATUS_ID);
    input?.focus();
  }

  private clearSourceAccessStatus(): void {
    if (this.sourceAccessStatus) {
      this.sourceAccessStatus.hidden = true;
      this.sourceAccessStatus.setText("");
    }
    for (const input of Object.values(this.cookieInputs)) {
      input?.removeAttribute("aria-invalid");
      input?.removeAttribute("aria-describedby");
    }
  }

  private trackNativeControl(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement,
  ): void {
    this.mutableControls.push({
      element,
      isDisabled: () => element.disabled,
      setDisabled: (disabled) => { element.disabled = disabled; },
    });
  }

  private trackComponentControl(element: HTMLElement, setDisabled: (disabled: boolean) => void): void {
    this.mutableControls.push({ element, isDisabled: () => false, setDisabled });
  }

  private setPreflightBusy(busy: boolean): void {
    if (busy) {
      if (this.disabledBeforePreflight.length) return;
      this.modalEl.setAttribute("aria-busy", "true");
      this.dropZone?.setAttribute("aria-disabled", "true");
      this.disabledBeforePreflight = this.mutableControls.map((control) => ({
        control,
        disabled: control.isDisabled(),
      }));
      for (const { control } of this.disabledBeforePreflight) control.setDisabled(true);
      return;
    }
    this.modalEl.removeAttribute("aria-busy");
    this.dropZone?.removeAttribute("aria-disabled");
    for (const { control, disabled } of this.disabledBeforePreflight) control.setDisabled(disabled);
    this.disabledBeforePreflight = [];
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
      if (this.submitting) return;
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
