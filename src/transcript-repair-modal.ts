import { Modal, Setting, type App, type ButtonComponent } from "obsidian";
import type {
  ReplacementTranscriptSegment,
  TranscriptRepairIssue,
  TranscriptRepairLanguage,
  TranscriptRepairRange,
} from "./transcript-repair.ts";

export type TranscriptRepairApplyResult = "applied" | "conflict" | "no-op";

export interface TranscriptRepairPreparedMedia {
  readonly source: string;
  readonly durationSeconds: number;
}

export interface TranscriptRepairRetranscription {
  readonly segments: readonly ReplacementTranscriptSegment[];
  readonly language: string | null;
  readonly chunkLanguages: readonly string[];
  readonly qualityWarnings: readonly string[];
  readonly suspectIntervals: readonly {
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly reasons: readonly string[];
  }[];
  readonly safeToApply: boolean;
  readonly contextStartSeconds: number;
  readonly contextEndSeconds: number;
}

export interface TranscriptRepairApplyOutcome {
  readonly result: TranscriptRepairApplyResult;
  readonly backupPath?: string;
}

export interface TranscriptRepairModalActions {
  readonly prepareMedia: (signal: AbortSignal) => Promise<TranscriptRepairPreparedMedia>;
  readonly retranscribeRange: (
    range: TranscriptRepairRange,
    language: TranscriptRepairLanguage,
    signal: AbortSignal,
  ) => Promise<TranscriptRepairRetranscription>;
  readonly applyRange: (
    range: TranscriptRepairRange,
    segments: readonly ReplacementTranscriptSegment[],
  ) => Promise<TranscriptRepairApplyOutcome>;
  readonly applyInvalidTail: () => Promise<TranscriptRepairApplyOutcome>;
  readonly keepOriginal: () => void;
  readonly closed: () => void;
}

const RANGE_STEP_SECONDS = 0.1;
const MINIMUM_RANGE_SECONDS = 0.5;
let transcriptRepairModalSequence = 0;

export class TranscriptRepairModal extends Modal {
  private invalidTailButton?: ButtonComponent;
  private closeButton?: ButtonComponent;
  private statusEl?: HTMLElement;
  private tailPreviewEl?: HTMLElement;
  private mediaSection?: HTMLElement;
  private rangeControlsEl?: HTMLElement;
  private selectionSummaryEl?: HTMLElement;
  private startInput?: HTMLInputElement;
  private endInput?: HTMLInputElement;
  private languageSelect?: HTMLSelectElement;
  private audioEl?: HTMLAudioElement;
  private transcriptRows: Array<{ element: HTMLElement; start: number; end: number }> = [];
  private retranscribeButton?: HTMLButtonElement;
  private applyRangeButton?: HTMLButtonElement;
  private comparisonHostEl?: HTMLElement;
  private comparisonEl?: HTMLElement;
  private selectedRange: TranscriptRepairRange | null = null;
  private retranscription: TranscriptRepairRetranscription | null = null;
  private preparedMedia: TranscriptRepairPreparedMedia | null = null;
  private applying = false;
  private tailPreviewVisible = false;
  private closed = false;
  private playingSelection = false;
  private readonly operationController = new AbortController();
  private readonly tailPreviewHeadingId = `omd-transcript-tail-preview-${++transcriptRepairModalSequence}`;

  constructor(
    app: App,
    private readonly noteName: string,
    private readonly issue: TranscriptRepairIssue,
    private readonly actions: TranscriptRepairModalActions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("omd-transcript-repair-modal");
    this.titleEl.setText("Review and repair transcript");
    this.contentEl.createEl("p", {
      cls: "omd-modal-intro",
      text: "Review the highlighted interval with the original audio. OMD changes only the range you approve and saves a full transcript backup before applying it.",
    });
    this.statusEl = this.contentEl.createDiv({
      cls: "omd-transcript-repair-status",
      text: this.issue.message,
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });

    const details = this.contentEl.createEl("dl", { cls: "omd-transcript-repair-details" });
    details.createEl("dt", { text: "Note" });
    details.createEl("dd", { text: this.noteName, attr: { dir: "auto" } });
    if (this.issue.sourceDurationSeconds !== null) {
      details.createEl("dt", { text: "Source duration" });
      details.createEl("dd", { text: formatTimestamp(this.issue.sourceDurationSeconds) });
    }
    if (this.issue.transcriptEndSeconds !== null) {
      details.createEl("dt", { text: "Transcript end" });
      details.createEl("dd", { text: formatTimestamp(this.issue.transcriptEndSeconds) });
    }

    this.mediaSection = this.contentEl.createEl("section", {
      cls: "omd-transcript-repair-media",
      attr: { "aria-label": "Synchronized transcript review" },
    });
    this.mediaSection.createEl("h3", { text: "Original audio and transcript" });
    this.mediaSection.createEl("p", {
      cls: "omd-transcript-repair-help",
      text: "Preparing the source locally. Remote captures may be downloaded again with your saved local access settings.",
    });

    this.createInvalidTailPreview();
    this.createFooterActions();
    void this.prepareMedia();
  }

