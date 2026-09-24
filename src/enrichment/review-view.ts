import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import {
  canApplyEnrichment,
  createEnrichmentSelection,
  describeEnrichmentPhase,
  enrichmentSummaryValidation,
  reconcileEnrichmentSelection,
  selectedEnrichmentCount,
  selectedSuggestions,
  stageRailItems,
  toggleEnrichmentSelection,
  updateEnrichmentSummarySelection,
  type EnrichmentReviewState,
  type EnrichmentSelection,
  type EnrichmentSuggestion,
} from "./workflow.ts";

export interface EnrichmentApplyPayload {
  state: EnrichmentReviewState;
  selection: EnrichmentSelection;
  selectedSuggestions: EnrichmentSuggestion[];
}

export interface EnrichmentReviewViewCallbacks {
  onGenerate: () => void | Promise<void>;
  onCancelGeneration: () => void | Promise<void>;
  onApply: (payload: EnrichmentApplyPayload) => void | Promise<void>;
  onDoneReviewing: () => void | Promise<void>;
  onClose: () => void;
  onOpenPath?: (path: string) => void | Promise<void>;
}

export const ENRICHMENT_REVIEW_VIEW_TYPE = "omd-home-enrichment-review";

export class EnrichmentReviewView extends ItemView {
  private state: EnrichmentReviewState | null = null;
  private selection: EnrichmentSelection = emptySelection();
  private callbacks: EnrichmentReviewViewCallbacks | null = null;
  private focusTimer: number | null = null;
  private focusNextRender = true;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return ENRICHMENT_REVIEW_VIEW_TYPE; }
  getDisplayText(): string { return "OMD review"; }
  getIcon(): string { return "list-checks"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("omd-enrichment-view");
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.focusTimer !== null) {
      window.clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
    const callbacks = this.callbacks;
    this.callbacks = null;
    this.state = null;
    this.selection = emptySelection();
    this.contentEl.empty();
    callbacks?.onClose();
  }

  bindTarget(state: EnrichmentReviewState, callbacks: EnrichmentReviewViewCallbacks): void {
    this.state = state;
    this.selection = createEnrichmentSelection(state);
    this.callbacks = callbacks;
    this.focusNextRender = true;
    this.render();
  }

  updateState(state: EnrichmentReviewState): void {
    if (state.targetPath !== this.state?.targetPath) return;
    if (state.phase !== this.state?.phase) this.focusNextRender = true;
    this.state = state;
    this.selection = reconcileEnrichmentSelection(state, this.selection);
    if (this.contentEl.isConnected) this.render();
  }

  getReviewState(): EnrichmentReviewState | null {
    return this.state;
  }

  closeReview(): void {
    this.leaf.detach();
  }

  private render(): void {
    if (!this.state || !this.callbacks) {
      this.renderEmpty();
      return;
    }
    if (this.focusTimer !== null) window.clearTimeout(this.focusTimer);
    const focusKey = this.currentFocusKey();
    const scrollTop = this.focusNextRender
      ? 0
      : this.contentEl.querySelector<HTMLElement>(".omd-enrichment-scroll")?.scrollTop ?? 0;
    this.contentEl.empty();
    const shell = this.contentEl.createDiv({ cls: "omd-enrichment-shell" });
    const scroll = shell.createDiv({ cls: "omd-enrichment-scroll" });
    const phase = describeEnrichmentPhase(this.state.phase);
    const header = scroll.createDiv({ cls: "omd-enrichment-header" });
    const title = header.createDiv({ cls: "omd-enrichment-title-block" });
    title.createSpan({ cls: "omd-enrichment-eyebrow", text: "OMD ENRICHMENT" });
    title.createEl("h2", { text: phase.title });
    title.createEl("p", { cls: "omd-enrichment-subtitle", text: this.state.detailText || phase.detail });

    const meta = header.createDiv({ cls: "omd-enrichment-meta" });
    this.renderMeta(meta, "Target", this.state.targetPath);
    this.renderMeta(meta, "Model", this.state.model);
    this.renderMeta(meta, "Endpoint", this.state.endpoint);

    const stages = header.createDiv({ cls: "omd-enrichment-stages", attr: { "aria-label": "Enrichment progress" } });
    for (const stage of stageRailItems(this.state.phase)) {
      stages.createSpan({
        cls: `omd-enrichment-stage tone-${stage.tone}${stage.active ? " is-active" : ""}`,
        text: stage.label,
      });
    }

    const generating = this.state.phase === "capability" || this.state.phase === "catalog" || this.state.phase === "generating";
    const status = scroll.createDiv({
      cls: "omd-enrichment-status",
      attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
    });
    const statusBadge = status.createSpan({
      cls: `omd-enrichment-status-badge tone-${phase.tone}${generating ? " omd-enrichment-status-badge--loading" : ""}`,
    });
    if (generating) statusBadge.createSpan({
      cls: "omd-enrichment-loading-indicator",
      attr: { "aria-hidden": "true" },
    });
    statusBadge.createSpan({
      cls: "omd-enrichment-status-label",
      text: generating ? "Generating suggestions… Please wait." : phase.title,
    });
    status.createSpan({ cls: "omd-enrichment-status-copy", text: this.state.statusText || phase.detail });
    if (this.state.phase === "reviewed") {
      status.createSpan({ cls: "omd-enrichment-workflow-status", text: "Status · Reviewed" });
    } else {
      status.createSpan({ cls: "omd-enrichment-workflow-status", text: "Status · Inbox" });
    }

    if (showsProposal(this.state)) this.renderProposal(scroll);
    else if (this.state.warnings.length) this.renderWarnings(scroll, this.state.warnings);

    const footer = shell.createDiv({ cls: "omd-enrichment-footer" });
    const footerCopy = footer.createDiv({ cls: "omd-enrichment-footer-copy" });
    const counts = selectedEnrichmentCount(this.state, this.selection);
    footerCopy.createDiv({
      cls: "omd-enrichment-count",
      text: showsProposal(this.state) ? selectionCountText(this.state, this.selection, counts) : phase.title,
    });
    footerCopy.createDiv({ cls: "omd-enrichment-footer-note", text: footerNote(this.state) });
    this.renderActions(footer.createDiv({ cls: "omd-enrichment-actions" }));
    scroll.scrollTop = scrollTop;
    if (focusKey || this.focusNextRender) {
      this.focusNextRender = false;
      this.focusTimer = window.setTimeout(() => {
        this.focusTimer = null;
        const preserved = focusKey ? this.findFocusableByKey(focusKey) : null;
        const firstAvailable = this.contentEl.querySelector<HTMLElement>(".omd-enrichment-actions button:not([disabled])");
        const focusTarget = preserved ?? firstAvailable ?? null;
        focusTarget?.focus({ preventScroll: true });
      }, 0);
    }
  }

  private renderEmpty(): void {
    this.contentEl.empty();
    const empty = this.contentEl.createDiv({ cls: "omd-enrichment-empty" });
    empty.createSpan({ cls: "omd-enrichment-eyebrow", text: "OMD REVIEW" });
    empty.createEl("h2", { text: "No note selected" });
    empty.createEl("p", { text: "Choose review on an inbox note to read it beside this pane." });
  }

  private renderProposal(shell: HTMLElement): void {
    const state = this.state;
    if (!state) return;
    const summary = shell.createDiv({ cls: "omd-enrichment-summary" });
    const summaryHeader = summary.createDiv({ cls: "omd-enrichment-summary-header" });
    summaryHeader.createDiv({ cls: "omd-enrichment-section-label", text: "Proposal summary" });
    const summaryActions = summaryHeader.createDiv({ cls: "omd-enrichment-summary-actions" });
    const copy = summaryActions.createEl("button", {
      cls: "omd-inline-action omd-enrichment-summary-copy",
      type: "button",
      text: "Copy summary",
    });
    copy.dataset.omdFocusKey = "summary:copy";
    copy.disabled = !state.summary.trim();
    copy.addEventListener("click", () => void this.copySummary());

    const editable = state.phase === "review";
    const includeRow = summary.createEl("label", { cls: "omd-enrichment-summary-option" });
    const include = includeRow.createEl("input", { type: "checkbox" });
    include.dataset.omdFocusKey = "summary:include";
    include.checked = this.selection.includeSummary;
    include.disabled = !editable || !state.summary.trim();
    includeRow.createSpan({ text: "Add summary to note" });
    include.addEventListener("change", () => {
      this.selection = updateEnrichmentSummarySelection(this.selection, { includeSummary: include.checked });
      this.render();
    });

    let summaryError: HTMLElement | null = null;
    if (this.selection.includeSummary) {
      const textarea = summary.createEl("textarea", {
        cls: "omd-enrichment-summary-editor",
        attr: {
          dir: "auto",
          rows: "5",
          "aria-label": "Summary to add to note",
        },
      });
      textarea.dataset.omdFocusKey = "summary:draft";
      textarea.value = this.selection.summaryDraft;
      textarea.readOnly = !editable;
      summaryError = summary.createDiv({
        cls: "omd-enrichment-summary-error",
        attr: { role: "alert" },
      });
      this.syncSummaryError(summaryError, textarea);
      textarea.addEventListener("input", () => {
        this.selection = updateEnrichmentSummarySelection(this.selection, { summaryDraft: textarea.value });
        this.syncSummaryError(summaryError!, textarea);
        this.syncApplyAction();
      });
    } else {
      summary.createDiv({ cls: "omd-enrichment-summary-text", text: state.summary || "No summary was generated.", attr: { dir: "auto" } });
    }
    summary.createDiv({
      cls: "omd-enrichment-summary-footnote",
      text: "Optional. Review or edit it before applying. Done reviewing does not add it.",
    });

    const sections = shell.createDiv({ cls: "omd-enrichment-sections" });
    this.renderSuggestionSection(sections, "Existing links", state.existingLinks);
    this.renderSuggestionSection(sections, "Existing tags", state.existingTags);
    this.renderSuggestionSection(sections, "New tags", state.newTags);
    this.renderSuggestionSection(sections, "Suggested note topics", state.concepts, true);
    this.renderWarnings(sections, state.warnings);
  }

  private renderSuggestionSection(
    parent: HTMLElement,
    label: string,
    suggestions: EnrichmentSuggestion[],
    displayOnly = false,
  ): void {
    if (!suggestions.length) return;
    const section = parent.createDiv({ cls: "omd-enrichment-section" });
    const header = section.createDiv({ cls: "omd-enrichment-section-header" });
    header.createEl("h3", { text: label });
    header.createSpan({ cls: "omd-enrichment-section-count", text: String(suggestions.length) });
    if (displayOnly) {
      section.createEl("p", {
        cls: "omd-enrichment-section-description",
        text: "Ideas for separate notes. Apply does not create notes or add these topics as tags.",
      });
    }
    const list = section.createDiv({ cls: "omd-enrichment-list" });
    const editable = this.state?.phase === "review" && !displayOnly;

    for (const suggestion of suggestions) {
      const selectable = editable && suggestion.selectable !== false;
      const row = list.createDiv({
        cls: `omd-enrichment-item${displayOnly ? " is-display-only" : ""}${this.selection.selectedIds[suggestion.id] ? " is-selected" : ""}${selectable ? " is-selectable" : ""}`,
      });
      const checkbox = displayOnly
        ? null
        : row.createEl("input", { type: "checkbox", cls: "omd-enrichment-checkbox" });
      if (checkbox) {
        checkbox.dataset.omdFocusKey = `suggestion:${suggestion.id}`;
        checkbox.checked = this.selection.selectedIds[suggestion.id] ?? false;
        checkbox.disabled = !selectable;
        checkbox.setAttribute("aria-label", `${suggestionKindLabel(suggestion)}: ${suggestion.label}`);
      } else {
        row.createSpan({ cls: "omd-enrichment-display-mark", attr: { "aria-hidden": "true" }, text: "◇" });
      }
      const toggle = (selected: boolean): void => {
        this.selection = toggleEnrichmentSelection(this.selection, suggestion.id, selected);
        this.render();
      };
      checkbox?.addEventListener("change", () => toggle(checkbox.checked));

      const body = row.createDiv({ cls: "omd-enrichment-item-body" });
      const labelRow = body.createDiv({ cls: "omd-enrichment-item-labelrow" });
      labelRow.createDiv({ cls: "omd-enrichment-item-label", text: suggestion.label });
      labelRow.createSpan({ cls: "omd-enrichment-item-kind tone-idle", text: suggestionKindLabel(suggestion) });
      if (suggestion.path) {
        const pathButton = body.createEl("button", {
          cls: "omd-enrichment-path",
          type: "button",
          text: suggestion.path,
          attr: { "aria-label": `Open note: ${suggestion.path}`, title: suggestion.path },
        });
        pathButton.dataset.omdFocusKey = `path:${suggestion.id}`;
        pathButton.addEventListener("click", (event) => {
          event.stopPropagation();
          void this.callbacks?.onOpenPath?.(suggestion.path!);
        });
      }
      if (suggestion.evidence) body.createDiv({ cls: "omd-enrichment-item-evidence", text: suggestion.evidence });
      if (suggestion.detail) body.createDiv({ cls: "omd-enrichment-item-detail", text: suggestion.detail });
      if (selectable) {
        row.addEventListener("click", (event) => {
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
          if (checkbox) toggle(!checkbox.checked);
        });
      }
    }
  }

  private renderWarnings(parent: HTMLElement, warnings: string[]): void {
    if (!warnings.length) return;
    const section = parent.createDiv({ cls: "omd-enrichment-section" });
    const header = section.createDiv({ cls: "omd-enrichment-section-header" });
    header.createEl("h3", { text: "Warnings" });
    header.createSpan({ cls: "omd-enrichment-section-count", text: String(warnings.length) });
    const list = section.createDiv({ cls: "omd-enrichment-warning-list" });
    for (const warning of warnings) {
      list.createDiv({ cls: "omd-enrichment-warning", text: warningDescription(warning), attr: { title: warning } });
    }
  }

  private renderMeta(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv({ cls: "omd-enrichment-meta-row" });
    if (label === "Target") row.addClass("is-target");
    row.createSpan({ cls: "omd-enrichment-meta-label", text: label });
    row.createEl("code", { cls: "omd-enrichment-meta-value", text: value, attr: { title: value } });
  }

  private renderActions(parent: HTMLElement): void {
    const state = this.state;
    const callbacks = this.callbacks;
    if (!state || !callbacks) return;
    const phase = state.phase;
    if (phase === "idle") {
      this.button(parent, "Keep in Inbox", false, () => this.closeReview());
      this.button(parent, "Generate suggestions", false, () => callbacks.onGenerate());
      this.button(parent, "Done reviewing", true, () => callbacks.onDoneReviewing());
      return;
    }
    if (phase === "review") {
      this.button(parent, "Keep in Inbox", false, () => this.closeReview());
      const apply = this.button(parent, "Apply suggestions", false, async () => {
        if (!canApplyEnrichment(state, this.selection)) return;
        await callbacks.onApply({
          state,
          selection: {
            selectedIds: { ...this.selection.selectedIds },
            includeSummary: this.selection.includeSummary,
            summaryDraft: this.selection.summaryDraft,
            summarySource: this.selection.summarySource,
          },
          selectedSuggestions: selectedSuggestions(state, this.selection),
        });
      });
      apply.disabled = !canApplyEnrichment(state, this.selection);
      apply.setAttribute("aria-disabled", String(apply.disabled));
      this.button(parent, "Done reviewing", true, () => callbacks.onDoneReviewing());
      return;
    }
    if (phase === "capability" || phase === "catalog" || phase === "generating") {
      this.button(parent, "Cancel generation", false, () => callbacks.onCancelGeneration());
      return;
    }
    if (phase === "applied" || phase === "error" || phase === "conflict" || phase === "cancelled") {
      this.button(parent, "Keep in Inbox", false, () => this.closeReview());
      const retainedProposal = phase === "error" && showsProposal(state);
      if (retainedProposal) {
        const open = this.button(parent, "Open note", false, async () => {
          if (!callbacks.onOpenPath) return;
          try {
            await callbacks.onOpenPath(state.targetPath);
          } catch {
            new Notice("Could not open the target note. Use the target path shown above.");
          }
        });
        open.disabled = !callbacks.onOpenPath;
        open.setAttribute("aria-disabled", String(open.disabled));
      }
      if (state.canRetry !== false) this.button(parent, "Generate again", false, () => callbacks.onGenerate());
      this.button(parent, "Done reviewing", true, () => callbacks.onDoneReviewing());
      return;
    }
    if (phase === "partial-failure") {
      const open = this.button(parent, "Open note", true, async () => {
        if (!callbacks.onOpenPath) return;
        const targetPath = state.targetPath;
        try {
          await callbacks.onOpenPath(targetPath);
        } catch {
          new Notice("Could not open the target note. Use the target path shown above.");
        }
      });
      open.disabled = !callbacks.onOpenPath;
      open.setAttribute("aria-disabled", String(open.disabled));
      return;
    }
    if (phase === "unavailable") {
      this.button(parent, "Close review", false, () => this.closeReview());
      return;
    }
    if (phase === "applying" || phase === "finishing") {
      const applying = this.button(parent, phase === "finishing" ? "Finishing" : "Applying", false, () => undefined);
      applying.disabled = true;
      return;
    }
    this.button(parent, "Close review", false, () => this.closeReview());
  }

  private button(parent: HTMLElement, label: string, primary: boolean, action: () => void | Promise<void>): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `omd-action-button omd-enrichment-button${primary ? " mod-cta" : ""}`,
      type: "button",
      text: label,
    });
    button.dataset.omdFocusKey = `action:${label}`;
    button.addEventListener("click", () => void action());
    return button;
  }

  private currentFocusKey(): string | null {
    const active = document.activeElement;
    if (!active?.instanceOf(HTMLElement) || !this.contentEl.contains(active)) return null;
    return active.dataset.omdFocusKey ?? null;
  }

  private findFocusableByKey(focusKey: string): HTMLElement | null {
    const focusable = focusableElements(this.contentEl);
    for (const element of focusable) {
      if (element.getAttribute("data-omd-focus-key") === focusKey) return element;
    }
    return null;
  }

  private async copySummary(): Promise<void> {
    const value = this.selection.includeSummary ? this.selection.summaryDraft : this.state?.summary ?? "";
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      new Notice("Summary copied.");
    } catch {
      new Notice("Could not copy the summary.");
    }
  }

  private syncSummaryError(element: HTMLElement, textarea?: HTMLTextAreaElement): void {
    const validation = enrichmentSummaryValidation(this.selection);
    const message = validation && !validation.ok ? validation.message : "";
    element.setText(message);
    element.hidden = !message;
    textarea?.setAttribute("aria-invalid", String(Boolean(message)));
  }

  private syncApplyAction(): void {
    if (!this.state) return;
    const apply = this.contentEl.querySelector<HTMLButtonElement>('[data-omd-focus-key="action:Apply suggestions"]');
    if (apply) {
      apply.disabled = !canApplyEnrichment(this.state, this.selection);
      apply.setAttribute("aria-disabled", String(apply.disabled));
    }
    const count = this.contentEl.querySelector<HTMLElement>(".omd-enrichment-count");
    if (count) count.setText(selectionCountText(this.state, this.selection, selectedEnrichmentCount(this.state, this.selection)));
  }

}

