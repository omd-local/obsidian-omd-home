import { Notice, TFile } from "obsidian";
import type OmdHomePlugin from "../main.ts";
import type { OmdProgressEvent } from "../model.ts";
import { applyEnrichmentSelection, type ApplyEnrichmentPlan } from "./apply.ts";
import { buildEnrichmentRequest } from "./catalog.ts";
import type {
  EnrichmentCandidate,
  EnrichmentResponse,
  OmdEnrichEvent,
  OmdEnrichRequest,
} from "./contract.ts";
import {
  describeEnrichmentFailure,
  isEnrichmentError,
} from "./errors.ts";
import { createObsidianApplyServices, desktopVaultRoot } from "./obsidian-adapter.ts";
import {
  ENRICHMENT_REVIEW_VIEW_TYPE,
  EnrichmentReviewView,
  type EnrichmentApplyPayload,
} from "./review-view.ts";
import { emptyReviewState, type EnrichmentReviewState } from "./workflow.ts";
import { createWorkflowSnapshot } from "../local-ai-readiness.ts";

interface ActiveEnrichment {
  token: number;
  file: TFile;
  view: EnrichmentReviewView;
  viewClosed: boolean;
  state: EnrichmentReviewState;
  abortController: AbortController | null;
  request?: OmdEnrichRequest;
  catalogById?: ReadonlyMap<string, EnrichmentCandidate>;
}

export class EnrichmentWorkflowController {
  private readonly plugin: OmdHomePlugin;
  private active: ActiveEnrichment | null = null;
  private nextToken = 0;

  constructor(plugin: OmdHomePlugin) {
    this.plugin = plugin;
  }

  get phase(): EnrichmentReviewState["phase"] | null {
    return this.active?.state.phase ?? null;
  }

  /**
   * Only model generation is cancellable. An open review pane is an idle UI
   * state, while Apply and Done reviewing are short guarded vault writes.
   */
  get canCancel(): boolean {
    const phase = this.active?.state.phase;
    return phase === "capability" || phase === "catalog" || phase === "generating";
  }

  async start(file: TFile): Promise<void> {
    await this.open(file, true);
  }

  async review(file: TFile): Promise<void> {
    await this.open(file, false);
  }

  private async open(file: TFile, autoGenerate: boolean): Promise<void> {
    if (file.extension !== "md") {
      new Notice("Open a Markdown note first.");
      return;
    }
    if (this.active?.state.phase === "applying" || this.active?.state.phase === "finishing") {
      new Notice("Wait for the active OMD review write to finish before opening another note.");
      return;
    }
    if (autoGenerate && this.plugin.captureActive) {
      new Notice("Wait for the active OMD capture to finish, or cancel it first.");
      return;
    }

    this.abandonCurrent();
    const model = this.plugin.settings.localWritingModel;
    const endpoint = this.plugin.settings.ollamaHost;
    const token = ++this.nextToken;
    const state = emptyReviewState(file.path, model, endpoint);
    await this.plugin.app.workspace.openLinkText(file.path, "", false);
    if (token !== this.nextToken) return;
    const leaf = await this.plugin.app.workspace.ensureSideLeaf(
      ENRICHMENT_REVIEW_VIEW_TYPE,
      "right",
      { active: true, reveal: true },
    );
    await leaf.loadIfDeferred();
    if (token !== this.nextToken) return;
    if (!(leaf.view instanceof EnrichmentReviewView)) {
      new Notice("OMD review is still loading. Try again.");
      return;
    }

    const active: ActiveEnrichment = {
      token,
      file,
      view: leaf.view,
      viewClosed: false,
      state,
      abortController: null,
    };
    active.view.bindTarget(state, {
      onGenerate: async () => await this.generate(active),
      onCancelGeneration: () => { this.cancel(false); },
      onApply: async (payload) => await this.apply(active, payload),
      onDoneReviewing: async () => await this.doneReviewing(active),
      onClose: () => this.viewClosed(active),
      onOpenPath: async (path) => {
        await this.plugin.app.workspace.openLinkText(path, file.path, false);
      },
    });
    this.active = active;
    this.setBusy(false);
    if (autoGenerate) await this.generate(active);
  }

