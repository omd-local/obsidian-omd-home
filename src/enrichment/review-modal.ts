import { App, Modal } from "obsidian";
import {
  canApplyEnrichment,
  createEnrichmentSelection,
  describeEnrichmentPhase,
  reconcileEnrichmentSelection,
  selectedEnrichmentCount,
  selectedSuggestions,
  stageRailItems,
  toggleEnrichmentSelection,
  type EnrichmentReviewState,
  type EnrichmentSelection,
  type EnrichmentSuggestion,
} from "./workflow.ts";

export interface EnrichmentApplyPayload {
  state: EnrichmentReviewState;
  selection: EnrichmentSelection;
  selectedSuggestions: EnrichmentSuggestion[];
}

export interface EnrichmentReviewModalCallbacks {
  onCancel: () => void | Promise<void>;
  onApply: (payload: EnrichmentApplyPayload) => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  onOpenPath?: (path: string) => void;
}

export class EnrichmentReviewModal extends Modal {
  private state: EnrichmentReviewState;
  private selection: EnrichmentSelection;
  private readonly callbacks: EnrichmentReviewModalCallbacks;
  private actionHandled = false;
  private focusTimer: number | null = null;
  private focusNextRender = true;

  constructor(app: App, state: EnrichmentReviewState, callbacks: EnrichmentReviewModalCallbacks) {
    super(app);
    this.state = state;
    this.selection = createEnrichmentSelection(state);
    this.callbacks = callbacks;
  }

  onOpen(): void {
    this.modalEl.addClass("omd-enrichment-modal");
    this.titleEl.addClass("omd-enrichment-title");
    this.titleEl.setText("OMD enrichment");
    this.render();
  }

  onClose(): void {
    if (this.focusTimer !== null) {
      window.clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
    if (!this.actionHandled && isActiveDismissal(this.state.phase)) void this.callbacks.onCancel();
    this.contentEl.empty();
  }

  setState(state: EnrichmentReviewState): void {
    if (state.phase !== this.state.phase) this.focusNextRender = true;
    this.state = state;
    this.selection = reconcileEnrichmentSelection(state, this.selection);
    if (this.contentEl.isConnected) this.render();
  }

  getState(): EnrichmentReviewState {
    return this.state;
  }

  closeWithoutCallback(): void {
    this.actionHandled = true;
    this.close();
  }

  private render(): void {
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

    const status = scroll.createDiv({ cls: "omd-enrichment-status", attr: { role: "status", "aria-live": "polite" } });
    status.createSpan({ cls: `omd-enrichment-status-badge tone-${phase.tone}`, text: phase.title });
    status.createSpan({ cls: "omd-enrichment-status-copy", text: this.state.statusText || phase.detail });

    if (showsProposal(this.state.phase)) this.renderProposal(scroll);
    else if (this.state.warnings.length) this.renderWarnings(scroll, this.state.warnings);

    const footer = shell.createDiv({ cls: "omd-enrichment-footer" });
    const footerCopy = footer.createDiv({ cls: "omd-enrichment-footer-copy" });
    const counts = selectedEnrichmentCount(this.state, this.selection);
    footerCopy.createDiv({
      cls: "omd-enrichment-count",
      text: showsProposal(this.state.phase) ? `${counts.selected} selected / ${counts.available} available` : phase.title,
    });
    footerCopy.createDiv({ cls: "omd-enrichment-footer-note", text: footerNote(this.state.phase) });
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

  private renderProposal(shell: HTMLElement): void {
    const summary = shell.createDiv({ cls: "omd-enrichment-summary" });
    summary.createDiv({ cls: "omd-enrichment-section-label", text: "Summary preview" });
    summary.createDiv({ cls: "omd-enrichment-summary-text", text: this.state.summary || "No summary was generated." });
    summary.createDiv({ cls: "omd-enrichment-summary-footnote", text: "Preview only. Nothing is written until you choose Apply." });

    const sections = shell.createDiv({ cls: "omd-enrichment-sections" });
    this.renderSuggestionSection(sections, "Existing links", this.state.existingLinks);
    this.renderSuggestionSection(sections, "Existing tags", this.state.existingTags);
    this.renderSuggestionSection(sections, "New tags", this.state.newTags);
    this.renderSuggestionSection(sections, "Suggested note topics", this.state.concepts, true);
    this.renderWarnings(sections, this.state.warnings);
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
    const editable = this.state.phase === "review" && !displayOnly;

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
          this.callbacks.onOpenPath?.(suggestion.path!);
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
    row.createSpan({ cls: "omd-enrichment-meta-label", text: label });
    row.createEl("code", { cls: "omd-enrichment-meta-value", text: value, attr: { title: value } });
  }

  private renderActions(parent: HTMLElement): void {
    const phase = this.state.phase;
    if (phase === "review") {
      this.button(parent, "Cancel", false, () => this.cancelAndClose());
      const apply = this.button(parent, "Apply", true, async () => {
        if (!canApplyEnrichment(this.state, this.selection)) return;
        this.actionHandled = true;
        await this.callbacks.onApply({
          state: this.state,
          selection: { selectedIds: { ...this.selection.selectedIds } },
          selectedSuggestions: selectedSuggestions(this.state, this.selection),
        });
      });
      apply.disabled = !canApplyEnrichment(this.state, this.selection);
      apply.setAttribute("aria-disabled", String(apply.disabled));
      return;
    }
    if (phase === "capability" || phase === "catalog" || phase === "generating") {
      this.button(parent, "Cancel", false, () => this.cancelAndClose());
      return;
    }
    if (phase === "error" || phase === "conflict") {
      this.button(parent, "Close", false, () => this.closeWithoutCallback());
      if (this.state.canRetry === false) return;
      const retry = this.button(parent, "Generate again", true, async () => {
        if (!this.callbacks.onRetry) return;
        this.actionHandled = true;
        this.close();
        await this.callbacks.onRetry();
      });
      retry.disabled = !this.callbacks.onRetry;
      return;
    }
    if (phase === "unavailable") {
      this.button(parent, "Close", false, () => this.closeWithoutCallback());
      return;
    }
    if (phase === "applying") {
      const applying = this.button(parent, "Applying", false, () => undefined);
      applying.disabled = true;
      return;
    }
    this.button(parent, "Close", false, () => this.closeWithoutCallback());
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

  private async cancelAndClose(): Promise<void> {
    this.actionHandled = true;
    await this.callbacks.onCancel();
    this.close();
  }
}

function showsProposal(phase: EnrichmentReviewState["phase"]): boolean {
  return phase === "review" || phase === "applying" || phase === "applied" || phase === "conflict" || phase === "partial-failure";
}

function isActiveDismissal(phase: EnrichmentReviewState["phase"]): boolean {
  return phase === "capability" || phase === "catalog" || phase === "generating" || phase === "review";
}

function footerNote(phase: EnrichmentReviewState["phase"]): string {
  if (phase === "review") return "Recommended existing items start checked. New tags start unchecked.";
  if (phase === "conflict") return "The old proposal cannot be applied. Generate again from the current note.";
  if (phase === "unavailable") return "Close this view, then start again from an available Markdown note.";
  if (phase === "partial-failure") return "Open the target note and review the managed Related notes block before retrying.";
  if (phase === "applied") return "The Inbox status changes to reviewed only after every selected write succeeds.";
  return "Proposal generation does not write to the vault.";
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
    default:
      return warning;
  }
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll("[data-omd-focus-key]")).filter(
    (element): element is HTMLElement => element.instanceOf(HTMLElement),
  );
}