function showsProposal(state: EnrichmentReviewState): boolean {
  const phase = state.phase;
  if (phase === "review" || phase === "applying" || phase === "applied" || phase === "conflict" || phase === "partial-failure") return true;
  if (phase !== "error") return false;
  return Boolean(state.summary.trim())
    || state.existingLinks.length > 0
    || state.existingTags.length > 0
    || state.newTags.length > 0
    || state.concepts.length > 0;
}

function footerNote(state: EnrichmentReviewState): string {
  const phase = state.phase;
  if (phase === "idle") return "Suggestions are optional. Done reviewing is the only action that changes Inbox status.";
  if (phase === "review") return "Apply saves the selected summary, links, and tags while keeping this note in Inbox.";
  if (phase === "conflict") return "The old proposal cannot be applied. Generate again from the current note.";
  if (phase === "unavailable") return "Close this view, then start again from an available Markdown note.";
  if (phase === "partial-failure") return "Inspect Summary, Related notes, and Properties, then generate a new proposal before trying again.";
  if (phase === "applied") return "Suggestions were saved. The note stays in Inbox until you choose Done reviewing.";
  if (phase === "reviewed") return "The note is marked Reviewed and remains available in Recent notes.";
  if (phase === "error" && showsProposal(state)) {
    return state.summary.trim()
      ? "Nothing was written. Copy the summary or open the note, then generate again."
      : "Nothing was written. Review the proposal or open the note, then generate again.";
  }
  return "Generating suggestions does not write to the note.";
}