  showConflict(message: string): void {
    this.applying = false;
    this.setStatus(message, "is-conflict", true);
    this.setRangeButtonsDisabled(true);
    if (this.invalidTailButton) {
      this.invalidTailButton.setButtonText("Apply repair");
      this.invalidTailButton.setDisabled(true);
    }
    this.closeButton?.buttonEl.focus();
    this.statusEl?.scrollIntoView({ block: "center" });
  }

  showFailure(message: string): void {
    this.applying = false;
    this.setStatus(message, "is-error", true);
    this.setRangeButtonsDisabled(false);
    if (this.invalidTailButton) {
      this.invalidTailButton.setButtonText(this.tailPreviewVisible ? "Apply repair" : "Remove invalid tail");
      this.invalidTailButton.setDisabled(false);
    }
  }

  onClose(): void {
    this.operationController.abort();
    this.audioEl?.pause();
    if (this.audioEl) this.audioEl.removeAttribute("src");
    this.contentEl.empty();
    if (this.closed) return;
    this.closed = true;
    this.actions.closed();
  }

  private createInvalidTailPreview(): void {
    if (!this.issue.invalidTail) return;
    this.tailPreviewEl = this.contentEl.createEl("section", {
      cls: "omd-transcript-repair-preview omd-transcript-tail-preview",
      attr: { role: "region", "aria-labelledby": this.tailPreviewHeadingId },
    });
    this.tailPreviewEl.hidden = true;
    this.tailPreviewEl.createEl("h3", {
      text: "Text proposed for removal",
      attr: { id: this.tailPreviewHeadingId },
    });
    this.tailPreviewEl.createEl("p", {
      text: `${this.issue.invalidTail.segmentCount} repeated timestamped segments from ${formatTimestamp(this.issue.invalidTail.startSeconds)} to ${formatTimestamp(this.issue.invalidTail.transcriptEndSeconds)} are beyond the verified media duration.`,
    });
    const preview = this.tailPreviewEl.createEl("pre", { attr: { tabindex: "0" } });
    preview.createEl("code", {
      text: this.issue.invalidTail.segmentLines.join("\n"),
      attr: { dir: "auto" },
    });
  }

