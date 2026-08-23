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
import { isEnrichmentError, toUserFacingEnrichmentMessage } from "./errors.ts";
import { createObsidianApplyServices, desktopVaultRoot } from "./obsidian-adapter.ts";
import { EnrichmentReviewModal, type EnrichmentApplyPayload } from "./review-modal.ts";
import { emptyReviewState, type EnrichmentReviewState } from "./workflow.ts";
import { createWorkflowSnapshot } from "../local-ai-readiness.ts";

interface ActiveEnrichment {
  token: number;
  file: TFile;
  modal: EnrichmentReviewModal;
  state: EnrichmentReviewState;
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

  async start(file: TFile): Promise<void> {
    if (file.extension !== "md") {
      new Notice("Open a Markdown note first.");
      return;
    }
    if (this.plugin.captureActive) {
      new Notice("Wait for the active OMD capture to finish, or cancel it first.");
      return;
    }

    this.cancel(false);
    const model = this.plugin.settings.enrichmentModel;
    const endpoint = this.plugin.settings.ollamaHost;
    const token = ++this.nextToken;
    const state = emptyReviewState(file.path, model, endpoint);
    const active = {} as ActiveEnrichment;
    const modal = new EnrichmentReviewModal(this.plugin.app, state, {
      onCancel: () => {
        this.cancel();
      },
      onApply: async (payload) => await this.apply(active, payload),
      onRetry: async () => {
        this.plugin.omdCapabilityService.clear(this.plugin.settings.omdExecutable);
        await this.start(file);
      },
      onOpenPath: (path) => {
        void this.plugin.app.workspace.openLinkText(path, file.path, false);
      },
    });
    Object.assign(active, { token, file, modal, state });
    this.active = active;
    this.plugin.clearEnrichmentIssue();
    this.setBusy(true);
    modal.open();

    try {
      await this.plugin.omdCapabilityService.requireEnrichNote(this.plugin.settings.omdExecutable);
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
            file,
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
            executable: this.plugin.settings.omdExecutable,
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
      );
      if (!this.isCurrent(active)) return;

      active.state = reviewState(request, response, catalogById);
      active.modal.setState(active.state);
      this.plugin.clearEnrichmentIssue();
      this.setBusy(false);
    } catch (error) {
      if (!this.isCurrent(active)) return;
      const cancelled = (isEnrichmentError(error) && error.code === "cancelled")
        || (error instanceof Error && error.name === "AbortError");
      const detail = toUserFacingEnrichmentMessage(error);
      this.update(active, {
        phase: cancelled ? "cancelled" : "error",
        statusText: detail,
        detailText: cancelled
          ? "No proposal changes were written."
          : "Check OMD, Ollama, the model, and the configured loopback endpoint, then try again.",
      });
      this.active = null;
      this.setBusy(false);
      this.pushEvent({
        v: 1,
        event: cancelled ? "cancelled" : "error",
        kind: cancelled ? "cancelled" : isEnrichmentError(error) ? error.code : "error",
        ts: Date.now() / 1000,
        message: detail,
      });
      if (!cancelled) {
        this.plugin.reportEnrichmentIssue(error, file.path);
        new Notice(detail);
      }
    }
  }

  cancel(showIdleNotice = true): boolean {
    const active = this.active;
    if (!active) {
      if (showIdleNotice) new Notice("OMD is idle");
      return false;
    }
    this.active = null;
    this.plugin.cancelLocalAiRequests();
    this.plugin.omdEnrichmentRunner.cancel();
    this.plugin.omdCapabilityService.cancelActive(this.plugin.settings.omdExecutable);
    this.setBusy(false);
    this.pushEvent({
      v: 1,
      event: "cancelled",
      kind: "cancelled",
      ts: Date.now() / 1000,
      message: "Note enrichment cancelled",
    });
    active.modal.closeWithoutCallback();
    return true;
  }

  dispose(): void {
    this.cancel(false);
  }

  private async apply(active: ActiveEnrichment, payload: EnrichmentApplyPayload): Promise<void> {
    if (!this.isCurrent(active) || !active.request || !active.catalogById) return;
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
        ? `Applied ${result.appliedLinks} links and ${result.appliedTags} tags.`
        : result.message;
      this.update(active, { phase, statusText });
      this.active = null;
      this.setBusy(false);
      this.plugin.clearEnrichmentIssue();
      this.plugin.refreshHomeViews();
      new Notice(statusText);
    } catch (error) {
      if (!this.isCurrent(active)) return;
      const detail = toUserFacingEnrichmentMessage(error);
      this.update(active, { phase: "error", statusText: detail });
      this.active = null;
      this.setBusy(false);
      this.pushEvent({
        v: 1,
        event: "error",
        kind: isEnrichmentError(error) ? error.code : "error",
        ts: Date.now() / 1000,
        message: detail,
      });
      this.plugin.reportEnrichmentIssue(detail, active.file.path);
      new Notice(detail);
    }
  }

  private update(active: ActiveEnrichment, patch: Partial<EnrichmentReviewState>): void {
    if (!this.isCurrent(active)) return;
    active.state = { ...active.state, ...patch };
    active.modal.setState(active.state);
    this.plugin.refreshHomeViews();
  }

  private isCurrent(active: ActiveEnrichment): boolean {
    return this.active?.token === active.token;
  }

  private setBusy(value: boolean): void {
    this.plugin.enrichmentActive = value;
    this.plugin.refreshHomeViews();
  }

  private pushEvent(event: OmdEnrichEvent | OmdProgressEvent): void {
    this.plugin.processingEvents.push(toProgressEvent(event));
    this.plugin.processingEvents = this.plugin.processingEvents.slice(-40);
    this.plugin.refreshHomeViews();
  }
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