  private async generate(active: ActiveEnrichment): Promise<void> {
    if (!this.isCurrent(active)) return;
    if (this.plugin.captureActive) {
      new Notice("Wait for the active OMD capture to finish, or cancel it first.");
      return;
    }
    if (active.state.phase === "applying" || active.state.phase === "finishing") return;

    active.abortController?.abort();
    this.plugin.omdEnrichmentRunner.cancel();
    const abortController = new AbortController();
    active.abortController = abortController;
    active.request = undefined;
    active.catalogById = undefined;
    active.state = {
      ...emptyReviewState(active.file.path, this.plugin.settings.localWritingModel, this.plugin.settings.ollamaHost),
      phase: "capability",
      statusText: "Checking that this OMD installation can generate suggestions.",
    };
    active.view.updateState(active.state);
    this.plugin.clearEnrichmentIssue();
    this.setBusy(true);

    try {
      const executable = await this.plugin.requireReadyOmdExecutable();
      await this.plugin.omdCapabilityService.requireEnrichNote(executable, abortController.signal);
      if (!this.isCurrent(active)) return;

      const snapshot = createWorkflowSnapshot("enrichment", this.plugin.settings);
      const { response, request, catalogById } = await this.plugin.runLocalAiGated(
        snapshot,
        () => createWorkflowSnapshot("enrichment", this.plugin.settings),
        async (gatedSnapshot) => {
          this.update(active, {
            phase: "catalog",
            statusText: "Inspecting safe Markdown paths and ranking related vault notes.",
          });
          const built = await buildEnrichmentRequest(
            this.plugin.app,
            active.file,
            gatedSnapshot.model,
            gatedSnapshot.host,
          );
          if (!this.isCurrent(active)) throw new Error("Enrichment workflow changed while preparing the request.");
          active.request = built.request;
          active.catalogById = built.catalogById;
          this.update(active, {
            phase: "generating",
            statusText: "OMD is asking the configured local model for a read-only proposal.",
          });
          const generated = await this.plugin.omdEnrichmentRunner.run({
            executable,
            request: built.request,
            onEvent: (event) => {
              if (!this.isCurrent(active)) return;
              this.pushEvent(event);
              this.update(active, { statusText: progressText(event) });
            },
          });
          return {
            response: generated.response,
            request: built.request,
            catalogById: built.catalogById,
          };
        },
        abortController.signal,
      );
      if (!this.isCurrent(active)) return;

      active.state = reviewState(request, response, catalogById);
      active.abortController = null;
      active.view.updateState(active.state);
      this.plugin.clearEnrichmentIssue();
      // Review is intentionally idle: users can edit the note or run a capture
      // while the non-modal pane remains open.
      this.setBusy(false);
    } catch (error) {
      if (!this.isCurrent(active) || active.abortController !== abortController) return;
      active.abortController = null;
      const failure = describeEnrichmentFailure(error, "generation");
      const cancelled = failure.phase === "cancelled";
      this.update(active, failure);
      this.setBusy(false);
      this.pushEvent({
        v: 1,
        event: cancelled ? "cancelled" : "error",
        kind: cancelled ? "cancelled" : isEnrichmentError(error) ? error.code : "error",
        ts: Date.now() / 1000,
        message: failure.statusText,
      });
      if (!cancelled) {
        this.plugin.reportEnrichmentIssue(error, active.file.path);
        new Notice(failure.statusText);
      }
    }
  }

  cancel(showIdleNotice = true): boolean {
    const active = this.active;
    if (!active) {
      if (showIdleNotice) new Notice("OMD is idle");
      return false;
    }
    if (!this.canCancel || !active.abortController) {
      if (showIdleNotice) new Notice("No suggestion generation is running.");
      return false;
    }
    const abortController = active.abortController;
    active.abortController = null;
    abortController.abort();
    this.plugin.omdEnrichmentRunner.cancel();
    this.update(active, {
      phase: "cancelled",
      statusText: "Suggestion generation stopped. No note changes were made.",
    });
    this.setBusy(false);
    this.pushEvent({
      v: 1,
      event: "cancelled",
      kind: "cancelled",
      ts: Date.now() / 1000,
      message: "Note enrichment cancelled",
    });
    return true;
  }

  dispose(): void {
    this.abandonCurrent();
  }