  private createFooterActions(): void {
    const actions = new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText("Close").onClick(() => this.close());
        this.closeButton = button;
      })
      .addButton((button) => button
        .setButtonText("Keep original")
        .onClick(() => {
          this.actions.keepOriginal();
          this.close();
        }));
    if (this.issue.invalidTail) {
      actions.addButton((button) => {
        button.setCta().setButtonText("Remove invalid tail").onClick(() => void this.handleInvalidTailAction());
        this.invalidTailButton = button;
      });
    }
    actions.settingEl.addClass("omd-modal-actions");
  }

  private async prepareMedia(): Promise<void> {
    if (!this.mediaSection) return;
    this.setStatus("Preparing the original audio locally…", "is-active");
    try {
      const media = await this.actions.prepareMedia(this.operationController.signal);
      if (this.closed || this.operationController.signal.aborted) return;
      this.preparedMedia = media;
      this.renderMediaReview(media);
      const suggested = this.issue.suggestedRange;
      if (suggested && suggested.reason !== "invalid-tail") {
        this.setStatus(
          `OMD highlighted ${formatTimestamp(suggested.startSeconds)}–${formatTimestamp(suggested.endSeconds)} as the likely incomplete interval. Review or adjust it before re-transcribing.`,
          "is-reviewing",
        );
      } else {
        this.setStatus(
          this.issue.invalidTail
            ? "The invalid tail is highlighted below. You can verify it against the audio, then remove only the proven suffix."
            : "OMD could not prove one exact abnormal interval. Review the transcript and choose a range before re-transcribing.",
          "is-reviewing",
        );
      }
    } catch (error) {
      if (this.operationController.signal.aborted) return;
      this.mediaSection.empty();
      this.mediaSection.createEl("h3", { text: "Original audio unavailable" });
      this.mediaSection.createEl("p", {
        cls: "omd-transcript-repair-help",
        text: "The note is unchanged. Reconnect the original file or capture access and reopen this review. A proven invalid tail can still be removed below.",
      });
      this.showFailure(errorMessage(error, "Could not prepare the original audio for review. The note was not changed."));
    }
  }

  private renderMediaReview(media: TranscriptRepairPreparedMedia): void {
    if (!this.mediaSection) return;
    this.mediaSection.empty();
    this.mediaSection.createEl("h3", { text: "Original audio and transcript" });
    this.mediaSection.createEl("p", {
      cls: "omd-transcript-repair-help",
      text: "Click a transcript row to seek the player. The selected interval is highlighted; playback and re-transcription stay on this computer.",
    });
    this.audioEl = this.mediaSection.createEl("audio", {
      cls: "omd-transcript-repair-player",
      attr: { controls: "", preload: "metadata", src: media.source },
    });
    this.audioEl.addEventListener("timeupdate", () => {
      this.updateTranscriptHighlights();
      if (this.playingSelection && this.selectedRange && this.audioEl
        && this.audioEl.currentTime >= this.selectedRange.endSeconds) {
        this.playingSelection = false;
        this.audioEl.pause();
      }
    });

    const reviewGrid = this.mediaSection.createDiv({ cls: "omd-transcript-repair-review-grid" });
    this.rangeControlsEl = reviewGrid.createEl("section", { cls: "omd-transcript-repair-range" });
    this.rangeControlsEl.createEl("h4", { text: "Repair interval" });
    this.selectionSummaryEl = this.rangeControlsEl.createEl("p", {
      cls: "omd-transcript-repair-selection-summary",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.createRangeInputs(media.durationSeconds);
    this.createRangeActions();
    this.createTranscriptList(reviewGrid);
    this.comparisonHostEl = this.mediaSection.createDiv({
      cls: "omd-transcript-repair-comparison-host",
    });

    const suggested = this.issue.suggestedRange?.reason === "invalid-tail"
      ? null
      : this.issue.suggestedRange;
    const fallbackEnd = Math.min(media.durationSeconds, Math.max(
      this.issue.transcriptEndSeconds ?? 0,
      Math.min(media.durationSeconds, 30),
    ));
    this.setSelection(
      suggested?.startSeconds ?? 0,
      suggested?.endSeconds ?? Math.max(MINIMUM_RANGE_SECONDS, fallbackEnd),
      suggested?.reason ?? "manual-review",
      false,
    );
  }

  private createRangeInputs(durationSeconds: number): void {
    if (!this.rangeControlsEl) return;
    const sliders = this.rangeControlsEl.createDiv({ cls: "omd-transcript-repair-sliders" });
    const startLabel = sliders.createEl("label", { cls: "omd-transcript-repair-slider" });
    startLabel.createSpan({ text: "Start" });
    this.startInput = startLabel.createEl("input", {
      type: "range",
      attr: {
        min: "0",
        max: String(durationSeconds),
        step: String(RANGE_STEP_SECONDS),
        "aria-label": "Repair interval start",
      },
    });
    const endLabel = sliders.createEl("label", { cls: "omd-transcript-repair-slider" });
    endLabel.createSpan({ text: "End" });
    this.endInput = endLabel.createEl("input", {
      type: "range",
      attr: {
        min: "0",
        max: String(durationSeconds),
        step: String(RANGE_STEP_SECONDS),
        "aria-label": "Repair interval end",
      },
    });
    this.startInput.addEventListener("input", () => this.handleRangeInput("start"));
    this.endInput.addEventListener("input", () => this.handleRangeInput("end"));
  }

  private createRangeActions(): void {
    if (!this.rangeControlsEl) return;
    const shortcuts = this.rangeControlsEl.createDiv({ cls: "omd-transcript-repair-shortcuts" });
    this.createActionButton(shortcuts, "Set start to player", () => {
      if (!this.audioEl || !this.selectedRange) return;
      this.setSelection(this.audioEl.currentTime, this.selectedRange.endSeconds, "manual-review");
    });
    this.createActionButton(shortcuts, "Set end to player", () => {
      if (!this.audioEl || !this.selectedRange) return;
      this.setSelection(this.selectedRange.startSeconds, this.audioEl.currentTime, "manual-review");
    });
    this.createActionButton(shortcuts, "From here to end", () => {
      if (!this.audioEl || !this.preparedMedia) return;
      this.setSelection(this.audioEl.currentTime, this.preparedMedia.durationSeconds, "manual-review");
    });
    this.createActionButton(shortcuts, "Play selected range", () => void this.playSelectedRange());

    const language = this.rangeControlsEl.createDiv({ cls: "omd-transcript-repair-language" });
    const languageLabel = language.createEl("label");
    languageLabel.createSpan({ text: "Recognition language" });
    this.languageSelect = languageLabel.createEl("select", {
      attr: { "aria-label": "Recognition language for this repair" },
    });
    this.languageSelect.createEl("option", { text: "Auto-detect per chunk", attr: { value: "auto" } });
    this.languageSelect.createEl("option", { text: "Chinese", attr: { value: "zh" } });
    this.languageSelect.createEl("option", { text: "English", attr: { value: "en" } });
    this.languageSelect.value = this.issue.requestedLanguage;
    this.languageSelect.addEventListener("change", () => {
      this.clearRetranscriptionPreview();
      if (this.retranscribeButton) this.retranscribeButton.textContent = "Re-transcribe selected range";
    });
    language.createEl("p", {
      text: "Auto-detect runs independently for each 25-second chunk. Choose a language to retry a difficult interval.",
    });

    this.rangeControlsEl.createEl("p", {
      cls: "omd-transcript-repair-context-note",
      text: "Boundaries snap to timestamp rows where text already exists. Re-transcription adds 8 seconds of local context before and after this interval for smoother joins. Only the selected interval can be applied.",
    });
    this.retranscribeButton = this.createActionButton(
      this.rangeControlsEl,
      "Re-transcribe selected range",
      () => void this.retranscribeSelectedRange(),
      true,
    );
  }

  private createTranscriptList(container: HTMLElement): void {
    const section = container.createEl("section", { cls: "omd-transcript-repair-transcript" });
    section.createEl("h4", { text: "Timestamped transcript" });
    const list = section.createDiv({
      cls: "omd-transcript-repair-segments",
      attr: { role: "list", tabindex: "0" },
    });
    if (!this.issue.segments.length) {
      list.createEl("p", {
        cls: "omd-transcript-repair-empty",
        text: "No timestamped rows are available. Use the player to mark the incomplete interval.",
      });
      return;
    }
    this.transcriptRows = this.issue.segments.map((segment) => {
      const row = list.createEl("button", {
        cls: "omd-transcript-repair-segment",
        attr: { type: "button", role: "listitem", "data-start": String(segment.start) },
      });
      row.createSpan({
        cls: "omd-transcript-repair-segment-time",
        text: `${formatTimestamp(segment.start)}–${formatTimestamp(segment.end)}`,
      });
      row.createSpan({ cls: "omd-transcript-repair-segment-text", text: segment.text, attr: { dir: "auto" } });
      row.addEventListener("click", () => {
        if (!this.audioEl) return;
        this.audioEl.currentTime = Math.min(segment.start, this.preparedMedia?.durationSeconds ?? segment.start);
        this.updateTranscriptHighlights();
      });
      return { element: row, start: segment.start, end: segment.end };
    });
  }

  private handleRangeInput(changed: "start" | "end"): void {
    if (!this.startInput || !this.endInput) return;
    const start = Number(this.startInput.value);
    const end = Number(this.endInput.value);
    if (changed === "start") {
      this.setSelection(start, Math.max(end, start + MINIMUM_RANGE_SECONDS), "manual-review");
    } else {
      this.setSelection(Math.min(start, end - MINIMUM_RANGE_SECONDS), end, "manual-review");
    }
  }

  private setSelection(
    startSeconds: number,
    endSeconds: number,
    reason: TranscriptRepairRange["reason"],
    clearPreview = true,
  ): void {
    if (!this.preparedMedia || !this.startInput || !this.endInput) return;
    const duration = this.preparedMedia.durationSeconds;
    let start = clamp(startSeconds, 0, Math.max(0, duration - MINIMUM_RANGE_SECONDS));
    let end = clamp(endSeconds, start + MINIMUM_RANGE_SECONDS, duration);
    const startSegment = this.issue.segments.find((segment) => segment.start < start && segment.end > start);
    const endSegment = this.issue.segments.find((segment) => segment.start < end && segment.end > end);
    if (startSegment) start = startSegment.start;
    if (endSegment) end = endSegment.end;
    start = clamp(start, 0, Math.max(0, duration - MINIMUM_RANGE_SECONDS));
    end = clamp(end, start + MINIMUM_RANGE_SECONDS, duration);
    this.selectedRange = { startSeconds: start, endSeconds: end, reason };
    this.startInput.value = String(start);
    this.endInput.value = String(end);
    if (this.selectionSummaryEl) {
      this.selectionSummaryEl.setText(`${formatTimestampPrecise(start)} → ${formatTimestampPrecise(end)} · ${formatDuration(end - start)}`);
    }
    this.updateTranscriptHighlights();
    if (clearPreview) this.clearRetranscriptionPreview();
  }

  private updateTranscriptHighlights(): void {
    const range = this.selectedRange;
    const currentTime = this.audioEl?.currentTime ?? -1;
    for (const row of this.transcriptRows) {
      row.element.classList.toggle("is-selected", Boolean(range && row.end > range.startSeconds && row.start < range.endSeconds));
      row.element.classList.toggle("is-playing", currentTime >= row.start && currentTime < row.end);
    }
  }

  private async playSelectedRange(): Promise<void> {
    if (!this.audioEl || !this.selectedRange) return;
    this.audioEl.currentTime = this.selectedRange.startSeconds;
    this.playingSelection = true;
    try {
      await this.audioEl.play();
    } catch (error) {
      this.playingSelection = false;
      this.showFailure(errorMessage(error, "The original audio could not be played. The note was not changed."));
    }
  }

  private async retranscribeSelectedRange(): Promise<void> {
    if (!this.selectedRange || !this.retranscribeButton || this.applying) return;
    this.applying = true;
    this.setRangeButtonsDisabled(true);
    this.retranscribeButton.textContent = "Re-transcribing locally…";
    const language = this.selectedRepairLanguage();
    this.setStatus(
      `Re-transcribing ${formatTimestamp(this.selectedRange.startSeconds)}–${formatTimestamp(this.selectedRange.endSeconds)} in 25-second chunks with ${repairLanguageLabel(language)} and 8 seconds of local context…`,
      "is-active",
    );
    try {
      const result = await this.actions.retranscribeRange(
        this.selectedRange,
        language,
        this.operationController.signal,
      );
      if (this.closed || this.operationController.signal.aborted) return;
      this.retranscription = result;
      this.renderComparison(result);
      if (result.safeToApply) {
        this.setStatus(
          `Preview ready. Compare the old and new text below. Context ${formatTimestamp(result.contextStartSeconds)}–${formatTimestamp(result.contextEndSeconds)} was used only for local recognition.`,
          "is-reviewing",
        );
      } else {
        this.setStatus(
          "The local transcript has quality warnings. Suspect lines are highlighted and Replace selected range is disabled. Adjust the range or retry with Auto, Chinese, or English.",
          "is-error",
          true,
        );
      }
    } catch (error) {
      if (!this.operationController.signal.aborted) {
        this.showFailure(errorMessage(error, "Could not re-transcribe the selected range. The note was not changed."));
      }
    } finally {
      this.applying = false;
      if (this.retranscribeButton) {
        this.retranscribeButton.textContent = this.retranscription?.safeToApply === false
          ? "Retry with selected language"
          : "Re-transcribe selected range";
      }
      this.setRangeButtonsDisabled(false);
    }
  }

  private renderComparison(result: TranscriptRepairRetranscription): void {
    this.comparisonEl?.remove();
    if (!this.comparisonHostEl || !this.selectedRange) return;
    this.comparisonEl = this.comparisonHostEl.createEl("section", {
      cls: "omd-transcript-repair-comparison",
      attr: { "aria-label": "Old and new transcript preview" },
    });
    this.comparisonEl.createEl("h4", { text: "Replacement preview" });
    if (result.qualityWarnings.length || result.suspectIntervals.length) {
      const warning = this.comparisonEl.createDiv({
        cls: "omd-transcript-repair-quality-warning",
        attr: { role: "alert" },
      });
      warning.createEl("strong", { text: "Review required before replacement" });
      if (result.qualityWarnings.length) {
        const list = warning.createEl("ul");
        for (const item of result.qualityWarnings) list.createEl("li", { text: item });
      }
      if (result.chunkLanguages.length) {
        warning.createEl("p", {
          text: `Chunk languages: ${result.chunkLanguages.map(languageName).join(", ")}.`,
        });
      }
    }
    const panes = this.comparisonEl.createDiv({ cls: "omd-transcript-repair-comparison-grid" });
    const oldPane = panes.createEl("section");
    oldPane.createEl("h5", { text: "Current text" });
    oldPane.createEl("pre", {
      text: this.oldTextForRange(this.selectedRange),
      attr: { tabindex: "0", dir: "auto" },
    });
    const newPane = panes.createEl("section");
    newPane.createEl("h5", { text: "New local transcript" });
    const preview = newPane.createDiv({
      cls: "omd-transcript-repair-preview-lines",
      attr: { tabindex: "0", role: "list", "aria-label": "New local transcript" },
    });
    for (const segment of result.segments) {
      const suspect = result.suspectIntervals.find((interval) => (
        segment.end > interval.startSeconds && segment.start < interval.endSeconds
      ));
      const line = preview.createDiv({
        cls: "omd-transcript-repair-preview-line",
        attr: { role: "listitem", dir: "auto" },
      });
      if (suspect) {
        line.addClass("is-suspect");
        line.setAttr("title", suspect.reasons.join(" "));
      }
      line.createSpan({
        cls: "omd-transcript-repair-preview-time",
        text: `${formatTimestampPrecise(segment.start)}–${formatTimestampPrecise(segment.end)}`,
      });
      line.createSpan({ text: segment.text });
    }
    this.applyRangeButton = this.createActionButton(
      this.comparisonEl,
      "Replace selected range",
      () => void this.applySelectedRange(),
      true,
    );
    this.applyRangeButton.disabled = !result.safeToApply;
    if (!result.safeToApply) {
      this.applyRangeButton.setAttribute("title", "Resolve transcript quality warnings before replacing this range.");
      this.retranscribeButton?.focus();
    } else {
      this.applyRangeButton.focus();
    }
  }

  private oldTextForRange(range: TranscriptRepairRange): string {
    const lines = this.issue.segments
      .filter((segment) => segment.end > range.startSeconds && segment.start < range.endSeconds)
      .map((segment) => `${formatTimestampPrecise(segment.start)}–${formatTimestampPrecise(segment.end)}  ${segment.text}`);
    return lines.length ? lines.join("\n") : "No timestamped text currently exists in this interval.";
  }

  private clearRetranscriptionPreview(): void {
    this.retranscription = null;
    this.comparisonEl?.remove();
    this.comparisonEl = undefined;
    this.applyRangeButton = undefined;
  }

  private async applySelectedRange(): Promise<void> {
    if (!this.selectedRange || !this.retranscription || !this.retranscription.safeToApply
      || !this.applyRangeButton || this.applying) return;
    let lockAfterConflict = false;
    this.applying = true;
    this.setRangeButtonsDisabled(true);
    this.applyRangeButton.textContent = "Checking and saving backup…";
    this.setStatus("Checking that the note has not changed and saving the original transcript backup…", "is-active");
    try {
      const outcome = await this.actions.applyRange(this.selectedRange, this.retranscription.segments);
      if (outcome.result === "applied") {
        this.close();
        return;
      }
      if (outcome.result === "conflict") {
        lockAfterConflict = true;
        this.showConflict("The note changed after this replacement preview was created. Nothing was replaced. Close and reopen Review and repair transcript.");
        return;
      }
      this.setStatus("The selected range already matches the preview. The note was not changed.", "is-no-changes");
    } catch (error) {
      this.showFailure(errorMessage(error, "Could not apply this transcript repair. The note was not changed."));
    } finally {
      this.applying = false;
      if (this.applyRangeButton) this.applyRangeButton.textContent = "Replace selected range";
      if (!lockAfterConflict) this.setRangeButtonsDisabled(false);
    }
  }

  private async handleInvalidTailAction(): Promise<void> {
    if (this.applying || !this.invalidTailButton || !this.tailPreviewEl) return;
    if (!this.tailPreviewVisible) {
      this.tailPreviewVisible = true;
      this.tailPreviewEl.hidden = false;
      this.invalidTailButton.setButtonText("Apply repair");
      this.setStatus("Review the proven invalid tail below. Apply repair removes only this suffix; the note remains unchanged until then.", "is-reviewing");
      this.tailPreviewEl.querySelector<HTMLElement>("pre")?.focus();
      return;
    }

    this.applying = true;
    this.invalidTailButton.setDisabled(true);
    this.setStatus("Checking that the note has not changed and saving the original transcript backup…", "is-active");
    try {
      const outcome = await this.actions.applyInvalidTail();
      if (outcome.result === "applied") {
        this.close();
        return;
      }
      if (outcome.result === "conflict") {
        this.showConflict("The note changed after this repair preview was created. Nothing was removed. Close and reopen Review and repair transcript.");
        return;
      }
      this.setStatus("No repair was needed. The note was not changed.", "is-no-changes");
      this.invalidTailButton.setButtonText("Apply repair");
      this.invalidTailButton.setDisabled(true);
    } catch (error) {
      this.showFailure(errorMessage(error, "Could not apply this transcript repair. The note was not changed."));
    } finally {
      this.applying = false;
    }
  }

  private setRangeButtonsDisabled(disabled: boolean): void {
    if (this.startInput) this.startInput.disabled = disabled;
    if (this.endInput) this.endInput.disabled = disabled;
    if (this.languageSelect) this.languageSelect.disabled = disabled;
    if (this.retranscribeButton) this.retranscribeButton.disabled = disabled;
    if (this.applyRangeButton) {
      this.applyRangeButton.disabled = disabled || this.retranscription?.safeToApply === false;
    }
  }

  private selectedRepairLanguage(): TranscriptRepairLanguage {
    const language = this.languageSelect?.value;
    return language === "en" || language === "zh" ? language : "auto";
  }

  private createActionButton(
    container: HTMLElement,
    label: string,
    onClick: () => void,
    cta = false,
  ): HTMLButtonElement {
    const button = container.createEl("button", {
      cls: cta ? "mod-cta" : undefined,
      text: label,
      attr: { type: "button" },
    });
    button.addEventListener("click", onClick);
    return button;
  }

  private setStatus(message: string, state: string, assertive = false): void {
    if (!this.statusEl) return;
    this.statusEl.removeClass("is-active");
    this.statusEl.removeClass("is-reviewing");
    this.statusEl.removeClass("is-conflict");
    this.statusEl.removeClass("is-error");
    this.statusEl.removeClass("is-no-changes");
    this.statusEl.addClass(state);
    this.statusEl.setAttr("role", assertive ? "alert" : "status");
    this.statusEl.setAttr("aria-live", assertive ? "assertive" : "polite");
    this.statusEl.setText(message);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function repairLanguageLabel(language: TranscriptRepairLanguage): string {
  if (language === "zh") return "Chinese recognition";
  if (language === "en") return "English recognition";
  return "per-chunk auto-detection";
}

function languageName(language: string): string {
  if (language.toLowerCase().startsWith("zh")) return "Chinese";
  if (language.toLowerCase().startsWith("en")) return "English";
  return language;
}

function formatDuration(seconds: number): string {
  return `${Number(seconds.toFixed(1))}s selected`;
}

function formatTimestampPrecise(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const whole = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return `${formatTimestamp(whole)}.${decimal}`;
}

function formatTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainder = rounded % 60;
  const parts = hours > 0
    ? [hours, minutes.toString().padStart(2, "0"), remainder.toString().padStart(2, "0")]
    : [minutes, remainder.toString().padStart(2, "0")];
  return parts.join(":");
}
