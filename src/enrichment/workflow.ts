export type EnrichmentPhase =
  | "idle" | "capability" | "catalog" | "generating" | "review" | "applying"
  | "applied" | "error" | "cancelled" | "conflict" | "partial-failure";

export type EnrichmentTone = "idle" | "busy" | "success" | "warning" | "danger";
export type EnrichmentSuggestionKind = "existing-link" | "existing-tag" | "new-tag" | "new-concept";

export interface EnrichmentSuggestion {
  id: string;
  kind: EnrichmentSuggestionKind;
  label: string;
  path?: string;
  evidence?: string;
  detail?: string;
  selected?: boolean;
  selectable?: boolean;
}

export interface EnrichmentReviewState {
  phase: EnrichmentPhase;
  targetPath: string;
  model: string;
  endpoint: string;
  summary: string;
  existingLinks: EnrichmentSuggestion[];
  existingTags: EnrichmentSuggestion[];
  newTags: EnrichmentSuggestion[];
  concepts: EnrichmentSuggestion[];
  warnings: string[];
  statusText?: string;
  detailText?: string;
}

export interface EnrichmentSelection { selectedIds: Record<string, boolean>; }

export interface EnrichmentPhaseCopy {
  title: string;
  detail: string;
  tone: EnrichmentTone;
  terminal: boolean;
  canApply: boolean;
}

export function describeEnrichmentPhase(phase: EnrichmentPhase): EnrichmentPhaseCopy {
  switch (phase) {
    case "capability": return phaseCopy("Checking OMD", "Verifying that the configured OMD executable supports enrichment.", "busy");
    case "catalog": return phaseCopy("Building catalog", "Ranking safe vault notes and tags for this request.", "busy");
    case "generating": return phaseCopy("Generating proposal", "The local model is preparing links and tags for review.", "busy");
    case "review": return phaseCopy("Review proposal", "Choose exactly which suggestions OMD Home may write.", "idle", false, true);
    case "applying": return phaseCopy("Applying changes", "Rechecking the note before writing your selection.", "busy");
    case "applied": return phaseCopy("Applied", "The selected links and tags were saved.", "success", true);
    case "error": return phaseCopy("Could not finish", "No proposal changes were applied.", "danger", true);
    case "cancelled": return phaseCopy("Cancelled", "The proposal flow stopped before any changes were written.", "warning", true);
    case "conflict": return phaseCopy("Note changed", "This proposal is stale. Generate again from the current note before applying.", "warning", true);
    case "partial-failure": return phaseCopy("Review required", "A guarded rollback could not safely restore the complete pre-apply state.", "danger", true);
    case "idle": return phaseCopy("Ready", "Choose a Markdown note to generate a review-only proposal.", "idle");
  }
}

export function createEnrichmentSelection(state: EnrichmentReviewState): EnrichmentSelection {
  const selectedIds: Record<string, boolean> = {};
  for (const item of selectableSuggestions(state)) selectedIds[item.id] = item.selected ?? defaultSelection(item.kind);
  return { selectedIds };
}

export function reconcileEnrichmentSelection(
  state: EnrichmentReviewState,
  selection: EnrichmentSelection,
): EnrichmentSelection {
  const selectedIds: Record<string, boolean> = {};
  for (const item of selectableSuggestions(state)) {
    selectedIds[item.id] = selection.selectedIds[item.id] ?? item.selected ?? defaultSelection(item.kind);
  }
  return { selectedIds };
}

export function toggleEnrichmentSelection(
  selection: EnrichmentSelection,
  suggestionId: string,
  selected?: boolean,
): EnrichmentSelection {
  return { selectedIds: { ...selection.selectedIds, [suggestionId]: selected ?? !selection.selectedIds[suggestionId] } };
}

export function selectedEnrichmentCount(
  state: EnrichmentReviewState,
  selection: EnrichmentSelection,
): { selected: number; available: number } {
  const suggestions = selectableSuggestions(state);
  return {
    selected: suggestions.filter((item) => selection.selectedIds[item.id]).length,
    available: suggestions.length,
  };
}

export function canApplyEnrichment(state: EnrichmentReviewState, selection: EnrichmentSelection): boolean {
  return state.phase === "review" && selectedEnrichmentCount(state, selection).selected > 0;
}

export function selectedSuggestions(
  state: EnrichmentReviewState,
  selection: EnrichmentSelection,
): EnrichmentSuggestion[] {
  return selectableSuggestions(state).filter((item) => selection.selectedIds[item.id]);
}

export function stageRailItems(current: EnrichmentPhase): Array<{
  phase: EnrichmentPhase;
  label: string;
  tone: EnrichmentTone;
  active: boolean;
}> {
  const stages: Array<{ phase: EnrichmentPhase; label: string }> = [
    { phase: "capability", label: "Check" },
    { phase: "catalog", label: "Catalog" },
    { phase: "generating", label: "Generate" },
    { phase: "review", label: "Review" },
    { phase: "applying", label: "Apply" },
  ];
  const active = current === "applied" || current === "partial-failure" ? "applying"
    : current === "conflict" ? "review"
      : current;
  const tone = describeEnrichmentPhase(current).tone;
  return stages.map((stage) => ({ ...stage, active: stage.phase === active, tone: stage.phase === active ? tone : "idle" }));
}

export function emptyReviewState(targetPath: string, model: string, endpoint: string): EnrichmentReviewState {
  return {
    phase: "capability",
    targetPath,
    model,
    endpoint,
    summary: "",
    existingLinks: [],
    existingTags: [],
    newTags: [],
    concepts: [],
    warnings: [],
  };
}

function selectableSuggestions(state: EnrichmentReviewState): EnrichmentSuggestion[] {
  return [...state.existingLinks, ...state.existingTags, ...state.newTags].filter((item) => item.selectable !== false);
}

function defaultSelection(kind: EnrichmentSuggestionKind): boolean {
  return kind === "existing-link" || kind === "existing-tag";
}

function phaseCopy(
  title: string,
  detail: string,
  tone: EnrichmentTone,
  terminal = false,
  canApply = false,
): EnrichmentPhaseCopy {
  return { title, detail, tone, terminal, canApply };
}