  private async apply(active: ActiveEnrichment, payload: EnrichmentApplyPayload): Promise<void> {
    if (!this.isCurrent(active) || !active.request || !active.catalogById) return;
    // Keep this check before the phase transition and before the first await.
    // Capture claims its side of the mutex synchronously, so Apply can never
    // begin writing across an already-active capture.
    if (this.plugin.captureActive) {
      new Notice("Wait for the active OMD capture to finish, or cancel it first.");
      return;
    }
    this.update(active, {
      phase: "applying",
      statusText: "Revalidating the note and selected candidates before writing.",
    });
    this.setBusy(true);

    try {
      const selectedLinks = payload.selectedSuggestions.filter((item) => item.kind === "existing-link");
      const selectedTags = payload.selectedSuggestions
        .filter((item) => item.kind === "existing-tag" || item.kind === "new-tag")
        .map((item) => item.label.replace(/^#/u, ""));
      const plan: ApplyEnrichmentPlan = {
        targetPath: active.request.note.path,
        originalContent: active.request.note.content,
        originalHash: active.request.note.content_sha256,
        linkCandidates: active.state.existingLinks
          .filter((item) => item.path)
          .map((item) => ({ id: item.id, path: item.path!, display: item.label })),
        selectedCandidateIds: selectedLinks.map((item) => item.id),
        selectedTags,
        selectedSummary: payload.selection.includeSummary ? payload.selection.summaryDraft : undefined,
        markReviewed: false,
      };
      const result = await applyEnrichmentSelection(
        plan,
        createObsidianApplyServices(this.plugin.app, desktopVaultRoot(this.plugin.app)),
      );
      if (!this.isCurrent(active)) return;

      const phase = result.status === "applied" ? "applied"
        : result.status === "conflict" ? "conflict"
          : result.status === "partial-failure" ? "partial-failure"
            : "error";
      const statusText = result.status === "applied"
        ? `${describeAppliedSelection(result)} The note remains in Inbox.`
        : result.message;
      this.update(active, { phase, statusText });
      this.setBusy(false);
      this.plugin.clearEnrichmentIssue();
      this.plugin.refreshHomeViews();
      if (active.viewClosed) this.active = null;
      new Notice(statusText);
    } catch (error) {
      if (!this.isCurrent(active)) return;
      const failure = describeEnrichmentFailure(error, "apply");
      this.update(active, failure);
      this.setBusy(false);
      this.pushEvent({
        v: 1,
        event: "error",
        kind: isEnrichmentError(error) ? error.code : "error",
        ts: Date.now() / 1000,
        message: failure.statusText,
      });
      if (failure.phase !== "cancelled") {
        this.plugin.reportEnrichmentIssue(error, active.file.path);
        new Notice(failure.statusText);
      }
    }
  }

  private async doneReviewing(active: ActiveEnrichment): Promise<void> {
    if (!this.isCurrent(active)) return;
    if (active.state.phase === "capability" || active.state.phase === "catalog" || active.state.phase === "generating") {
      new Notice("Wait for suggestion generation to finish, or cancel it first.");
      return;
    }
    if (active.state.phase === "applying" || active.state.phase === "finishing" || active.state.phase === "partial-failure") return;

    this.update(active, {
      phase: "finishing",
      statusText: "Saving Reviewed status. Existing note edits are preserved.",
    });
    this.setBusy(true);
    try {
      const file = this.plugin.app.vault.getFileByPath(active.file.path);
      if (!(file instanceof TFile) || file !== active.file) {
        this.update(active, {
          phase: "unavailable",
          statusText: "The target note was removed or replaced. It was not marked Reviewed.",
        });
        return;
      }
      await this.plugin.refreshInboxStatus(file, "reviewed");
      if (!this.isCurrent(active)) return;
      this.update(active, {
        phase: "reviewed",
        statusText: "Review complete. The note is now marked Reviewed.",
      });
      this.plugin.clearEnrichmentIssue();
      new Notice("Review complete. The note is marked reviewed.");
    } catch {
      if (!this.isCurrent(active)) return;
      this.update(active, {
        phase: "error",
        statusText: "OMD Home could not mark this note Reviewed. Its content and Inbox status were left as they are.",
        canRetry: false,
      });
      new Notice("Could not mark this note reviewed. Try again from OMD inbox.");
    } finally {
      if (this.isCurrent(active)) {
        this.setBusy(false);
        this.plugin.refreshHomeViews();
        if (active.viewClosed) this.active = null;
      }
    }
  }

  private update(active: ActiveEnrichment, patch: Partial<EnrichmentReviewState>): void {
    if (!this.isCurrent(active)) return;
    active.state = { ...active.state, ...patch };
    active.view.updateState(active.state);
    this.plugin.refreshHomeViews();
  }

  private isCurrent(active: ActiveEnrichment): boolean {
    return this.active?.token === active.token;
  }

  private setBusy(value: boolean): void {
    this.plugin.enrichmentActive = value;
    this.plugin.refreshHomeViews();
  }

  private viewClosed(active: ActiveEnrichment): void {
    if (!this.isCurrent(active)) return;
    active.viewClosed = true;
    if (active.state.phase === "applying" || active.state.phase === "finishing") return;
    active.abortController?.abort();
    active.abortController = null;
    this.plugin.omdEnrichmentRunner.cancel();
    this.active = null;
    this.setBusy(false);
  }

  private abandonCurrent(): void {
    const active = this.active;
    this.active = null;
    this.nextToken += 1;
    active?.abortController?.abort();
    if (active?.abortController) this.plugin.omdEnrichmentRunner.cancel();
    this.setBusy(false);
  }

  private pushEvent(event: OmdEnrichEvent | OmdProgressEvent): void {
    this.plugin.processingEvents.push(toProgressEvent(event));
    this.plugin.processingEvents = this.plugin.processingEvents.slice(-40);
    this.plugin.refreshHomeViews();
  }
}

function describeAppliedSelection(result: Extract<Awaited<ReturnType<typeof applyEnrichmentSelection>>, { status: "applied" }>): string {
  const items = [
    result.appliedSummary ? "summary" : null,
    result.appliedLinks ? `${result.appliedLinks} ${result.appliedLinks === 1 ? "link" : "links"}` : null,
    result.appliedTags ? `${result.appliedTags} ${result.appliedTags === 1 ? "tag" : "tags"}` : null,
  ].filter((item): item is string => item !== null);
  return `Saved ${items.join(", ")}.`;
}

function reviewState(
  request: OmdEnrichRequest,
  response: EnrichmentResponse,
  catalogById: ReadonlyMap<string, EnrichmentCandidate>,
): EnrichmentReviewState {
  return {
    phase: "review",
    targetPath: request.note.path,
    model: response.generation.model,
    endpoint: request.host,
    summary: response.proposal.summary,
    existingLinks: response.proposal.existing_links.map((item) => ({
      id: item.candidate_id,
      kind: "existing-link",
      label: item.display,
      path: catalogById.get(item.candidate_id)?.path ?? item.target_path,
      evidence: item.evidence,
      detail: item.reason,
      selected: item.recommended,
    })),
    existingTags: response.proposal.existing_tags.map((item) => ({
      id: `existing-tag:${item.tag}`,
      kind: "existing-tag",
      label: `#${item.tag}`,
      evidence: item.reason,
      selected: item.recommended,
    })),
    newTags: response.proposal.new_tags.map((item) => ({
      id: `new-tag:${item.tag}`,
      kind: "new-tag",
      label: `#${item.tag}`,
      evidence: item.reason,
      selected: false,
    })),
    concepts: response.proposal.new_concepts.map((item) => ({
      id: `concept:${item.label}`,
      kind: "new-concept",
      label: item.label,
      evidence: item.reason,
      selectable: false,
    })),
    warnings: response.warnings,
    statusText: "Review the proposal and choose what OMD Home may write.",
  };
}

function toProgressEvent(event: OmdEnrichEvent | OmdProgressEvent): OmdProgressEvent {
  const raw = event as Record<string, unknown>;
  return {
    v: typeof raw.v === "number" ? raw.v : 1,
    event: typeof raw.event === "string" ? raw.event : "stage",
    ts: typeof raw.ts === "number" ? raw.ts : Date.now() / 1000,
    message: typeof raw.message === "string" ? raw.message : undefined,
    kind: typeof raw.kind === "string" ? raw.kind : undefined,
    percent: typeof raw.percent === "number" ? raw.percent : undefined,
    label: typeof raw.label === "string" ? raw.label : enrichmentProgressLabel(raw),
    name: typeof raw.name === "string" ? raw.name : undefined,
  };
}

function enrichmentProgressLabel(event: Record<string, unknown>): string {
  const stage = [event.stage_id, event.stage, event.name, event.event]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? "stage";
  const token = stage.toLowerCase();
  if (token.includes("llm") || token.includes("generat")) return "Local AI proposal";
  if (token.includes("catalog") || token.includes("inspect") || token.includes("rank")) return "Inspect vault";
  if (token.includes("valid") || token.includes("parse")) return "Validate proposal";
  return humanize(stage);
}

function progressText(event: OmdEnrichEvent): string {
  const stage = typeof event.stage_id === "string" ? event.stage_id
    : typeof event.stage === "string" ? event.stage
      : typeof event.name === "string" ? event.name
        : event.event;
  return `${humanize(stage)}${typeof event.percent === "number" ? ` · ${Math.round(event.percent)}%` : ""}`;
}

function humanize(value: string): string {
  const normalized = value.replace(/[_-]+/gu, " ").trim();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "OMD is working";
}