function emptySelection(): EnrichmentSelection {
  return { selectedIds: {}, includeSummary: false, summaryDraft: "", summarySource: "" };
}

function selectionCountText(
  state: EnrichmentReviewState,
  selection: EnrichmentSelection,
  counts = selectedEnrichmentCount(state, selection),
): string {
  const summaryAvailable = Boolean(state.summary.trim());
  const selected = counts.selected + (selection.includeSummary ? 1 : 0);
  const available = counts.available + (summaryAvailable ? 1 : 0);
  return `${selected} selected / ${available} available`;
}

function suggestionKindLabel(suggestion: EnrichmentSuggestion): string {
  switch (suggestion.kind) {
    case "existing-link": return "Existing note";
    case "existing-tag": return "Existing tag";
    case "new-tag": return "New tag";
    case "new-concept": return "Idea only";
    default: return "Suggestion";
  }
}

function warningDescription(warning: string): string {
  switch (warning) {
    case "source_truncated_for_model_context":
      return "Only part of this note fit in the model's context. Suggestions may miss content from the rest of the note.";
    case "candidate_catalog_truncated_for_model_context":
      return "Only some candidate notes fit in the model's context. Other relevant notes may be missing from these suggestions.";
    case "vault_tags_truncated_for_model_context":
      return "Only some vault tags fit in the model's context. Other relevant tags may be missing from these suggestions.";
    case "existing_tag_already_present":
      return "A suggested tag is already on this note and was left out of the proposal.";
    case "existing_concept_omitted":
      return "A suggested concept already has a note in this vault and was left out of the proposal.";
    case "unexplained_tag_omitted":
      return "Tag suggestions without a useful explanation were left out of the proposal.";
    case "unknown_tag_reference_omitted":
      return "One tag suggestion used an unknown catalog reference and was left out.";
    default:
      return warning;
  }
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll("[data-omd-focus-key]")).filter(
    (element): element is HTMLElement => element.instanceOf(HTMLElement),
  );
}
