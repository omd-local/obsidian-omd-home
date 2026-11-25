import { validateManagedSummaryText } from "./managed-block.ts";

export type EnrichmentPhase =
  | "idle" | "capability" | "catalog" | "generating" | "review" | "applying"
  | "applied" | "finishing" | "reviewed" | "error" | "cancelled" | "conflict"
  | "unavailable" | "partial-failure";

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
  hasAppliedSuggestions: boolean;
  statusText?: string;
  detailText?: string;
  canRetry?: boolean;
}

export interface EnrichmentSelection {
  selectedIds: Record<string, boolean>;
  includeSummary: boolean;
  summaryDraft: string;
  summarySource: string;
  manualTags?: string[];
}

export interface EnrichmentPhaseCopy {
  title: string;
  detail: string;
  tone: EnrichmentTone;
  terminal: boolean;
  canApply: boolean;
}

export function describeEnrichmentPhase(phase: EnrichmentPhase): EnrichmentPhaseCopy {
  switch (phase) {
    case "capability": return phaseCopy("Checking OMD", "Verifying that the detected OMD installation supports enrichment.", "busy");
    case "catalog": return phaseCopy("Building catalog", "Ranking safe vault notes and tags for this request.", "busy");
    case "generating": return phaseCopy("Generating proposal", "The local model is preparing links and tags for review.", "busy");
    case "review": return phaseCopy("Review suggestions", "Choose a summary, links, or tags to add, or finish without them.", "idle", false, true);
    case "applying": return phaseCopy("Applying suggestions", "Rechecking the note before writing your selection.", "busy");
    case "applied": return phaseCopy("Suggestions applied", "The selected note changes were saved. The note remains in Inbox.", "success");
    case "finishing": return phaseCopy("Finishing review", "Marking this note as reviewed without changing its body.", "busy");
    case "reviewed": return phaseCopy("Review complete", "This note is marked Reviewed.", "success", true);
    case "error": return phaseCopy("Could not finish", "No proposal changes were applied.", "danger", true);
    case "cancelled": return phaseCopy("Generation cancelled", "No suggestions were applied. You can still finish the review or generate again.", "warning");
    case "conflict": return phaseCopy("Note changed", "This proposal is stale. Generate again from the current note before applying.", "warning", true);
    case "unavailable": return phaseCopy("Note unavailable", "The target note or one of its candidates can no longer be read safely.", "warning", true);
    case "partial-failure": return phaseCopy("Apply incomplete", "Some selected content may be present, but the note's Properties were not finalized.", "danger", true);
    case "idle": return phaseCopy("Review note", "Read the note, generate optional suggestions, then choose Done reviewing.", "idle");
  }
}

export function createEnrichmentSelection(state: EnrichmentReviewState): EnrichmentSelection {
  const selectedIds: Record<string, boolean> = {};
  for (const item of selectableSuggestions(state)) selectedIds[item.id] = item.selected ?? defaultSelection(item.kind);
  return {
    selectedIds,
    includeSummary: false,
    summaryDraft: state.summary,
    summarySource: state.summary,
    manualTags: [],
  };
}

export function reconcileEnrichmentSelection(
  state: EnrichmentReviewState,
  selection: EnrichmentSelection,
): EnrichmentSelection {
  const selectedIds: Record<string, boolean> = {};
  for (const item of selectableSuggestions(state)) {
    selectedIds[item.id] = selection.selectedIds[item.id] ?? item.selected ?? defaultSelection(item.kind);
  }
  const sameSummary = selection.summarySource === state.summary;
  return {
    selectedIds,
    includeSummary: sameSummary ? selection.includeSummary : false,
    summaryDraft: sameSummary ? selection.summaryDraft : state.summary,
    summarySource: state.summary,
    manualTags: [...(selection.manualTags ?? [])],
  };
}

export function toggleEnrichmentSelection(
  selection: EnrichmentSelection,
  suggestionId: string,
  selected?: boolean,
): EnrichmentSelection {
  return {
    ...selection,
    selectedIds: { ...selection.selectedIds, [suggestionId]: selected ?? !selection.selectedIds[suggestionId] },
  };
}

export function updateEnrichmentSummarySelection(
  selection: EnrichmentSelection,
  patch: Partial<Pick<EnrichmentSelection, "includeSummary" | "summaryDraft">>,
): EnrichmentSelection {
  return { ...selection, ...patch };
}

export function addManualEnrichmentTag(
  selection: EnrichmentSelection,
  rawTag: string,
): { selection: EnrichmentSelection; error: string } {
  const tag = rawTag.trim().replace(/^#+/u, "");
  if (!tag) return { selection, error: "Enter a tag first." };
  if ([...tag].length > 128) return { selection, error: "Tags must be 128 characters or fewer." };
  if (/\s/u.test(tag)) return { selection, error: "Obsidian tags cannot contain spaces." };
  if (containsInvalidManualTagCharacter(tag)) {
    return { selection, error: "This tag contains a character Obsidian cannot use." };
  }
  const manualTags = selection.manualTags ?? [];
  if (manualTags.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
    return { selection, error: `#${tag} is already added.` };
  }
  return { selection: { ...selection, manualTags: [...manualTags, tag] }, error: "" };
}

function containsInvalidManualTagCharacter(tag: string): boolean {
  for (const character of tag) {
    const code = character.charCodeAt(0);
    if (character === "," || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function removeManualEnrichmentTag(
  selection: EnrichmentSelection,
  tag: string,
): EnrichmentSelection {
  return {
    ...selection,
    manualTags: (selection.manualTags ?? []).filter(
      (value) => value.toLocaleLowerCase() !== tag.toLocaleLowerCase(),
    ),
  };
}

export function enrichmentSummaryValidation(selection: EnrichmentSelection): ReturnType<typeof validateManagedSummaryText> | null {
  return selection.includeSummary ? validateManagedSummaryText(selection.summaryDraft) : null;
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
  if (state.phase !== "review") return false;
  const summary = enrichmentSummaryValidation(selection);
  return selectedEnrichmentCount(state, selection).selected > 0
    || (selection.manualTags?.length ?? 0) > 0
    || summary?.ok === true;
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
    { phase: "idle", label: "Review" },
    { phase: "generating", label: "Suggestions" },
    { phase: "reviewed", label: "Done" },
  ];
  const active = current === "reviewed" || current === "finishing" ? "reviewed"
    : current === "idle" ? "idle"
      : "generating";
  const tone = describeEnrichmentPhase(current).tone;
  return stages.map((stage) => ({ ...stage, active: stage.phase === active, tone: stage.phase === active ? tone : "idle" }));
}

export function emptyReviewState(targetPath: string, model: string, endpoint: string): EnrichmentReviewState {
  return {
    phase: "idle",
    targetPath,
    model,
    endpoint,
    summary: "",
    existingLinks: [],
    existingTags: [],
    newTags: [],
    concepts: [],
    warnings: [],
    hasAppliedSuggestions: false,
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
