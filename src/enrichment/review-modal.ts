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
    if (!this.actionHandled && isActiveDismissal(this.state.phase)) void this.callbacks.onCancel();
    this.contentEl.empty();
  }

  setState(state: EnrichmentReviewState): void {
    this.state = state;
    this.selection = reconcileEnrichmentSelection(state, this.selection);
    if (this.contentEl.isConnected) this.render();
  }

  getState(): EnrichmentReviewState {
    return this.state;
  }

  private render(): void {
    this.contentEl.empty();
    const shell = this.contentEl.createDiv({ cls: "omd-enrichment-shell" });
    const phase = describeEnrichmentPhase(this.state.phase);
    const header = shell.createDiv({ cls: "omd-enrichment-header" });
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

    const status = shell.createDiv({ cls: "omd-enrichment-status", attr: { role: "status", "aria-live": "polite" } });
    status.createSpan({ cls: `omd-enrichment-status-badge tone-${phase.tone}`, text: phase.title });
    status.createSpan({ cls: "omd-enrichment-status-copy", text: this.state.statusText || phase.detail });

    if (showsProposal(this.state.phase)) this.renderProposal(shell);
    else if (this.state.warnings.length) this.renderWarnings(shell, this.state.warnings);

    const footer = shell.createDiv({ cls: "omd-enrichment-footer" });
    const footerCopy = footer.createDiv({ cls: "omd-enrichment-footer-copy" });
    const counts = selectedEnrichmentCount(this.state, this.selection);
    footerCopy.createDiv({
      cls: "omd-enrichment-count",
      text: showsProposal(this.state.phase) ? `${counts.selected} selected / ${counts.available} available` : phase.title,
    });
    footerCopy.createDiv({ cls: "omd-enrichment-footer-note", text: footerNote(this.state.phase) });
    this.renderActions(footer.createDiv({ cls: "omd-enrichment-actions" }));
    window.setTimeout(() => {
      this.contentEl.querySelector<HTMLButtonElement | HTMLInputElement>("button:not([disabled]), input:not([disabled])")?.focus();
    }, 0);
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
    this.renderSuggestionSection(sections, "New concepts", this.state.concepts, true);
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
    const list = section.createDiv({ cls: "omd-enrichment-list" });
    const editable = this.state.phase === "review" && !displayOnly;

    for (const suggestion of suggestions) {
      const selectable = editable && suggestion.selectable !== false;
      const row = list.createDiv({
        cls: `omd-enrichment-item${displayOnly ? " is-display-only" : ""}${this.selection.selectedIds[suggestion.id] ? " is-selected" : ""}${selectable ? " is-selectable" : ""}`,
      });
      const checkbox = row.createEl("input", { type: "checkbox", cls: "omd-enrichment-checkbox" });
      checkbox.checked = this.selection.selectedIds[suggestion.id] ?? false;
      checkbox.disabled = !selectable;
      checkbox.setAttribute("aria-label", `${suggestionKindLabel(suggestion)}: ${suggestion.label}`);
      const toggle = (selected: boolean): void => {
        this.selection = toggleEnrichmentSelection(this.selection, suggestion.id, selected);
        this.render();
      };
      checkbox.addEventListener("change", () => toggle(checkbox.checked));

      const body = row.createDiv({ cls: "omd-enrichment-item-body" });
      const labelRow = body.createDiv({ cls: "omd-enrichment-item-labelrow" });
      labelRow.createDiv({ cls: "omd-enrichment-item-label", text: suggestion.label });
      labelRow.createSpan({ cls: "omd-enrichment-item-kind tone-idle", text: suggestionKindLabel(suggestion) });
      if (suggestion.path) {
        const pathButton = labelRow.createEl("button", { cls: "omd-enrichment-path", type: "button", text: suggestion.path });
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
          toggle(!checkbox.checked);
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
    for (const warning of warnings) list.createDiv({ cls: "omd-enrichment-warning", text: warning });
  }

  private renderMeta(parent: HTMLElement, label: string, value: string): void {
    const row = parent.createDiv({ cls: "omd-enrichment-meta-row" });
    row.createSpan({ cls: "omd-enrichment-meta-label", text: label });
    row.createEl("code", { cls: "omd-enrichment-meta-value", text: value });
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
      this.button(parent, "Close", false, () => this.cancelAndClose());
      const retry = this.button(parent, "Generate again", true, async () => {
        if (!this.callbacks.onRetry) return;
        this.actionHandled = true;
        this.close();
        await this.callbacks.onRetry();
      });
      retry.disabled = !this.callbacks.onRetry;
      return;
    }
    if (phase === "applying") {
      const applying = this.button(parent, "Applying", false, () => undefined);
      applying.disabled = true;
      return;
    }
    this.button(parent, "Close", false, () => this.cancelAndClose());
  }

  private button(parent: HTMLElement, label: string, primary: boolean, action: () => void | Promise<void>): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `omd-action-button omd-enrichment-button${primary ? " mod-cta" : ""}`,
      type: "button",
      text: label,
    });
    button.addEventListener("click", () => void action());
    return button;
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
  if (phase === "partial-failure") return "Open the target note and review the managed Related notes block before retrying.";
  if (phase === "applied") return "The Inbox status changes to reviewed only after every selected write succeeds.";
  return "Proposal generation does not write to the vault.";
}

function suggestionKindLabel(suggestion: EnrichmentSuggestion): string {
  switch (suggestion.kind) {
    case "existing-link": return "Existing note";
    case "existing-tag": return "Existing tag";
    case "new-tag": return "New tag";
    case "new-concept": return "Display only";
    default: return "Suggestion";
  }
}
