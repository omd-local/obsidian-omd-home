import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  aiProviderDestination,
  aiProviderEnvVar,
  aiProviderLabel,
  isHostedApiProvider,
  modelIsCloudBacked,
  modelIsVerifiedOllamaCloud,
  selectedAiModel,
} from "../src/ai-provider.ts";
import {
  aggregateLocalAiState,
  buildConnectionSummary,
  buildModelEntry,
  deriveLocalAiDaemonCode,
  deriveLocalAiModelCode,
  describeDaemonReadiness,
  describeLocalCompletionCatalog,
  describeModelReadiness,
  localModelNamesMatch,
  mergeInspectedModelEntry,
  modelSupportsEmbedding,
  normalizeLocalOllamaHost,
  oneClickInstallableEmbeddingModel,
} from "../src/local-ai-readiness.ts";
import { LocalAiError, type LocalAiModelInfo, type LocalAiRuntimeState } from "../src/ollama-local-types.ts";
import { socialCaptureProvider } from "../src/omnibox-utils.ts";
import {
  CALENDAR_DETACH_CONFIRMATION,
  CALENDAR_EVENT_DELETE_CONFIRMATION,
  CALENDAR_NOTE_DELETE_CONFIRMATION,
  CALENDAR_RECREATE_CONFIRMATION,
  CalendarPartialActionError,
  calendarFetchWindow,
  calendarIdentityKeys,
  classifyLinkedAvailability,
  classifyLinkedChange,
  detachLinkedEvent,
  eventSyncHash,
  isCalendarNoteErrorRecord,
  linkedEventSaveBlockReason,
  mergeExternalIntoLinked,
  resolveCalendarWriteOverride,
  stableExternalCandidates,
  summarizeCalendarSync,
} from "../src/calendar-sync.ts";
import { recordFromFrontmatter, serializeEventNote, updateEventNote } from "../src/event-note.ts";
import {
  EventKitMutationError,
  eventKitMutationDefinitelyDidNotCommit,
  normalizeEventKitEvent,
} from "../src/eventkit-bridge.ts";
import { CalendarSnapshotChangedError, calendarEventVersion } from "../src/calendar-safety.ts";
import type { CalendarEventRecord } from "../src/model.ts";

// Execute the production methods with injected Obsidian/bridge boundaries. This
// keeps async race regressions runnable without loading the desktop application.
type Harness = Record<string, any>;

function loadMethods(file: string, names: string[], dependencies: Record<string, unknown> = {}): Harness {
  const source = ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
  const members = source.statements.flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : []);
  const methods = names.map((name) => {
    const member = members.find((node) => node.name?.getText(source) === name);
    assert.ok(member, `Missing production member ${name}`);
    return member.getText(source);
  });
  const helpers = source.statements.filter((node) => ts.isFunctionDeclaration(node)
    && ["buildHostedState", "humanizeRetrievalWarning", "isEmbeddingRetrievalWarning", "mapHostedErrorCode", "message", "isAbortError", "isModelReadinessCode", "remapLocalAiError", "retrievalWarningForError", "waitForSharedPromise"].includes(node.name?.text ?? ""));
  const compiled = ts.transpileModule(
    `${helpers.map((node) => node.getText(source)).join("\n")}\nclass Harness { ${methods.join("\n")} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const resolvedDependencies = {
    CALENDAR_DETACH_CONFIRMATION,
    CALENDAR_EVENT_DELETE_CONFIRMATION,
    CALENDAR_NOTE_DELETE_CONFIRMATION,
    CALENDAR_RECREATE_CONFIRMATION,
    CalendarPartialActionError,
    eventKitMutationDefinitelyDidNotCommit,
    eventSyncHash,
    isCalendarNoteErrorRecord,
    stableExternalCandidates,
    ...dependencies,
  };
  return new Function(...Object.keys(resolvedDependencies), `${compiled}\nreturn new Harness();`)(...Object.values(resolvedDependencies)) as Harness;
}

function readMethod(file: string, name: string): string {
  const source = ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true);
  const member = source.statements
    .flatMap((node) => ts.isClassDeclaration(node) ? [...node.members] : [])
    .find((node) => node.name?.getText(source) === name);
  assert.ok(member, `Missing production member ${name}`);
  return member.getText(source);
}

function mainHarness(extraMethods: string[] = [], dependencies: Record<string, unknown> = {}): Harness {
  const notices: string[] = [];
  const plugin = loadMethods("src/main.ts", [
    "currentHostedProvider", "ensureHostedCredentialState", "loadHostedCredentialState", "syncHostedAiState",
    "beginHostedAiAction", "isCurrentHostedAiAction", "finishHostedAiAction", "checkHostedAiConnection",
    "hostedAiSignal", "cancelHostedAiAction", "invalidateCloudAnswerConsent", "saveHostedApiKey",
    "deleteHostedApiKey", "assertCloudConsentStillCurrent", "withLocalAiSignal", "aiSetupBusy", "canStartAiSetupAction",
    "beginHostedCredentialMutation", "finishHostedCredentialMutation", "assertProviderDestination", "renderRetrievalDiagnostics",
    "withCloudAnswerSignal", "cancelCloudAnswerRequests", ...extraMethods,
  ], {
    Notice: class { constructor(value: string) { notices.push(value); } },
    providerLabel: aiProviderLabel,
    providerDomain: aiProviderDestination,
    aiProviderLabel,
    aiProviderDestination,
    isHostedApiProvider,
    LocalAiError,
    oneClickInstallableEmbeddingModel,
    selectedAiModel,
    ...dependencies,
  });
  Object.assign(plugin, {
    settings: { aiProvider: "openai", aiModel: "", aiModels: { openai: "" }, omdExecutable: "omd" },
    unloaded: false,
    localAiActionToken: 0,
    localAiControllers: new Set<AbortController>(),
    cloudAnswerControllers: new Set<AbortController>(),
    hostedCredentialHydration: null,
    hostedCredentialHydrationProvider: null,
    hostedCredentialHydrationActionToken: null,
    hostedAiController: null,
    hostedCredentialMutation: null,
    cloudAnswerConsentGeneration: 0,
    cloudAnswerConsentModals: new Set(),
    localAiState: { activeAction: "" },
    hostedAiState: null,
    notices,
    feedback: [] as string[],
    issues: [] as unknown[],
    refreshHomeViews() {},
    clearIssue() {},
    recordIssue(_context: string, error: unknown) { plugin.issues.push(error); },
    setLocalAiFeedback(_tone: string, detail: string) { plugin.feedback.push(detail); },
    requireReadyOmdExecutable: async () => "/Applications/OMD/bin/omd",
  });
  plugin.syncHostedAiState("");
  return plugin;
}

test("Calendar refresh tracking follows every known type:event note, not only the managed folder", () => {
  class TestFile {
    readonly path: string;
    readonly extension: string;
    constructor(path: string) {
      this.path = path;
      this.extension = path.endsWith(".md") ? "md" : "";
    }
  }
  const frontmatter = new Map<string, Record<string, unknown>>([
    ["Projects/Launch.md", { type: "event" }],
    ["Projects/Notes.md", { type: "note" }],
  ]);
  const files = new Map([...frontmatter.keys()].map((path) => [path, new TestFile(path)]));
  const plugin = loadMethods("src/main.ts", ["isCalendarEventPath"], { TFile: TestFile });
  Object.assign(plugin, {
    calendarEvents: [{ notePath: "Archive/Known event.md" }],
    app: {
      vault: { getFileByPath: (path: string) => files.get(path) ?? null },
      metadataCache: {
        getFileCache: (file: TestFile) => ({ frontmatter: frontmatter.get(file.path) }),
      },
    },
  });

  assert.equal(plugin.isCalendarEventPath("Calendar/Events/New.md"), true);
  assert.equal(plugin.isCalendarEventPath("Archive/Known event.md"), true);
  assert.equal(plugin.isCalendarEventPath("Projects/Launch.md"), true);
  assert.equal(plugin.isCalendarEventPath("Projects/Notes.md"), false);
  assert.equal(plugin.isCalendarEventPath("Projects/image.png"), false);
});

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, rejectPromise) => { resolveValue = resolve; reject = rejectPromise; });
  return { promise, resolve: resolveValue, reject };
}

test("calendar sync reads current event frontmatter before classifying simultaneous edits", async () => {
  const baseline = {
    id: "evt_conflict",
    title: "CAL-03 baseline",
    start: "2026-10-06T08:00:00.000Z",
    end: "2026-10-06T09:00:00.000Z",
    allDay: false,
    calendar: "Activity",
    source: "linked" as const,
    notePath: "Calendar/Events/CAL-03.md",
    appleCalendarId: "cal_1",
    appleItemId: "item_1",
    appleExternalId: "external_1",
  };
  const syncHash = eventSyncHash(baseline);
  const staleFrontmatter = {
    type: "event", "event-id": baseline.id, title: baseline.title,
    start: baseline.start, end: baseline.end, "all-day": false,
    calendar: baseline.calendar, "event-source": "linked",
    "apple-calendar-id": baseline.appleCalendarId,
    "apple-item-id": baseline.appleItemId,
    "apple-external-id": baseline.appleExternalId,
    "sync-hash": syncHash,
  };
  const currentFrontmatter = { ...staleFrontmatter, title: "CAL-03 – Note 1" };
  const external = {
    ...baseline,
    title: "CAL-03 – Calendar 1",
    source: "external" as const,
    syncHash: undefined,
  };
  const plugin = loadMethods("src/main.ts", [
    "readCalendarNoteSnapshot", "calendarNoteErrorRecord", "performCalendarRefresh",
  ], {
    Platform: { isMacOS: true },
    getFrontMatterInfo: () => ({ exists: true, frontmatter: "current" }),
    parseYaml: () => currentFrontmatter,
    recordFromFrontmatter,
    resolveCalendarWriteOverride,
    calendarFetchWindow,
    calendarIdentityKeys,
    stableExternalCandidates,
    classifyLinkedAvailability,
    classifyLinkedChange,
    mergeExternalIntoLinked,
    summarizeCalendarSync,
  });
  let noteWrites = 0;
  let calendarWrites = 0;
  Object.assign(plugin, {
    app: {
      vault: {
        getMarkdownFiles: () => [{ path: baseline.notePath, stat: { mtime: 123 } }],
        read: async () => "---\ntitle: current\n---\n",
      },
      metadataCache: { getFileCache: () => ({ frontmatter: staleFrontmatter }) },
    },
    settings: { selectedCalendarIds: ["cal_1"] },
    eventKitBridge: { events: async () => [external] },
    hasEventKitHelper: () => true,
    calendarWriteOverrides: new Map([[baseline.notePath, {
      event: { ...baseline, title: "Stale override must not replace raw Markdown" },
      modifiedAt: 123,
    }]]),
    calendarEvents: [],
    writeCalendarNote: async () => { noteWrites += 1; },
    pushLinkedEventToCalendar: async () => { calendarWrites += 1; },
    clearIssue() {},
    recordIssue() {},
    refreshOpenViews() {},
  });

  const summary = await plugin.performCalendarRefresh(true);

  assert.deepEqual(summary, { conflicts: 1, unavailable: 0, errors: 0, pending: 0 });
  assert.equal(plugin.calendarEvents[0].title, "CAL-03 – Note 1");
  assert.equal(plugin.calendarEvents[0].conflictExternal.title, "CAL-03 – Calendar 1");
  assert.equal(plugin.calendarEvents[0].syncState, "conflict");
  assert.equal(plugin.calendarWriteOverrides.size, 0, "a parsed raw snapshot retires its metadata-lag override");
  assert.equal(noteWrites, 0);
  assert.equal(calendarWrites, 0);
});

test("calendar sync surfaces invalid YAML as a per-note error without starting Calendar writes", async () => {
  let eventKitReads = 0;
  const plugin = loadMethods("src/main.ts", [
    "readCalendarNoteSnapshot", "calendarNoteErrorRecord", "performCalendarRefresh",
  ], {
    Platform: { isMacOS: false },
    getFrontMatterInfo: () => ({ exists: true, frontmatter: "title: [" }),
    parseYaml: () => { throw new Error("bad yaml"); },
    summarizeCalendarSync,
  });
  Object.assign(plugin, {
    app: {
      vault: {
        getMarkdownFiles: () => [{ path: "Calendar/Events/broken.md", stat: { mtime: 123 } }],
        read: async () => "---\ntitle: [\n---\n",
      },
      metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
    },
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    eventKitBridge: { events: async () => { eventKitReads += 1; return []; } },
    refreshOpenViews() {},
  });

  const summary = await plugin.performCalendarRefresh(true);
  assert.deepEqual(summary, { conflicts: 0, unavailable: 0, errors: 1, pending: 0 });
  assert.match(plugin.calendarEvents[0].title, /Cannot sync broken\.md: YAML frontmatter is invalid/);
  assert.equal(plugin.calendarEvents[0].syncState, "error");
  assert.equal(eventKitReads, 0, "no Calendar read or write may start from an invalid note snapshot");
});

test("calendar sync keeps path-managed notes with missing or invalid event schema visible as errors", async () => {
  const files = [
    { path: "Calendar/Events/no-frontmatter.md", stat: { mtime: 100 } },
    { path: "Calendar/Events/bad-schema.md", stat: { mtime: 200 } },
  ];
  const markdown = new Map([
    [files[0].path, "# No frontmatter"],
    [files[1].path, "---\ntype: event\ntitle: Missing dates\n---\n"],
  ]);
  const plugin = loadMethods("src/main.ts", [
    "readCalendarNoteSnapshot", "calendarNoteErrorRecord", "performCalendarRefresh",
  ], {
    Platform: { isMacOS: false },
    getFrontMatterInfo: (value: string) => value.startsWith("---")
      ? { exists: true, frontmatter: "schema" }
      : { exists: false, frontmatter: "" },
    parseYaml: () => ({ type: "event", title: "Missing dates" }),
    recordFromFrontmatter,
    resolveCalendarWriteOverride,
    summarizeCalendarSync,
  });
  Object.assign(plugin, {
    app: {
      vault: { getMarkdownFiles: () => files, read: async (file: { path: string }) => markdown.get(file.path) },
      metadataCache: { getFileCache: () => null },
    },
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    settings: { selectedCalendarIds: [] },
    refreshOpenViews() {},
  });

  const summary = await plugin.performCalendarRefresh(false);
  assert.deepEqual(summary, { conflicts: 0, unavailable: 0, errors: 2, pending: 0 });
  assert.match(plugin.calendarEvents[0].title, /YAML frontmatter is missing/);
  assert.match(plugin.calendarEvents[1].title, /missing required event fields/);
});

test("calendar sync preserves the concrete EventKit failure instead of reporting completion", async () => {
  const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
    Platform: { isMacOS: true },
    calendarFetchWindow,
    summarizeCalendarSync,
  });
  Object.assign(plugin, {
    app: {
      vault: { getMarkdownFiles: () => [] },
      metadataCache: { getFileCache: () => null },
    },
    settings: { selectedCalendarIds: ["cal_1"] },
    eventKitBridge: { events: async () => { throw new Error("EventKit timed out"); } },
    hasEventKitHelper: () => true,
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    lastError: "",
    clearIssue() {},
    recordIssue(_context: string, error: Error) { plugin.lastError = error.message; },
    refreshOpenViews() {},
  });

  await assert.rejects(plugin.performCalendarRefresh(true), /EventKit timed out/);
  assert.deepEqual(plugin.calendarEvents, []);
});

for (const failedRead of ["events", "lookup"] as const) {
  test(`Calendar Sync clears a transient EventKit ${failedRead} failure and heals on retry`, async () => {
    const linked: CalendarEventRecord = {
      id: "evt_retry", title: "Retry fixture", start: "2026-10-08T10:00:00.000Z",
      end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Activity",
      source: "linked", notePath: "Calendar/Events/retry.md", appleCalendarId: "cal_1",
      appleItemId: "item_1", appleExternalId: "external_1",
    };
    linked.syncHash = eventSyncHash(linked);
    const outside: CalendarEventRecord = {
      ...linked,
      id: "apple:item_1",
      source: "external",
      notePath: undefined,
      syncHash: undefined,
    };
    let eventReads = 0;
    let lookupReads = 0;
    let currentIssue = "";
    const plugin = loadMethods("src/main.ts", [
      "synchronizeCalendarEvents", "runCalendarRefresh", "performCalendarRefresh",
    ], {
      Platform: { isMacOS: true },
      calendarFetchWindow,
      calendarIdentityKeys,
      stableExternalCandidates,
      classifyLinkedChange,
      mergeExternalIntoLinked,
      summarizeCalendarSync,
    });
    Object.assign(plugin, {
      app: {
        vault: { getMarkdownFiles: () => [{ path: linked.notePath, stat: { mtime: 100 } }] },
        metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
      },
      readCalendarNoteSnapshot: async () => ({ event: linked, markdown: "exact" }),
      settings: { selectedCalendarIds: ["cal_1"] },
      hasEventKitHelper: () => true,
      eventKitBridge: {
        events: async () => {
          eventReads += 1;
          if (failedRead === "events" && eventReads === 1) throw new Error("EventKit transient read failure");
          return failedRead === "events" ? [outside] : [];
        },
        lookup: async () => {
          lookupReads += 1;
          if (failedRead === "lookup" && lookupReads === 1) throw new Error("EventKit transient read failure");
          return outside;
        },
      },
      calendarWriteOverrides: new Map(),
      calendarEvents: [],
      calendarRefresh: null,
      clearIssue() { currentIssue = ""; },
      recordIssue(_context: string, error: Error) { currentIssue = error.message; },
      refreshOpenViews() {},
    });

    await assert.rejects(plugin.synchronizeCalendarEvents(), /EventKit transient read failure/);
    assert.equal(plugin.calendarRefresh, null, "a rejected refresh must release the shared refresh gate");
    assert.equal(plugin.calendarEvents[0].syncState, "error");
    assert.equal(plugin.calendarEvents[0].unavailableReason, "setup-or-read-failure");
    assert.match(currentIssue, /EventKit transient read failure/);

    const summary = await plugin.synchronizeCalendarEvents();
    assert.deepEqual(summary, { conflicts: 0, unavailable: 0, errors: 0, pending: 0 });
    assert.equal(plugin.calendarRefresh, null);
    assert.equal(plugin.calendarEvents[0].syncState, "clean");
    assert.equal(plugin.calendarEvents[0].unavailableReason, undefined);
    assert.equal(currentIssue, "");
    assert.equal(eventReads, 2);
    assert.equal(lookupReads, failedRead === "lookup" ? 2 : 0);
  });
}

test("Calendar refresh queues one later pass and preserves its reconcile intent", async () => {
  const firstEntered = deferred<void>();
  const releaseFirst = deferred<void>();
  const passes: boolean[] = [];
  const plugin = loadMethods("src/main.ts", [
    "refreshCalendarEvents", "synchronizeCalendarEvents", "runCalendarRefresh",
  ]);
  Object.assign(plugin, {
    calendarRefresh: null,
    calendarRefreshQueued: null,
    calendarRefreshQueuedReconcile: false,
    performCalendarRefresh: async (reconcile: boolean) => {
      passes.push(reconcile);
      if (passes.length === 1) {
        firstEntered.resolve();
        await releaseFirst.promise;
        plugin.calendarEvents = [{ id: "deleted-stale" }];
      } else {
        plugin.calendarEvents = [];
      }
      return { conflicts: 0, unavailable: 0, errors: 0, pending: 0 };
    },
    calendarEvents: [],
  });

  const first = plugin.refreshCalendarEvents();
  await firstEntered.promise;
  const afterDelete = plugin.refreshCalendarEvents();
  const explicitSync = plugin.synchronizeCalendarEvents();
  releaseFirst.resolve();
  await Promise.all([first, afterDelete, explicitSync]);

  assert.deepEqual(passes, [false, true], "overlapping requests coalesce into one later pass with Sync intent");
  assert.deepEqual(plugin.calendarEvents, [], "the later pass must remove data restored by a stale in-flight snapshot");
});

test("a queued Calendar refresh still runs after the active pass rejects", async () => {
  const firstEntered = deferred<void>();
  const rejectFirst = deferred<void>();
  let passes = 0;
  const plugin = loadMethods("src/main.ts", ["refreshCalendarEvents", "runCalendarRefresh"]);
  Object.assign(plugin, {
    calendarRefresh: null,
    calendarRefreshQueued: null,
    calendarRefreshQueuedReconcile: false,
    performCalendarRefresh: async () => {
      passes += 1;
      if (passes === 1) {
        firstEntered.resolve();
        await rejectFirst.promise;
        throw new Error("stale pass failed");
      }
      plugin.calendarEvents = [];
      return { conflicts: 0, unavailable: 0, errors: 0, pending: 0 };
    },
    calendarEvents: [{ id: "deleted-stale" }],
  });

  const first = plugin.refreshCalendarEvents();
  const firstFailure = assert.rejects(first, /stale pass failed/);
  await firstEntered.promise;
  const queued = plugin.refreshCalendarEvents();
  rejectFirst.resolve();
  await firstFailure;
  await queued;
  assert.equal(passes, 2);
  assert.deepEqual(plugin.calendarEvents, []);
});

test("a queued Calendar Sync cannot start after OMD Home unloads", async () => {
  const firstEntered = deferred<void>();
  const releaseFirst = deferred<void>();
  const passes: boolean[] = [];
  const plugin = loadMethods("src/main.ts", [
    "refreshCalendarEvents", "synchronizeCalendarEvents", "runCalendarRefresh",
  ]);
  Object.assign(plugin, {
    unloaded: false,
    calendarLifecycleGeneration: 4,
    calendarRefresh: null,
    calendarRefreshQueued: null,
    calendarRefreshQueuedReconcile: false,
    performCalendarRefresh: async (reconcile: boolean) => {
      passes.push(reconcile);
      firstEntered.resolve();
      await releaseFirst.promise;
      return { conflicts: 0, unavailable: 0, errors: 0, pending: 0 };
    },
    calendarEvents: [{ id: "preserved-after-unload" }],
  });

  const active = plugin.refreshCalendarEvents();
  await firstEntered.promise;
  const queued = plugin.synchronizeCalendarEvents();
  plugin.unloaded = true;
  plugin.calendarLifecycleGeneration += 1;
  releaseFirst.resolve();

  await active;
  await assert.rejects(queued, /disabled.*Calendar sync stopped/);
  assert.deepEqual(passes, [false], "the queued reconcile pass must never start in an unloaded lifecycle");
  assert.deepEqual(plugin.calendarEvents, [{ id: "preserved-after-unload" }]);
  assert.equal(plugin.calendarRefresh, null);
  assert.equal(plugin.calendarRefreshQueued, null);
});

for (const direction of ["external", "vault"] as const) {
  test(`Calendar ${direction} reconciliation cannot mutate or publish after unload`, async () => {
    const baseline: CalendarEventRecord = {
      id: `evt_unload_${direction}`,
      title: "Lifecycle baseline",
      start: "2026-10-08T10:00:00.000Z",
      end: "2026-10-08T11:00:00.000Z",
      allDay: false,
      calendar: "Activity",
      source: "linked",
      notePath: `Calendar/Events/unload-${direction}.md`,
      appleCalendarId: "cal_1",
      appleItemId: `item_${direction}`,
      appleExternalId: `external_${direction}`,
      syncState: "clean",
    };
    const syncHash = eventSyncHash(baseline);
    const vault = direction === "vault"
      ? { ...baseline, title: "Changed in Vault", syncHash }
      : { ...baseline, syncHash };
    const outside: CalendarEventRecord = {
      ...baseline,
      title: direction === "external" ? "Changed in Calendar" : baseline.title,
      source: "external",
      notePath: undefined,
      syncHash: undefined,
      externalModifiedAt: "2026-10-08T09:59:00.000Z",
    };
    const mutationEntered = deferred<void>();
    const releaseMutation = deferred<void>();
    let noteWrites = 0;
    let calendarWrites = 0;
    let renders = 0;
    const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
      Platform: { isMacOS: true },
      calendarFetchWindow,
      calendarIdentityKeys,
      stableExternalCandidates,
      classifyLinkedChange,
      mergeExternalIntoLinked,
      summarizeCalendarSync,
      CalendarSnapshotChangedError,
    });
    Object.assign(plugin, {
      unloaded: false,
      calendarLifecycleGeneration: 8,
      app: {
        vault: { getMarkdownFiles: () => [{ path: vault.notePath, stat: { mtime: 100 } }] },
        metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
      },
      readCalendarNoteSnapshot: async () => ({ event: vault, markdown: "exact" }),
      settings: { selectedCalendarIds: ["cal_1"] },
      hasEventKitHelper: () => true,
      eventKitBridge: { events: async () => [outside] },
      calendarWriteOverrides: new Map(),
      calendarEvents: [{ id: "pre-unload-sentinel" }],
      revalidateCalendarWrite: async () => ({
        event: vault,
        external: outside,
        expectedMarkdown: "exact",
        blocked: false,
      }),
      writeCalendarNote: async (
        _event: CalendarEventRecord,
        _expected: string,
        continuationIsCurrent: () => boolean,
      ) => {
        mutationEntered.resolve();
        await releaseMutation.promise;
        if (!continuationIsCurrent()) throw new Error("This Calendar action is no longer current");
        noteWrites += 1;
        return vault;
      },
      pushLinkedEventToCalendar: async (
        _event: CalendarEventRecord,
        _expected: string,
        _outside: CalendarEventRecord,
        continuationIsCurrent: () => boolean,
      ) => {
        mutationEntered.resolve();
        await releaseMutation.promise;
        if (!continuationIsCurrent()) throw new Error("This Calendar action is no longer current");
        calendarWrites += 1;
        return vault;
      },
      clearIssue() {},
      recordIssue() {},
      refreshOpenViews() { renders += 1; },
    });

    const syncing = plugin.performCalendarRefresh(true, 8);
    await mutationEntered.promise;
    plugin.unloaded = true;
    plugin.calendarLifecycleGeneration += 1;
    releaseMutation.resolve();

    await assert.rejects(syncing, /disabled.*Calendar sync stopped/);
    assert.equal(noteWrites, 0);
    assert.equal(calendarWrites, 0);
    assert.equal(renders, 0);
    assert.deepEqual(plugin.calendarEvents, [{ id: "pre-unload-sentinel" }]);
  });
}

test("Calendar refresh cannot publish a fetched snapshot after unload", async () => {
  const eventRead = deferred<CalendarEventRecord[]>();
  let renders = 0;
  let issues = 0;
  const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
    Platform: { isMacOS: true },
    calendarFetchWindow,
    summarizeCalendarSync,
  });
  Object.assign(plugin, {
    unloaded: false,
    calendarLifecycleGeneration: 11,
    app: {
      vault: { getMarkdownFiles: () => [] },
      metadataCache: { getFileCache: () => null },
    },
    settings: { selectedCalendarIds: ["cal_1"] },
    hasEventKitHelper: () => true,
    eventKitBridge: { events: async () => await eventRead.promise },
    calendarWriteOverrides: new Map(),
    calendarEvents: [{ id: "visible-before-unload" }],
    clearIssue() {},
    recordIssue() { issues += 1; },
    refreshOpenViews() { renders += 1; },
  });

  const refreshing = plugin.performCalendarRefresh(false, 11);
  plugin.unloaded = true;
  plugin.calendarLifecycleGeneration += 1;
  eventRead.resolve([]);

  await assert.rejects(refreshing, /disabled.*Calendar sync stopped/);
  assert.equal(issues, 0, "a disposed bridge result must not replace the lifecycle stop reason");
  assert.equal(renders, 0);
  assert.deepEqual(plugin.calendarEvents, [{ id: "visible-before-unload" }]);
});

test("zero selected calendars need no helper, clear stale issues, and mark links deselected", async () => {
  const linked: CalendarEventRecord = {
    id: "evt_deselected", title: "Deselected fixture", start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Old",
    source: "linked", notePath: "Calendar/Events/deselected.md", appleCalendarId: "cal_old",
    appleItemId: "item_old", appleExternalId: "external_1",
  };
  let clearCalls = 0;
  let bridgeCalls = 0;
  const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
    Platform: { isMacOS: true },
    calendarFetchWindow,
    calendarIdentityKeys,
    stableExternalCandidates,
    summarizeCalendarSync,
  });
  Object.assign(plugin, {
    app: {
      vault: { getMarkdownFiles: () => [{ path: linked.notePath, stat: { mtime: 100 } }] },
      metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
    },
    readCalendarNoteSnapshot: async () => ({ event: linked, markdown: "exact" }),
    settings: { selectedCalendarIds: [] },
    hasEventKitHelper: () => false,
    eventKitBridge: {
      events: async () => { bridgeCalls++; return []; },
      lookup: async () => { bridgeCalls++; return null; },
    },
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    clearIssue() { clearCalls++; },
    recordIssue() { assert.fail("zero selection must not report a helper failure"); },
    refreshOpenViews() {},
  });

  const summary = await plugin.performCalendarRefresh(true);
  assert.deepEqual(summary, {
    conflicts: 0,
    unavailable: 1,
    errors: 0,
    pending: 0,
    recoveryTitles: ["Deselected fixture"],
  });
  assert.equal(plugin.calendarEvents[0].unavailableReason, "calendar-deselected");
  assert.equal(clearCalls, 1);
  assert.equal(bridgeCalls, 0);
});

test("deselecting one linked Calendar cannot create a duplicate and reselecting restores clean", async () => {
  const external: CalendarEventRecord = {
    id: "apple:item_b",
    title: "CAL-03 Unselected Calendar Fixture",
    start: "2026-10-22T10:00:00.000Z",
    end: "2026-10-22T10:30:00.000Z",
    allDay: false,
    calendar: "Calendar B",
    source: "external",
    appleCalendarId: "cal_b",
    appleItemId: "item_b",
    appleExternalId: "external_b",
    externalModifiedAt: "2026-10-19T00:00:00.000Z",
  };
  const linked: CalendarEventRecord = {
    ...external,
    id: "evt_unselected_b",
    source: "linked",
    notePath: "Calendar/Events/cal-03-unselected-calendar-fixture.md",
    syncHash: eventSyncHash(external),
    syncState: "clean",
  };
  let visibleExternal: CalendarEventRecord[] = [];
  let lookups = 0;
  let noteWrites = 0;
  let calendarWrites = 0;
  const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
    Platform: { isMacOS: true },
    calendarFetchWindow,
    calendarIdentityKeys,
    stableExternalCandidates,
    classifyLinkedChange,
    mergeExternalIntoLinked,
    summarizeCalendarSync,
  });
  Object.assign(plugin, {
    app: {
      vault: { getMarkdownFiles: () => [{ path: linked.notePath, stat: { mtime: 100 } }] },
      metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
    },
    readCalendarNoteSnapshot: async () => ({ event: linked, markdown: "exact" }),
    settings: { defaultExternalCalendarId: "cal_a", selectedCalendarIds: ["cal_a"] },
    hasEventKitHelper: () => true,
    eventKitBridge: {
      events: async () => visibleExternal,
      lookup: async () => { lookups++; return null; },
    },
    writeCalendarNote: async (event: CalendarEventRecord) => { noteWrites++; return event; },
    pushLinkedEventToCalendar: async (event: CalendarEventRecord) => { calendarWrites++; return event; },
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    clearIssue() {},
    recordIssue() {},
    refreshOpenViews() {},
  });

  const deselected = await plugin.performCalendarRefresh(true);
  assert.deepEqual(deselected, {
    conflicts: 0,
    unavailable: 1,
    errors: 0,
    pending: 0,
    recoveryTitles: ["CAL-03 Unselected Calendar Fixture"],
  });
  assert.equal(plugin.calendarEvents.length, 1);
  assert.equal(plugin.calendarEvents[0].unavailableReason, "calendar-deselected");
  assert.equal(lookups, 0, "an unselected Calendar must not be treated as a missing event");
  assert.equal(noteWrites, 0);
  assert.equal(calendarWrites, 0, "deselection must never copy the event into the new default Calendar");

  plugin.settings.selectedCalendarIds = ["cal_a", "cal_b"];
  visibleExternal = [external];
  const restored = await plugin.performCalendarRefresh(true);
  assert.deepEqual(restored, { conflicts: 0, unavailable: 0, errors: 0, pending: 0 });
  assert.equal(plugin.calendarEvents.length, 1, "reselection must not duplicate the external event");
  assert.equal(plugin.calendarEvents[0].syncState, "clean");
  assert.equal(plugin.calendarEvents[0].unavailableReason, undefined);
  assert.equal(plugin.calendarEvents[0].appleItemId, "item_b");
  assert.equal(noteWrites, 0);
  assert.equal(calendarWrites, 0);
});

test("a stable match in a newly selected calendar rebinds even when the saved calendar is deselected", async () => {
  const linked: CalendarEventRecord = {
    id: "evt_moved", title: "Moved fixture", start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Old",
    source: "linked", notePath: "Calendar/Events/moved.md", appleCalendarId: "cal_old",
    appleItemId: "item_old", appleExternalId: "stable_external",
  };
  linked.syncHash = eventSyncHash(linked);
  const outside: CalendarEventRecord = {
    ...linked,
    id: "apple:item_new", source: "external", notePath: undefined, syncHash: undefined,
    calendar: "New", appleCalendarId: "cal_new", appleItemId: "item_new",
  };
  let lookups = 0;
  const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
    Platform: { isMacOS: true },
    calendarFetchWindow,
    calendarIdentityKeys,
    stableExternalCandidates,
    classifyLinkedChange,
    mergeExternalIntoLinked,
    summarizeCalendarSync,
  });
  Object.assign(plugin, {
    app: {
      vault: { getMarkdownFiles: () => [{ path: linked.notePath, stat: { mtime: 100 } }] },
      metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
    },
    readCalendarNoteSnapshot: async () => ({ event: linked, markdown: "exact" }),
    settings: { selectedCalendarIds: ["cal_new"] },
    hasEventKitHelper: () => true,
    eventKitBridge: {
      events: async () => [outside],
      lookup: async () => { lookups++; return null; },
    },
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    clearIssue() {},
    recordIssue() {},
    refreshOpenViews() {},
  });

  await plugin.performCalendarRefresh(false);
  assert.equal(plugin.calendarEvents[0].syncState, "pending");
  assert.equal(plugin.calendarEvents[0].unavailableReason, undefined);
  assert.equal(plugin.calendarEvents[0].conflictExternal.appleCalendarId, "cal_new");
  assert.equal(lookups, 0);
});

test("calendar sync fails explicitly when selected calendars have no executable helper", async () => {
  let issue = "";
  const linked: CalendarEventRecord = {
    id: "evt_helper", title: "Helper fixture", start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Activity",
    source: "linked", notePath: "Calendar/Events/helper.md", appleCalendarId: "cal_1",
    appleItemId: "item_1", appleExternalId: "external_1",
  };
  const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
    Platform: { isMacOS: true },
    calendarFetchWindow,
    calendarIdentityKeys,
    summarizeCalendarSync,
  });
  Object.assign(plugin, {
    app: {
      vault: { getMarkdownFiles: () => [{ path: linked.notePath, stat: { mtime: 100 } }] },
      metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
    },
    readCalendarNoteSnapshot: async () => ({ event: linked, markdown: "exact" }),
    settings: { selectedCalendarIds: ["cal_1"] },
    hasEventKitHelper: () => false,
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    recordIssue(_context: string, error: Error) { issue = error.message; },
    refreshOpenViews() {},
  });

  await assert.rejects(plugin.performCalendarRefresh(true), /EventKit helper is unavailable/);
  assert.match(issue, /EventKit helper is unavailable/);
  assert.equal(plugin.calendarEvents[0].syncState, "error");
  assert.equal(plugin.calendarEvents[0].unavailableReason, "setup-or-read-failure");
});

test("calendar sync persists a refreshed external version token even when visible fields are clean", async () => {
  const linked: CalendarEventRecord = {
    id: "evt_token", title: "Token fixture", start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Activity",
    source: "linked", notePath: "Calendar/Events/token.md", appleCalendarId: "cal_1",
    appleItemId: "item_1", appleExternalId: "external_1",
  };
  linked.syncHash = eventSyncHash(linked);
  const outside: CalendarEventRecord = {
    ...linked,
    id: "apple:item_1", source: "external", notePath: undefined, syncHash: undefined,
    externalModifiedAt: "2026-10-05T00:12:00.000Z",
  };
  let written: CalendarEventRecord | undefined;
  let writeCount = 0;
  const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
    Platform: { isMacOS: true },
    calendarFetchWindow,
    calendarIdentityKeys,
    classifyLinkedChange,
    mergeExternalIntoLinked,
    summarizeCalendarSync,
    CalendarSnapshotChangedError,
  });
  Object.assign(plugin, {
    app: {
      vault: { getMarkdownFiles: () => [{ path: linked.notePath, stat: { mtime: 100 } }] },
      metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
    },
    readCalendarNoteSnapshot: async () => ({
      event: { ...linked, vaultModifiedAt: new Date(100).toISOString() },
      markdown: "exact",
    }),
    revalidateCalendarWrite: async (event: CalendarEventRecord, external: CalendarEventRecord) => ({
      event, external, expectedMarkdown: "exact", blocked: false,
    }),
    writeCalendarNote: async (next: CalendarEventRecord) => {
      writeCount += 1;
      written = next;
      return next;
    },
    settings: { selectedCalendarIds: ["cal_1"] },
    hasEventKitHelper: () => true,
    eventKitBridge: { events: async () => [outside] },
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    clearIssue() {},
    recordIssue() {},
    refreshOpenViews() {},
  });

  const preview = await plugin.performCalendarRefresh(false);
  assert.deepEqual(preview, { conflicts: 0, unavailable: 0, errors: 0, pending: 1 });
  assert.equal(plugin.calendarEvents[0].pendingDirection, "external");
  assert.equal(writeCount, 0, "background refresh must wait for explicit Sync before persisting metadata");

  const summary = await plugin.performCalendarRefresh(true);
  assert.deepEqual(summary, { conflicts: 0, unavailable: 0, errors: 0, pending: 0 });
  assert.equal(writeCount, 1);
  assert.equal(written?.externalModifiedAt, outside.externalModifiedAt);
});

for (const fixture of [
  { name: "EventKit identifier churn", nextCalendarId: "cal_old" },
  { name: "a cross-Calendar move", nextCalendarId: "cal_new" },
]) {
  test(`calendar sync safely rebinds ${fixture.name} by a unique stable identifier`, async () => {
    const linked: CalendarEventRecord = {
      id: "evt_rebind", title: "Stable fixture", start: "2026-10-08T10:00:00.000Z",
      end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Old",
      source: "linked", notePath: "Calendar/Events/stable.md", appleCalendarId: "cal_old",
      appleItemId: "old_item", appleExternalId: "stable_external",
      occurrenceDate: "2026-10-08T10:00:00.000Z",
    };
    linked.syncHash = eventSyncHash(linked);
    const outside: CalendarEventRecord = {
      ...linked,
      id: "apple:new_item", source: "external", notePath: undefined, syncHash: undefined,
      calendar: fixture.nextCalendarId === "cal_old" ? "Old" : "New",
      appleCalendarId: fixture.nextCalendarId, appleItemId: "new_item",
      externalModifiedAt: "2026-10-05T00:12:00.000Z",
    };
    let written: CalendarEventRecord | undefined;
    const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
      Platform: { isMacOS: true },
      calendarFetchWindow,
      calendarIdentityKeys,
      stableExternalCandidates,
      classifyLinkedChange,
      mergeExternalIntoLinked,
      summarizeCalendarSync,
      CalendarSnapshotChangedError,
    });
    Object.assign(plugin, {
      app: {
        vault: { getMarkdownFiles: () => [{ path: linked.notePath, stat: { mtime: 100 } }] },
        metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
      },
      readCalendarNoteSnapshot: async () => ({ event: linked, markdown: "exact" }),
      revalidateCalendarWrite: async (event: CalendarEventRecord, external: CalendarEventRecord) => ({
        event, external, expectedMarkdown: "exact", blocked: false,
      }),
      writeCalendarNote: async (next: CalendarEventRecord) => { written = next; return next; },
      settings: { selectedCalendarIds: ["cal_old", "cal_new"] },
      hasEventKitHelper: () => true,
      eventKitBridge: { events: async () => [outside], lookup: async () => null },
      calendarWriteOverrides: new Map(),
      calendarEvents: [],
      clearIssue() {},
      recordIssue() {},
      refreshOpenViews() {},
    });

    const summary = await plugin.performCalendarRefresh(true);
    assert.deepEqual(summary, { conflicts: 0, unavailable: 0, errors: 0, pending: 0 });
    assert.equal(written?.appleItemId, "new_item");
    assert.equal(written?.appleCalendarId, fixture.nextCalendarId);
    assert.equal(written?.appleExternalId, "stable_external");
  });
}

test("calendar sync stops when identifier churn has multiple stable candidates", async () => {
  const linked: CalendarEventRecord = {
    id: "evt_ambiguous", title: "Ambiguous fixture", start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Old",
    source: "linked", notePath: "Calendar/Events/ambiguous.md", appleCalendarId: "cal_old",
    appleItemId: "old_item", appleExternalId: "stable_external",
    occurrenceDate: "2026-10-08T10:00:00.000Z",
  };
  const candidates = ["cal_new_1", "cal_new_2"].map((calendarId, index): CalendarEventRecord => ({
    ...linked,
    id: `apple:new_${index}`, source: "external", notePath: undefined,
    appleCalendarId: calendarId, appleItemId: `new_${index}`,
  }));
  let issue = "";
  const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
    Platform: { isMacOS: true }, calendarFetchWindow, calendarIdentityKeys,
    stableExternalCandidates, classifyLinkedChange, mergeExternalIntoLinked, summarizeCalendarSync,
  });
  Object.assign(plugin, {
    app: {
      vault: { getMarkdownFiles: () => [{ path: linked.notePath, stat: { mtime: 100 } }] },
      metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
    },
    readCalendarNoteSnapshot: async () => ({ event: linked, markdown: "exact" }),
    settings: { selectedCalendarIds: ["cal_old", "cal_new_1", "cal_new_2"] },
    hasEventKitHelper: () => true,
    eventKitBridge: { events: async () => candidates, lookup: async () => null },
    calendarWriteOverrides: new Map(), calendarEvents: [],
    clearIssue() {},
    recordIssue(_context: string, error: Error) { issue = error.message; },
    refreshOpenViews() {},
  });

  const summary = await plugin.performCalendarRefresh(true);
  assert.deepEqual(summary, { conflicts: 0, unavailable: 0, errors: 1, pending: 0 });
  assert.equal(plugin.calendarEvents[0].syncState, "error");
  assert.notEqual(plugin.calendarEvents[0].unavailableReason, "confirmed-missing");
  assert.match(issue, /multiple|2 events/i);
});

test("a deleted linked Calendar item becomes unavailable without an ordinary write", async () => {
  const frontmatter = {
    type: "event", "event-id": "evt_unavailable", title: "CAL-03 unavailable",
    start: "2026-10-08T10:00:00.000Z", end: "2026-10-08T11:00:00.000Z", "all-day": false,
    calendar: "Activity", "event-source": "linked", "apple-calendar-id": "cal_1",
    "apple-item-id": "missing_item", "apple-external-id": "missing_external", "sync-hash": "v1:baseline",
  };
  const plugin = loadMethods("src/main.ts", [
    "readCalendarNoteSnapshot", "calendarNoteErrorRecord", "performCalendarRefresh",
  ], {
    Platform: { isMacOS: true },
    getFrontMatterInfo: () => ({ exists: true, frontmatter: "event" }),
    parseYaml: () => frontmatter,
    recordFromFrontmatter,
    calendarFetchWindow,
    calendarIdentityKeys,
    stableExternalCandidates,
    classifyLinkedAvailability,
    classifyLinkedChange,
    mergeExternalIntoLinked,
    summarizeCalendarSync,
  });
  let writes = 0;
  Object.assign(plugin, {
    app: {
      vault: {
        getMarkdownFiles: () => [{ path: "Calendar/Events/CAL-03.md", stat: { mtime: 123 } }],
        read: async () => "---\ntype: event\n---\n",
      },
      metadataCache: { getFileCache: () => ({ frontmatter }) },
    },
    settings: { selectedCalendarIds: ["cal_1"] },
    eventKitBridge: { events: async () => [], lookup: async () => null },
    hasEventKitHelper: () => true,
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    writeCalendarNote: async () => { writes += 1; },
    pushLinkedEventToCalendar: async () => { writes += 1; },
    clearIssue() {},
    recordIssue() {},
    refreshOpenViews() {},
  });

  const summary = await plugin.performCalendarRefresh(true);
  assert.deepEqual(summary, {
    conflicts: 0,
    unavailable: 1,
    errors: 0,
    pending: 0,
    recoveryTitles: ["CAL-03 unavailable"],
  });
  assert.equal(plugin.calendarEvents[0].syncState, "unavailable");
  assert.equal(plugin.calendarEvents[0].unavailableReason, "unknown");
  assert.equal(writes, 0, "a window/list miss cannot authorize Recreate for a stable event");

  delete (frontmatter as Record<string, unknown>)["apple-external-id"];
  const noStableIdentity = await plugin.performCalendarRefresh(true);
  assert.deepEqual(noStableIdentity, {
    conflicts: 0,
    unavailable: 1,
    errors: 0,
    pending: 0,
    recoveryTitles: ["CAL-03 unavailable"],
  });
  assert.equal(plugin.calendarEvents[0].unavailableReason, "unknown");
  assert.equal(writes, 0, "an old EventKit identifier miss is not proof of deletion even without an external identifier");
});

test("one missing linked event does not block a later healthy event reconciliation write", async () => {
  const healthy: CalendarEventRecord = {
    id: "evt_healthy",
    title: "Healthy event",
    start: "2026-10-09T10:00:00.000Z",
    end: "2026-10-09T11:00:00.000Z",
    allDay: false,
    calendar: "Activity",
    source: "linked",
    notePath: "Calendar/Events/Healthy.md",
    appleCalendarId: "cal_1",
    appleItemId: "healthy_item",
    appleExternalId: "healthy_external",
  };
  healthy.syncHash = eventSyncHash(healthy);
  const healthyExternal: CalendarEventRecord = {
    ...healthy,
    id: "apple:healthy",
    title: "Healthy event updated in Calendar",
    source: "external",
    notePath: undefined,
    syncHash: undefined,
    externalModifiedAt: "2026-10-05T01:00:00.000Z",
  };
  const missing: CalendarEventRecord = {
    id: "evt_missing",
    title: "Missing event",
    start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z",
    allDay: false,
    calendar: "Activity",
    source: "linked",
    notePath: "Calendar/Events/Missing.md",
    appleCalendarId: "cal_1",
    appleItemId: "missing_item",
    appleExternalId: "missing_external",
    syncHash: "v1:missing",
  };
  const files = [missing, healthy].map((event, index) => ({ path: event.notePath!, stat: { mtime: index + 1 } }));
  const byPath = new Map([[missing.notePath, missing], [healthy.notePath, healthy]]);
  let written: CalendarEventRecord | undefined;
  let writeCount = 0;
  const plugin = loadMethods("src/main.ts", ["performCalendarRefresh"], {
    Platform: { isMacOS: true },
    calendarFetchWindow,
    calendarIdentityKeys,
    stableExternalCandidates,
    classifyLinkedChange,
    mergeExternalIntoLinked,
    summarizeCalendarSync,
    CalendarSnapshotChangedError,
  });
  Object.assign(plugin, {
    app: {
      vault: { getMarkdownFiles: () => files },
      metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
    },
    readCalendarNoteSnapshot: async (file: { path: string }) => ({
      event: byPath.get(file.path),
      markdown: file.path,
    }),
    revalidateCalendarWrite: async (event: CalendarEventRecord, external: CalendarEventRecord) => ({
      event, external, expectedMarkdown: event.notePath, blocked: false,
    }),
    writeCalendarNote: async (event: CalendarEventRecord) => {
      writeCount += 1;
      written = event;
      return event;
    },
    settings: { selectedCalendarIds: ["cal_1"] },
    hasEventKitHelper: () => true,
    eventKitBridge: {
      events: async () => [healthyExternal],
      lookup: async () => null,
    },
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    clearIssue() {},
    recordIssue() {},
    refreshOpenViews() {},
  });

  const summary = await plugin.performCalendarRefresh(true);
  assert.deepEqual(summary, {
    conflicts: 0,
    unavailable: 1,
    errors: 0,
    pending: 0,
    recoveryTitles: ["Missing event"],
  });
  assert.equal(plugin.calendarEvents.find((event: CalendarEventRecord) => event.id === missing.id)?.syncState, "unavailable");
  assert.equal(plugin.calendarEvents.find((event: CalendarEventRecord) => event.id === healthy.id)?.syncState, "clean");
  assert.equal(writeCount, 1, "the missing event must not prevent the later Calendar change from being persisted");
  assert.equal(written?.id, healthy.id);
  assert.equal(written?.title, healthyExternal.title);
});

test("an unavailable event cannot recreate without explicit confirmation and Detach remains safe", async () => {
  const event: CalendarEventRecord = {
    id: "evt_recovery", title: "CAL-03 recovery",
    start: "2026-10-08T10:00:00.000Z", end: "2026-10-08T11:00:00.000Z", allDay: false,
    calendar: "Activity", source: "linked", notePath: "Calendar/Events/CAL-03.md",
    appleCalendarId: "old_calendar", appleItemId: "missing_item",
    syncHash: "v1:old", syncState: "unavailable",
    unavailableReason: "unknown" as const,
    vaultModifiedAt: "2026-10-05T00:00:00.000Z",
  };
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent", "detachCalendarEvent"], {
    detachLinkedEvent,
  });
  let detached: CalendarEventRecord | undefined;
  let refreshes = 0;
  const snapshot = { event, markdown: "exact markdown" };
  Object.assign(plugin, {
    settings: { defaultExternalCalendarId: "cal_new", selectedCalendarIds: ["cal_new"] },
    calendarNoteSnapshotForAction: async () => snapshot,
    isSelectedWritableCalendar: () => true,
    writeCalendarNote: async (next: CalendarEventRecord) => { detached = next; return next; },
    refreshCalendarEvents: async () => { refreshes += 1; },
    eventKitBridge: {
      lookup: async () => null,
      remove: async () => assert.fail("Detach without delete must not remove Calendar data"),
    },
  });

  await assert.rejects(plugin.recreateCalendarEvent(event), /explicit confirmation/);

  await plugin.detachCalendarEvent(event, CALENDAR_DETACH_CONFIRMATION);
  assert.equal(detached?.source, "vault");
  assert.equal(detached?.appleCalendarId, undefined);
  assert.equal(detached?.appleItemId, undefined);
  assert.equal(detached?.syncHash, undefined);
  assert.equal(refreshes, 1);
});

test("pending note staging is verified byte-for-byte before EventKit receives an update", async () => {
  const original = "---\ntype: event\n---\n\n# Before\n";
  const event: CalendarEventRecord = {
    id: "evt_stage", title: "After", start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Activity",
    source: "linked", notePath: "Calendar/Events/stage.md", appleCalendarId: "cal_1",
    appleItemId: "item_1", appleExternalId: "external_1", syncHash: "v1:baseline",
    externalModifiedAt: "2026-10-05T00:00:00.000Z",
  };
  const plugin = loadMethods("src/main.ts", ["pushLinkedEventToCalendar"], {
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    classifyLinkedChange,
    mergeExternalIntoLinked,
  });
  let staged: CalendarEventRecord | undefined;
  let upserts = 0;
  Object.assign(plugin, {
    writeCalendarNote: async (next: CalendarEventRecord) => {
      staged = next;
      return next;
    },
    readCalendarNoteSnapshotByPath: async () => ({
      event: staged,
      markdown: `${updateEventNote(original, staged!)}\nmanual edit`,
    }),
    eventKitBridge: { upsert: async () => { upserts += 1; return event; } },
  });

  await assert.rejects(
    plugin.pushLinkedEventToCalendar(event, original),
    (error: unknown) => error instanceof CalendarSnapshotChangedError,
  );
  assert.equal(upserts, 0, "an edited pending note must stop before EventKit");
});

test("a failed linked create removes only its temporary note so retry leaves one recoverable note", async () => {
  class TestFile {
    stat = { mtime: 100 };
    path: string;
    constructor(path: string) { this.path = path; }
  }
  const notes = new Map<string, { file: TestFile; event: CalendarEventRecord; markdown: string }>();
  let created = 0;
  let upserts = 0;
  const draft: CalendarEventRecord = {
    id: "evt_create_retry", title: "Retry fixture", start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Activity",
    source: "linked", appleCalendarId: "cal_1", syncState: "clean",
  };
  const plugin = loadMethods("src/main.ts", [
    "saveCalendarEvent", "pushLinkedEventToCalendar", "discardCreatedPendingCalendarNote",
  ], {
    linkedEventSaveBlockReason,
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    classifyLinkedChange,
    mergeExternalIntoLinked,
    detachLinkedEvent,
    TFile: TestFile,
  });
  Object.assign(plugin, {
    settings: { defaultExternalCalendarId: "cal_1" },
    isSelectedWritableCalendar: () => true,
    writeCalendarNote: async (next: CalendarEventRecord, expectedMarkdown?: string) => {
      const path = next.notePath ?? `Calendar/Events/retry-${++created}.md`;
      const previous = notes.get(path);
      if (expectedMarkdown !== undefined && previous?.markdown !== expectedMarkdown) {
        throw new CalendarSnapshotChangedError();
      }
      const event = { ...next, notePath: path, vaultModifiedAt: "2026-10-05T00:00:00.000Z" };
      const markdown = previous ? updateEventNote(previous.markdown, event) : serializeEventNote(event);
      notes.set(path, { file: previous?.file ?? new TestFile(path), event, markdown });
      return event;
    },
    readCalendarNoteSnapshotByPath: async (path: string) => {
      const note = notes.get(path);
      return note ? { event: note.event, markdown: note.markdown } : { event: null, markdown: "", error: "missing" };
    },
    app: {
      vault: {
        getFileByPath: (path: string) => notes.get(path)?.file ?? null,
        read: async (file: TestFile) => notes.get(file.path)?.markdown ?? "",
      },
      fileManager: {
        trashFile: async (file: TestFile) => { notes.delete(file.path); },
      },
    },
    calendarWriteOverrides: new Map(),
    calendarNoteCreateInFlight: new Set(),
    calendarCreatedNotePaths: new Map(),
    eventKitBridge: {
      upsert: async (event: CalendarEventRecord) => {
        upserts += 1;
        if (upserts === 1) throw new EventKitMutationError("helper rejected create", "not-committed");
        return {
          ...event,
          id: "apple:item_created",
          source: "external" as const,
          notePath: undefined,
          appleItemId: "item_created",
          appleExternalId: "external_created",
          externalModifiedAt: "2026-10-05T00:01:00.000Z",
        };
      },
    },
    refreshCalendarEvents: async () => {},
  });

  await assert.rejects(plugin.saveCalendarEvent(draft), /temporary note was removed safely.*retry Save/i);
  assert.equal(notes.size, 0, "the failed helper call must not strand an unreachable pending note");
  assert.equal(draft.title, "Retry fixture", "the modal draft remains available for retry");

  await plugin.saveCalendarEvent(draft);
  assert.equal(notes.size, 1, "retry must leave exactly one note");
  const saved = [...notes.values()][0].event;
  assert.equal(saved.syncState, "clean");
  assert.equal(saved.appleItemId, "item_created");
});

test("linked writes pass the freshly re-read EventKit version into the helper upsert", async () => {
  const original = "---\ntype: event\n---\n\n# Before\n";
  const external: CalendarEventRecord = {
    id: "apple:item_1", title: "Before", start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z", allDay: false, calendar: "Activity",
    source: "external", appleCalendarId: "cal_1", appleItemId: "item_1",
    appleExternalId: "external_1", externalModifiedAt: "2026-10-05T00:04:00.000Z",
  };
  const event: CalendarEventRecord = {
    ...external,
    id: "evt_version", title: "Edited note", source: "linked",
    notePath: "Calendar/Events/version.md", syncHash: eventSyncHash(external),
  };
  const plugin = loadMethods("src/main.ts", ["pushLinkedEventToCalendar"], {
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    classifyLinkedChange,
    mergeExternalIntoLinked,
  });
  let staged: CalendarEventRecord | undefined;
  let sent: CalendarEventRecord | undefined;
  Object.assign(plugin, {
    writeCalendarNote: async (next: CalendarEventRecord) => {
      staged = next;
      return next;
    },
    readCalendarNoteSnapshotByPath: async () => ({
      event: staged,
      markdown: updateEventNote(original, staged!),
    }),
    readFreshExternalEvent: async () => external,
    isSelectedWritableCalendar: () => true,
    eventKitBridge: {
      upsert: async (next: CalendarEventRecord) => {
        sent = next;
        return { ...external, title: next.title, externalModifiedAt: "2026-10-05T00:05:00.000Z" };
      },
    },
  });

  const result = await plugin.pushLinkedEventToCalendar(event, original, external);
  assert.equal(sent?.externalModifiedAt, external.externalModifiedAt);
  assert.equal(sent?.appleItemId, external.appleItemId);
  assert.equal(result.syncState, "clean");
  assert.equal(result.externalModifiedAt, "2026-10-05T00:05:00.000Z");
});

test("ordinary linked Save keeps the event in its existing Calendar when the default changes", async () => {
  const event: CalendarEventRecord = {
    id: "evt_existing_calendar",
    title: "CAL-03 Unselected Calendar Fixture",
    start: "2026-10-22T10:00:00.000Z",
    end: "2026-10-22T10:30:00.000Z",
    allDay: false,
    calendar: "calendar a",
    source: "linked",
    notePath: "Calendar/Events/cal-03-unselected-calendar-fixture.md",
    appleCalendarId: "cal_a",
    appleItemId: "item_a",
    syncState: "clean",
  };
  const plugin = loadMethods("src/main.ts", ["saveCalendarEvent"], {
    linkedEventSaveBlockReason: () => undefined,
  });
  let savedToCalendar: CalendarEventRecord | undefined;
  Object.assign(plugin, {
    calendarNoteSnapshotForAction: async () => ({ event, markdown: "exact" }),
    settings: {
      defaultExternalCalendarId: "cal_activity",
      selectedCalendarIds: ["cal_activity", "cal_a"],
    },
    isSelectedWritableCalendar: (id: string) => ["cal_activity", "cal_a"].includes(id),
    pushLinkedEventToCalendar: async (next: CalendarEventRecord) => {
      savedToCalendar = next;
      return next;
    },
    refreshCalendarEvents: async () => {},
  });

  await plugin.saveCalendarEvent(event);
  assert.equal(savedToCalendar?.appleCalendarId, "cal_a");
  assert.equal(savedToCalendar?.calendar, "calendar a");
});

test("stale Calendar editor saves and detaches stop before note or EventKit writes", async () => {
  const { note } = conflictFixture();
  const shown = { ...note, syncState: "clean" as const, conflictExternal: undefined };
  const current = { ...shown, vaultModifiedAt: "2026-10-05T00:09:00.000Z" };
  const plugin = loadMethods("src/main.ts", [
    "calendarNoteSnapshotForAction", "saveCalendarEvent", "detachCalendarEvent",
  ], {
    CalendarSnapshotChangedError,
    linkedEventSaveBlockReason: () => undefined,
    detachLinkedEvent,
  });
  let noteWrites = 0;
  let calendarWrites = 0;
  Object.assign(plugin, {
    readCalendarNoteSnapshotByPath: async () => ({ event: current, markdown: "newer" }),
    writeCalendarNote: async () => { noteWrites += 1; },
    pushLinkedEventToCalendar: async () => { calendarWrites += 1; },
    settings: { defaultExternalCalendarId: "cal_1" },
    isSelectedWritableCalendar: () => true,
  });

  await assert.rejects(plugin.saveCalendarEvent(shown), /changed after it was opened/);
  await assert.rejects(plugin.detachCalendarEvent(shown, CALENDAR_DETACH_CONFIRMATION), /changed after it was opened/);
  assert.equal(noteWrites, 0);
  assert.equal(calendarWrites, 0);
});

test("Recreate refuses a stale missing result when exact lookup finds the original item", async () => {
  const { note, external } = conflictFixture();
  const shown = {
    ...note,
    appleExternalId: undefined,
    syncState: "unavailable" as const,
    unavailableReason: "confirmed-missing" as const,
  };
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent"]);
  let creates = 0;
  let refreshes = 0;
  Object.assign(plugin, {
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => ({ event: { ...shown, syncState: "clean", unavailableReason: undefined }, markdown: "current" }),
    settings: { defaultExternalCalendarId: "cal_1", selectedCalendarIds: ["cal_1"] },
    isSelectedWritableCalendar: () => true,
    readFreshExternalEvent: async () => external,
    pushLinkedEventToCalendar: async () => { creates += 1; },
    refreshCalendarEvents: async () => { refreshes += 1; },
  });

  await assert.rejects(
    plugin.recreateCalendarEvent(shown, CALENDAR_RECREATE_CONFIRMATION, "cal_1", ["cal_1"]),
    /original Calendar event is available again/,
  );
  assert.equal(creates, 0);
  assert.equal(refreshes, 1);
});

test("Recreate accepts a live unavailable recovery state when the stored note remains clean", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    appleCalendarId: "cal_old",
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent"]);
  let sent: CalendarEventRecord | undefined;
  Object.assign(plugin, {
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => ({
      event: { ...shown, syncState: "clean", unavailableReason: undefined },
      markdown: "current",
    }),
    settings: { defaultExternalCalendarId: "cal_default", selectedCalendarIds: ["cal_default"] },
    externalCalendars: [{ id: "cal_default", title: "Default test calendar", writable: true }],
    isSelectedWritableCalendar: (id: string) => id === "cal_default",
    readFreshExternalEvent: async () => undefined,
    pushLinkedEventToCalendar: async (event: CalendarEventRecord) => {
      sent = event;
      return { ...event, syncState: "clean" as const };
    },
    refreshCalendarEvents: async () => {},
    ambiguousCalendarCreateIds: new Set(),
    recordIssue() {},
  });

  await plugin.recreateCalendarEvent(shown, CALENDAR_RECREATE_CONFIRMATION, "cal_default", ["cal_default"]);
  assert.equal(sent?.appleCalendarId, "cal_default");
  assert.equal(sent?.calendar, "Default test calendar");
  assert.equal(sent?.appleItemId, undefined);
});

test("Recreate stops before reading the note when the live recovery state changed", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent"]);
  let noteReads = 0;
  let creates = 0;
  Object.assign(plugin, {
    calendarEvents: [{ ...shown, syncState: "clean", unavailableReason: undefined }],
    calendarNoteSnapshotForAction: async () => {
      noteReads += 1;
      return { event: shown, markdown: "current" };
    },
    settings: { defaultExternalCalendarId: "cal_1", selectedCalendarIds: ["cal_1"] },
    isSelectedWritableCalendar: () => true,
    pushLinkedEventToCalendar: async () => { creates += 1; },
    refreshCalendarEvents: async () => {},
  });

  await assert.rejects(
    plugin.recreateCalendarEvent(shown, CALENDAR_RECREATE_CONFIRMATION, "cal_1", ["cal_1"]),
    /state changed after Recreate opened/,
  );
  assert.equal(noteReads, 0);
  assert.equal(creates, 0);
});

test("Recreate rejects a default Calendar change after confirmation", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent"]);
  let creates = 0;
  Object.assign(plugin, {
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => {
      plugin.settings.defaultExternalCalendarId = "cal_new";
      return { event: { ...shown, syncState: "clean", unavailableReason: undefined }, markdown: "current" };
    },
    settings: { defaultExternalCalendarId: "cal_old", selectedCalendarIds: ["cal_old", "cal_new"] },
    isSelectedWritableCalendar: () => true,
    pushLinkedEventToCalendar: async () => { creates += 1; },
    refreshCalendarEvents: async () => {},
  });

  await assert.rejects(
    plugin.recreateCalendarEvent(shown, CALENDAR_RECREATE_CONFIRMATION, "cal_old", ["cal_old", "cal_new"]),
    /selected or default Calendar changed after Recreate opened/,
  );
  assert.equal(creates, 0);
});

test("Recreate rejects a Calendar selection change made while its confirmation is open", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent"]);
  let noteReads = 0;
  let creates = 0;
  Object.assign(plugin, {
    calendarEvents: [shown],
    settings: { defaultExternalCalendarId: "cal_1", selectedCalendarIds: ["cal_1", "cal_3"] },
    isSelectedWritableCalendar: (id: string) => id === "cal_1",
    calendarNoteSnapshotForAction: async () => {
      noteReads += 1;
      return { event: { ...shown, syncState: "clean", unavailableReason: undefined }, markdown: "current" };
    },
    pushLinkedEventToCalendar: async () => { creates += 1; },
    refreshCalendarEvents: async () => {},
  });

  await assert.rejects(
    plugin.recreateCalendarEvent(
      shown,
      CALENDAR_RECREATE_CONFIRMATION,
      "cal_1",
      ["cal_2", "cal_1"],
    ),
    /selected or default Calendar changed after Recreate opened/,
  );
  assert.equal(noteReads, 0, "a stale modal must stop before reading or staging its note");
  assert.equal(creates, 0);
});

test("Recreate performs no write when OMD Home unloads during the final Calendar lookup", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const lookupStarted = deferred<void>();
  const lookup = deferred<CalendarEventRecord | undefined>();
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent"]);
  let creates = 0;
  Object.assign(plugin, {
    unloaded: false,
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => ({
      event: { ...shown, syncState: "clean", unavailableReason: undefined },
      markdown: "current",
    }),
    settings: { defaultExternalCalendarId: "cal_1", selectedCalendarIds: ["cal_1"] },
    isSelectedWritableCalendar: () => true,
    readFreshExternalEvent: async () => {
      lookupStarted.resolve();
      return await lookup.promise;
    },
    pushLinkedEventToCalendar: async () => { creates += 1; },
    refreshCalendarEvents: async () => {},
    recordIssue() {},
  });

  const recreating = plugin.recreateCalendarEvent(shown, CALENDAR_RECREATE_CONFIRMATION, "cal_1", ["cal_1"]);
  await lookupStarted.promise;
  plugin.unloaded = true;
  lookup.resolve(undefined);
  await assert.rejects(recreating, /OMD Home was disabled/);
  assert.equal(creates, 0);
});

test("Recreate restores its staged note and skips EventKit when Calendar selection changes before upsert", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    appleCalendarId: "cal_old",
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const stored = { ...shown, syncState: "clean" as const, unavailableReason: undefined };
  const original = serializeEventNote(stored);
  const stageStarted = deferred<void>();
  const finishStage = deferred<void>();
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent", "pushLinkedEventToCalendar", "writeCalendarNote"], {
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    classifyLinkedChange,
    mergeExternalIntoLinked,
  });
  let currentMarkdown = original;
  const file = { path: stored.notePath, stat: { mtime: 100 } };
  let restores = 0;
  let upserts = 0;
  let refreshes = 0;
  Object.assign(plugin, {
    unloaded: false,
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => ({ event: stored, markdown: original }),
    settings: {
      defaultExternalCalendarId: "cal_1",
      selectedCalendarIds: ["cal_2", "cal_1"],
    },
    externalCalendars: [{ id: "cal_1", title: "Work", writable: true }],
    isSelectedWritableCalendar: (id: string) => plugin.settings.selectedCalendarIds.includes(id),
    readFreshExternalEvent: async () => undefined,
    ensureFolder: async () => {},
    app: {
      vault: {
        getFileByPath: () => file,
        process: async (_file: unknown, transform: (markdown: string) => string) => {
          const committed = transform(currentMarkdown);
          stageStarted.resolve();
          await finishStage.promise;
          currentMarkdown = committed;
          file.stat.mtime = 200;
        },
      },
    },
    restoreCalendarNoteMarkdown: async (_path: string, expected: string, restored: string) => {
      assert.equal(currentMarkdown, expected, "rollback must use the exact staged bytes as its CAS boundary");
      currentMarkdown = restored;
      restores += 1;
      return true;
    },
    eventKitBridge: { upsert: async () => { upserts += 1; return stored; } },
    calendarWriteOverrides: new Map(),
    calendarCreatedNotePaths: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    refreshCalendarEvents: async () => { refreshes += 1; },
    recordIssue() {},
  });

  const recreating = plugin.recreateCalendarEvent(shown, CALENDAR_RECREATE_CONFIRMATION, "cal_1", ["cal_2", "cal_1"]);
  await stageStarted.promise;
  plugin.settings.selectedCalendarIds = ["cal_1", "cal_3"];
  finishStage.resolve();

  await assert.rejects(recreating, /no longer current.*No further Calendar or note changes were made/i);
  assert.equal(currentMarkdown, original, "a pre-EventKit invalidation restores the exact confirmed note");
  assert.equal(restores, 1);
  assert.equal(upserts, 0);
  assert.equal(refreshes, 0);
});

test("Recreate preserves a committed pending stage without publishing after unload", async () => {
  const { note } = conflictFixture();
  const event: CalendarEventRecord = {
    ...note,
    appleCalendarId: "cal_1",
    appleItemId: undefined,
    appleExternalId: undefined,
    occurrenceDate: undefined,
    externalModifiedAt: undefined,
    clientRequestId: "evt_stage_unload",
    syncState: "unavailable",
    unavailableReason: undefined,
    conflictExternal: undefined,
  };
  const original = serializeEventNote({ ...event, syncState: "clean" });
  const stageStarted = deferred<void>();
  const finishStage = deferred<void>();
  const plugin = loadMethods("src/main.ts", ["pushLinkedEventToCalendar", "writeCalendarNote"], {
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    classifyLinkedChange,
    mergeExternalIntoLinked,
  });
  const file = { path: event.notePath, stat: { mtime: 100 } };
  let currentMarkdown = original;
  let restores = 0;
  let upserts = 0;
  Object.assign(plugin, {
    unloaded: false,
    ensureFolder: async () => {},
    app: {
      vault: {
        getFileByPath: () => file,
        process: async (_file: unknown, transform: (markdown: string) => string) => {
          const committed = transform(currentMarkdown);
          stageStarted.resolve();
          await finishStage.promise;
          currentMarkdown = committed;
          file.stat.mtime = 200;
        },
      },
    },
    restoreCalendarNoteMarkdown: async () => { restores += 1; return true; },
    eventKitBridge: { upsert: async () => { upserts += 1; return event; } },
    calendarWriteOverrides: new Map(),
    calendarCreatedNotePaths: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    recordIssue() {},
  });

  const writing = plugin.pushLinkedEventToCalendar(
    event,
    original,
    undefined,
    () => !plugin.unloaded,
    () => !plugin.unloaded,
  );
  await stageStarted.promise;
  plugin.unloaded = true;
  finishStage.resolve();

  await assert.rejects(writing, /No further Calendar or note changes were made/);
  assert.match(currentMarkdown, /sync-state: pending/);
  assert.equal(restores, 0, "unload must not start a compensating vault write");
  assert.equal(upserts, 0, "unload before EventKit must not start the external mutation");
  assert.equal(plugin.calendarWriteOverrides.size, 0, "an unloaded plugin must not publish a stale write override");
});

test("Recreate cannot stage or create while a full Calendar refresh is recovering the original event", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    appleCalendarId: "cal_old",
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const stored = { ...shown, syncState: "clean" as const, unavailableReason: undefined };
  const original = serializeEventNote(stored);
  const stageEntered = deferred<void>();
  const releaseStage = deferred<void>();
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent", "pushLinkedEventToCalendar"], {
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    classifyLinkedChange,
    mergeExternalIntoLinked,
  });
  let currentMarkdown = original;
  let upserts = 0;
  Object.assign(plugin, {
    unloaded: false,
    calendarRefresh: null,
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => ({ event: stored, markdown: original }),
    settings: { defaultExternalCalendarId: "cal_1", selectedCalendarIds: ["cal_1"] },
    externalCalendars: [{ id: "cal_1", title: "Work", writable: true }],
    isSelectedWritableCalendar: () => true,
    readFreshExternalEvent: async () => undefined,
    writeCalendarNote: async (
      next: CalendarEventRecord,
      _expected: string,
      continuationIsCurrent: () => boolean,
    ) => {
      stageEntered.resolve();
      await releaseStage.promise;
      if (!continuationIsCurrent()) throw new Error("This Calendar action is no longer current");
      currentMarkdown = updateEventNote(currentMarkdown, next);
      return { ...next, vaultModifiedAt: "2026-10-17T00:00:00.000Z" };
    },
    eventKitBridge: { upsert: async () => { upserts += 1; return stored; } },
    calendarCreatedNotePaths: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    refreshCalendarEvents: async () => {},
    recordIssue() {},
  });

  const recreating = plugin.recreateCalendarEvent(
    shown,
    CALENDAR_RECREATE_CONFIRMATION,
    "cal_1",
    ["cal_1"],
  );
  await stageEntered.promise;
  plugin.calendarRefresh = Promise.resolve({ conflicts: 0, unavailable: 0, errors: 0, pending: 0 });
  plugin.calendarEvents = [{ ...stored, appleItemId: "recovered_original" }];
  releaseStage.resolve();

  await assert.rejects(recreating, /no longer current/);
  assert.equal(currentMarkdown, original, "the recovered original must win before any staged bytes are committed");
  assert.equal(upserts, 0, "Recreate must not duplicate an event while full Sync owns recovery");
});

test("a post-upsert note CAS loss preserves the Calendar copy for Sync instead of deleting it", async () => {
  const { note } = conflictFixture();
  const event: CalendarEventRecord = {
    ...note,
    appleCalendarId: "cal_1",
    appleItemId: undefined,
    appleExternalId: undefined,
    externalModifiedAt: undefined,
    clientRequestId: "evt_recreate_cas",
    syncState: "unavailable",
    unavailableReason: undefined,
    conflictExternal: undefined,
  };
  const original = serializeEventNote({ ...event, syncState: "clean" });
  let currentMarkdown = original;
  let staged: CalendarEventRecord | undefined;
  let noteWrites = 0;
  let removes = 0;
  const plugin = loadMethods("src/main.ts", ["pushLinkedEventToCalendar"], {
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    classifyLinkedChange,
    mergeExternalIntoLinked,
  });
  Object.assign(plugin, {
    unloaded: false,
    writeCalendarNote: async (next: CalendarEventRecord) => {
      noteWrites += 1;
      if (noteWrites > 1) throw new CalendarSnapshotChangedError();
      staged = { ...next, notePath: event.notePath, vaultModifiedAt: "2026-10-17T00:01:00.000Z" };
      currentMarkdown = updateEventNote(currentMarkdown, next);
      return staged;
    },
    readCalendarNoteSnapshotByPath: async () => ({ event: staged, markdown: currentMarkdown }),
    eventKitBridge: {
      upsert: async () => ({
        ...staged!,
        source: "external",
        notePath: undefined,
        appleItemId: "new_item_after_cas",
        appleExternalId: "new_external_after_cas",
        externalModifiedAt: "2026-10-17T00:02:00.000Z",
      }),
      remove: async () => { removes += 1; },
    },
    calendarCreatedNotePaths: new Map(),
    ambiguousCalendarCreateIds: new Set<string>(),
    recordIssue() {},
  });

  await assert.rejects(
    plugin.pushLinkedEventToCalendar(event, original),
    /note changed before finalization.*run Sync/i,
  );
  assert.equal(removes, 0, "a committed Calendar create must never be rolled back after a lost note CAS");
  assert.equal(staged?.syncState, "pending");
  assert.match(currentMarkdown, /sync-state: pending/);
  assert.equal(plugin.ambiguousCalendarCreateIds.has(event.id), true);
});

test("Recreate leaves its pending reconciliation note untouched when unload happens during upsert", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    appleCalendarId: "cal_old",
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const stored = { ...shown, syncState: "clean" as const, unavailableReason: undefined };
  const original = serializeEventNote(stored);
  const upsertStarted = deferred<void>();
  const finishUpsert = deferred<CalendarEventRecord>();
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent", "pushLinkedEventToCalendar"], {
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    classifyLinkedChange,
    mergeExternalIntoLinked,
  });
  let currentMarkdown = original;
  let staged: CalendarEventRecord | undefined;
  let noteWrites = 0;
  let restores = 0;
  let refreshes = 0;
  Object.assign(plugin, {
    unloaded: false,
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => ({ event: stored, markdown: original }),
    settings: { defaultExternalCalendarId: "cal_1", selectedCalendarIds: ["cal_1", "cal_2"] },
    externalCalendars: [{ id: "cal_1", title: "Work", writable: true }],
    isSelectedWritableCalendar: (id: string) => plugin.settings.selectedCalendarIds.includes(id),
    readFreshExternalEvent: async () => undefined,
    writeCalendarNote: async (next: CalendarEventRecord) => {
      noteWrites += 1;
      staged = { ...next, vaultModifiedAt: "2026-10-17T00:00:00.000Z" };
      currentMarkdown = updateEventNote(currentMarkdown, next);
      return staged;
    },
    readCalendarNoteSnapshotByPath: async () => ({ event: staged, markdown: currentMarkdown }),
    restoreCalendarNoteMarkdown: async () => { restores += 1; return true; },
    eventKitBridge: {
      upsert: async () => {
        upsertStarted.resolve();
        return await finishUpsert.promise;
      },
    },
    calendarCreatedNotePaths: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    refreshCalendarEvents: async () => { refreshes += 1; },
    recordIssue() {},
  });

  const recreating = plugin.recreateCalendarEvent(shown, CALENDAR_RECREATE_CONFIRMATION, "cal_1", ["cal_1", "cal_2"]);
  await upsertStarted.promise;
  plugin.unloaded = true;
  finishUpsert.resolve({
    ...staged!,
    source: "external",
    notePath: undefined,
    appleCalendarId: "cal_1",
    appleItemId: "new_item",
    appleExternalId: "new_external",
    externalModifiedAt: "2026-10-17T00:01:00.000Z",
  });

  await assert.rejects(
    recreating,
    /Calendar may have been updated.*pending note is the recovery record.*run Sync/i,
  );
  assert.equal(noteWrites, 1, "only the pre-upsert pending stage may be written");
  assert.equal(staged?.syncState, "pending");
  assert.match(currentMarkdown, /sync-state: pending/);
  assert.equal(restores, 0, "an in-flight external create must retain its reconciliation record");
  assert.equal(refreshes, 0, "an unloaded plugin must not run a follow-up refresh");
});

test("Recreate finalizes when a refresh observes its own pending stage during upsert", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    appleCalendarId: "cal_old",
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const stored = { ...shown, syncState: "clean" as const, unavailableReason: undefined };
  const original = serializeEventNote(stored);
  const upsertStarted = deferred<void>();
  const finishUpsert = deferred<CalendarEventRecord>();
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent", "pushLinkedEventToCalendar"], {
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    classifyLinkedChange,
    mergeExternalIntoLinked,
  });
  let currentMarkdown = original;
  let staged: CalendarEventRecord | undefined;
  let finalized: CalendarEventRecord | undefined;
  let noteWrites = 0;
  let refreshes = 0;
  Object.assign(plugin, {
    unloaded: false,
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => ({ event: stored, markdown: original }),
    settings: { defaultExternalCalendarId: "cal_1", selectedCalendarIds: ["cal_2", "cal_1"] },
    externalCalendars: [{ id: "cal_1", title: "Work", writable: true }],
    isSelectedWritableCalendar: (id: string) => plugin.settings.selectedCalendarIds.includes(id),
    readFreshExternalEvent: async () => undefined,
    writeCalendarNote: async (next: CalendarEventRecord) => {
      noteWrites += 1;
      const saved = { ...next, vaultModifiedAt: `2026-10-17T00:0${noteWrites}:00.000Z` };
      currentMarkdown = updateEventNote(currentMarkdown, next);
      if (next.syncState === "pending") staged = saved;
      else finalized = saved;
      return saved;
    },
    readCalendarNoteSnapshotByPath: async () => ({ event: staged, markdown: currentMarkdown }),
    eventKitBridge: {
      upsert: async () => {
        upsertStarted.resolve();
        return await finishUpsert.promise;
      },
    },
    calendarCreatedNotePaths: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    refreshCalendarEvents: async () => { refreshes += 1; },
    recordIssue() {},
  });

  const recreating = plugin.recreateCalendarEvent(
    shown,
    CALENDAR_RECREATE_CONFIRMATION,
    "cal_1",
    ["cal_1", "cal_2"],
  );
  await upsertStarted.promise;
  plugin.calendarEvents = [{ ...staged!, source: "linked", syncState: "pending" }];
  finishUpsert.resolve({
    ...staged!,
    source: "external",
    notePath: undefined,
    appleCalendarId: "cal_1",
    appleItemId: "new_item",
    appleExternalId: "new_external",
    externalModifiedAt: "2026-10-17T00:03:00.000Z",
  });

  await recreating;
  assert.equal(noteWrites, 2, "the pending stage and clean finalization should each write once");
  assert.equal(finalized?.syncState, "clean");
  assert.equal(finalized?.appleItemId, "new_item");
  assert.equal(refreshes, 1);
});

test("Recreate accepts the clean linkage finalized by full Sync during EventKit upsert", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    appleCalendarId: "cal_old",
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const stored = { ...shown, syncState: "clean" as const, unavailableReason: undefined };
  const original = serializeEventNote(stored);
  const upsertStarted = deferred<void>();
  const finishUpsert = deferred<void>();
  const plugin = loadMethods("src/main.ts", [
    "recreateCalendarEvent", "pushLinkedEventToCalendar", "performCalendarRefresh",
  ], {
    Platform: { isMacOS: true },
    normalizeEventKitEvent,
    serializeEventNote,
    updateEventNote,
    CalendarSnapshotChangedError,
    calendarEventVersion,
    calendarFetchWindow,
    calendarIdentityKeys,
    stableExternalCandidates,
    classifyLinkedChange,
    mergeExternalIntoLinked,
    summarizeCalendarSync,
  });
  let currentEvent: CalendarEventRecord = stored;
  let currentMarkdown = original;
  let upsertOutside: CalendarEventRecord | undefined;
  let syncOutside: CalendarEventRecord | undefined;
  let noteWrites = 0;
  let removes = 0;
  let refreshes = 0;
  const file = { path: stored.notePath!, stat: { mtime: 100 } };
  Object.assign(plugin, {
    unloaded: false,
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => ({ event: stored, markdown: original }),
    settings: { defaultExternalCalendarId: "cal_1", selectedCalendarIds: ["cal_1", "cal_2"] },
    externalCalendars: [{ id: "cal_1", title: "Work", writable: true }],
    isSelectedWritableCalendar: (id: string) => plugin.settings.selectedCalendarIds.includes(id),
    readFreshExternalEvent: async () => undefined,
    readCalendarNoteSnapshot: async () => ({ event: currentEvent, markdown: currentMarkdown }),
    readCalendarNoteSnapshotByPath: async () => ({ event: currentEvent, markdown: currentMarkdown }),
    revalidateCalendarWrite: async (
      event: CalendarEventRecord,
      external: CalendarEventRecord,
      expectedMarkdown: string,
    ) => ({ event, external, expectedMarkdown, blocked: false }),
    writeCalendarNote: async (
      next: CalendarEventRecord,
      expectedMarkdown?: string,
      continuationIsCurrent: () => boolean = () => true,
    ) => {
      if (!continuationIsCurrent()) throw new Error("This Calendar action is no longer current");
      if (expectedMarkdown !== undefined && currentMarkdown !== expectedMarkdown) {
        throw new CalendarSnapshotChangedError();
      }
      noteWrites += 1;
      currentMarkdown = updateEventNote(currentMarkdown, next);
      currentEvent = {
        ...normalizeEventKitEvent(next),
        notePath: stored.notePath,
        vaultModifiedAt: `2026-10-17T00:0${noteWrites}:00.000Z`,
      };
      return currentEvent;
    },
    app: {
      vault: { getMarkdownFiles: () => [file] },
      metadataCache: { getFileCache: () => ({ frontmatter: { type: "event" } }) },
    },
    hasEventKitHelper: () => true,
    eventKitBridge: {
      events: async () => syncOutside ? [syncOutside] : [],
      upsert: async () => {
        upsertOutside = {
          ...currentEvent,
          id: "apple:new_item",
          source: "external",
          notePath: undefined,
          appleCalendarId: "cal_1",
          appleItemId: "new_item",
          appleExternalId: "new_external",
          externalModifiedAt: "2026-10-17T00:03:00.000Z",
          syncHash: undefined,
        };
        syncOutside = {
          ...upsertOutside,
          externalModifiedAt: "2026-10-17T00:04:00.000Z",
        };
        upsertStarted.resolve();
        await finishUpsert.promise;
        return upsertOutside;
      },
      remove: async () => { removes += 1; },
    },
    calendarWriteOverrides: new Map(),
    calendarCreatedNotePaths: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    clearIssue() {},
    recordIssue() {},
    refreshOpenViews() {},
    refreshCalendarEvents: async () => { refreshes += 1; },
  });

  const recreating = plugin.recreateCalendarEvent(
    shown,
    CALENDAR_RECREATE_CONFIRMATION,
    "cal_1",
    ["cal_1", "cal_2"],
  );
  await upsertStarted.promise;

  const sync = await plugin.performCalendarRefresh(true);
  assert.deepEqual(sync, { conflicts: 0, unavailable: 0, errors: 0, pending: 0 });
  assert.equal(currentEvent.syncState, "clean", "full Sync should finalize the pending Recreate note");
  finishUpsert.resolve();
  await recreating;

  assert.equal(removes, 0, "Recreate must not roll back the Calendar item already finalized by Sync");
  assert.equal(noteWrites, 2, "only pending staging and full Sync should write the note");
  assert.equal(currentEvent.syncState, "clean");
  assert.equal(currentEvent.appleItemId, "new_item");
  assert.equal(
    currentEvent.externalModifiedAt,
    "2026-10-17T00:04:00.000Z",
    "a newer metadata-only Calendar version finalized by Sync must remain authoritative",
  );
  assert.equal(plugin.calendarEvents.length, 1, "one clean linked note should own the one Calendar event");
  assert.equal(plugin.calendarEvents[0].appleItemId, "new_item");
  assert.equal(refreshes, 1);
});

test("Recreate performs no read or write after OMD Home is already unloaded", async () => {
  const { note } = conflictFixture();
  const shown: CalendarEventRecord = {
    ...note,
    syncState: "unavailable",
    unavailableReason: "unknown",
    conflictExternal: undefined,
  };
  const plugin = loadMethods("src/main.ts", ["recreateCalendarEvent"]);
  let boundaryCalls = 0;
  Object.assign(plugin, {
    unloaded: true,
    calendarEvents: [shown],
    calendarNoteSnapshotForAction: async () => { boundaryCalls += 1; },
    readFreshExternalEvent: async () => { boundaryCalls += 1; },
    pushLinkedEventToCalendar: async () => { boundaryCalls += 1; },
  });

  await assert.rejects(
    plugin.recreateCalendarEvent(shown, CALENDAR_RECREATE_CONFIRMATION, "cal_1", []),
    /OMD Home was disabled/,
  );
  assert.equal(boundaryCalls, 0);
});

test("fresh Calendar lookup rejects a reused item id with a different stable external identity", async () => {
  const { note, external } = conflictFixture();
  const plugin = loadMethods("src/main.ts", ["readFreshExternalEvent"], {
    calendarFetchWindow,
    stableExternalCandidates,
  });
  Object.assign(plugin, {
    settings: { selectedCalendarIds: ["cal_1"] },
    eventKitBridge: {
      lookup: async () => ({ ...external, appleExternalId: "external_reused" }),
      events: async () => [],
    },
  });

  await assert.rejects(
    plugin.readFreshExternalEvent(note, note),
    /external identity no longer matches/,
  );
});

test("two stale Calendar-only editors can create only one linked note", async () => {
  const hold = deferred<void>();
  let writes = 0;
  const plugin = loadMethods("src/main.ts", ["saveCalendarEvent"], {
    linkedEventSaveBlockReason,
    eventSyncHash,
  });
  const shown: CalendarEventRecord = {
    id: "apple:item_external",
    title: "Calendar-only fixture",
    start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z",
    allDay: false,
    calendar: "Test calendar",
    source: "linked",
    syncState: "clean",
    readOnly: true,
    appleCalendarId: "cal_1",
    appleItemId: "item_external",
    appleExternalId: "external_1",
    clientRequestId: "link-item_external",
  };
  Object.assign(plugin, {
    calendarNoteCreateInFlight: new Set(),
    calendarCreatedNotePaths: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    writeCalendarNote: async (event: CalendarEventRecord) => {
      writes += 1;
      await hold.promise;
      return { ...event, notePath: "Calendar/Events/Calendar-only fixture.md" };
    },
    refreshCalendarEvents: async () => {},
  });

  const first = plugin.saveCalendarEvent({ ...shown });
  await Promise.resolve();
  await assert.rejects(
    plugin.saveCalendarEvent({ ...shown }),
    /already been created/,
  );
  hold.resolve();
  await first;

  await assert.rejects(
    plugin.saveCalendarEvent({ ...shown }),
    /already been created/,
  );
  assert.equal(writes, 1);
});

test("Calendar deletion carries the exact external version to the helper", async () => {
  const { external } = conflictFixture();
  let removed: unknown[] | undefined;
  const issues: Error[] = [];
  const plugin = loadMethods("src/main.ts", ["detachCalendarEvent"]);
  Object.assign(plugin, {
    unloaded: false,
    calendarEvents: [external],
    isSelectedWritableCalendar: () => true,
    eventKitBridge: {
      lookup: async () => external,
      remove: async (...args: unknown[]) => { removed = args; },
    },
    refreshOpenViews() {},
    refreshCalendarEvents: async () => { throw new Error("refresh failed after committed delete"); },
    recordIssue: (_context: string, error: Error) => { issues.push(error); },
  });

  await plugin.detachCalendarEvent(external, CALENDAR_EVENT_DELETE_CONFIRMATION);
  assert.deepEqual(removed, [
    external.appleItemId,
    external.externalModifiedAt,
    "this",
    external.occurrenceDate,
    external.start,
  ]);
  assert.deepEqual(plugin.calendarEvents, []);
  assert.match(issues[0]?.message ?? "", /refresh failed after committed delete/);
});

test("Calendar deletion requires the exact confirmation token before lookup or mutation", async () => {
  const { external } = conflictFixture();
  let lookups = 0;
  let removals = 0;
  const plugin = loadMethods("src/main.ts", ["detachCalendarEvent"]);
  Object.assign(plugin, {
    unloaded: false,
    eventKitBridge: {
      lookup: async () => { lookups += 1; return external; },
      remove: async () => { removals += 1; },
    },
  });

  await assert.rejects(
    plugin.detachCalendarEvent(external, "delete"),
    /explicit action confirmation/,
  );
  assert.equal(lookups, 0);
  assert.equal(removals, 0);
});

test("disabling the plugin while Calendar deletion is checking freshness prevents the delete", async () => {
  const { external } = conflictFixture();
  const lookup = deferred<CalendarEventRecord>();
  let removals = 0;
  const plugin = loadMethods("src/main.ts", ["detachCalendarEvent"]);
  Object.assign(plugin, {
    unloaded: false,
    isSelectedWritableCalendar: () => true,
    eventKitBridge: {
      lookup: async () => lookup.promise,
      remove: async () => { removals += 1; },
    },
  });

  const deletion = plugin.detachCalendarEvent(external, CALENDAR_EVENT_DELETE_CONFIRMATION);
  plugin.unloaded = true;
  lookup.resolve(external);
  await assert.rejects(deletion, /disabled.*Nothing was deleted/);
  assert.equal(removals, 0);
});

test("disabling the plugin during Calendar deletion never starts a post-delete refresh", async () => {
  const { external } = conflictFixture();
  const removalStarted = deferred<boolean>();
  const removal = deferred<void>();
  let refreshes = 0;
  const plugin = loadMethods("src/main.ts", ["detachCalendarEvent"]);
  Object.assign(plugin, {
    unloaded: false,
    calendarEvents: [external],
    isSelectedWritableCalendar: () => true,
    eventKitBridge: {
      lookup: async () => external,
      remove: async () => {
        removalStarted.resolve(true);
        return removal.promise;
      },
    },
    refreshOpenViews() {},
    refreshCalendarEvents: async () => { refreshes += 1; },
  });

  const deletion = plugin.detachCalendarEvent(external, CALENDAR_EVENT_DELETE_CONFIRMATION);
  await removalStarted.promise;
  plugin.unloaded = true;
  removal.resolve(undefined);
  await deletion;
  assert.equal(refreshes, 0);
  assert.deepEqual(plugin.calendarEvents, []);
});

test("an uncertain Calendar deletion closes the stale action path even when refresh also fails", async () => {
  const { external } = conflictFixture();
  let issues = 0;
  const plugin = loadMethods("src/main.ts", ["detachCalendarEvent"]);
  Object.assign(plugin, {
    unloaded: false,
    calendarEvents: [external],
    isSelectedWritableCalendar: () => true,
    eventKitBridge: {
      lookup: async () => external,
      remove: async () => { throw new EventKitMutationError("timeout", "unknown"); },
    },
    refreshOpenViews() {},
    refreshCalendarEvents: async () => { throw new Error("refresh unavailable"); },
    recordIssue: () => { issues += 1; },
  });

  await assert.rejects(
    plugin.detachCalendarEvent(external, CALENDAR_EVENT_DELETE_CONFIRMATION),
    (error: unknown) => error instanceof CalendarPartialActionError
      && /could not be confirmed.*Check Calendar/i.test(error.message),
  );
  assert.deepEqual(plugin.calendarEvents, []);
  assert.equal(issues, 1);
});

test("a linked Calendar-delete failure reports the committed detach as a partial result", async () => {
  const { note, external } = conflictFixture();
  let written: CalendarEventRecord | undefined;
  const plugin = loadMethods("src/main.ts", ["detachCalendarEvent"], { detachLinkedEvent });
  Object.assign(plugin, {
    unloaded: false,
    calendarEvents: [note],
    calendarNoteSnapshotForAction: async () => ({ event: note, markdown: "exact" }),
    readFreshExternalEvent: async () => external,
    isSelectedWritableCalendar: () => true,
    writeCalendarNote: async (event: CalendarEventRecord) => { written = event; return event; },
    eventKitBridge: {
      remove: async () => { throw new EventKitMutationError("Calendar denied deletion", "not-committed"); },
    },
    refreshOpenViews() {},
    refreshCalendarEvents: async () => { throw new Error("refresh failed after detach"); },
    recordIssue() {},
  });

  await assert.rejects(
    plugin.detachCalendarEvent(note, CALENDAR_EVENT_DELETE_CONFIRMATION),
    (error: unknown) => error instanceof CalendarPartialActionError
      && /note is now Vault only.*event was not deleted/i.test(error.message),
  );
  assert.equal(written?.source, "vault");
  assert.equal(written?.appleItemId, undefined);
});

test("deleting a Vault event note requires confirmation, uses Obsidian trash and evicts stale UI state", async () => {
  class TestFile {
    readonly path: string;
    constructor(path: string) { this.path = path; }
  }
  const notePath = "Calendar/Events/Vault-only.md";
  const event: CalendarEventRecord = {
    id: "evt_vault_delete",
    title: "Vault-only fixture",
    start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z",
    allDay: false,
    calendar: "Vault",
    source: "vault",
    notePath,
    syncState: "clean",
    vaultModifiedAt: "2026-10-05T00:00:00.000Z",
  };
  const file = new TestFile(notePath);
  const plugin = loadMethods("src/main.ts", ["deleteCalendarEventNote"], { TFile: TestFile });
  let trashed: TestFile | undefined;
  let renders = 0;
  const issues: Error[] = [];
  Object.assign(plugin, {
    calendarNoteSnapshotForAction: async () => ({ event, markdown: "exact" }),
    app: {
      vault: {
        getFileByPath: () => file,
        read: async () => "exact",
      },
      fileManager: { trashFile: async (candidate: TestFile) => { trashed = candidate; } },
    },
    calendarWriteOverrides: new Map([[notePath, { event, modifiedAt: 1 }]]),
    ambiguousCalendarCreateIds: new Set([event.id]),
    calendarCreatedNotePaths: new Map([[event.id, notePath]]),
    calendarEvents: [event, { ...event, id: "other", notePath: "Calendar/Events/Other.md" }],
    refreshOpenViews: () => { renders += 1; },
    refreshCalendarEvents: async () => { throw new Error("transient refresh failure"); },
    recordIssue: (_context: string, error: Error) => { issues.push(error); },
  });

  await assert.rejects(
    plugin.deleteCalendarEventNote(event, "missing-confirmation"),
    /explicit confirmation/,
  );
  assert.equal(trashed, undefined);

  await plugin.deleteCalendarEventNote(event, CALENDAR_NOTE_DELETE_CONFIRMATION);
  assert.equal(trashed, file);
  assert.deepEqual(plugin.calendarEvents.map((candidate: CalendarEventRecord) => candidate.id), ["other"]);
  assert.equal(plugin.calendarWriteOverrides.has(notePath), false);
  assert.equal(plugin.ambiguousCalendarCreateIds.has(event.id), false);
  assert.equal(plugin.calendarCreatedNotePaths.has(event.id), false);
  assert.equal(renders, 2, "the deleted row disappears immediately and stays gone if refresh fails");
  assert.match(issues[0]?.message ?? "", /moved to trash, but Calendar could not refresh/);
});

test("an invalid Calendar event note can be trashed only while its exact file version is still open", async () => {
  const mtime = Date.parse("2026-10-05T00:00:00.000Z");
  class TestFile {
    readonly path: string;
    readonly stat = { mtime };
    constructor(path: string) { this.path = path; }
  }
  const path = "Calendar/Events/Broken.md";
  const file = new TestFile(path);
  const event: CalendarEventRecord = {
    id: `calendar-note-error:${path}`,
    title: "Cannot sync Broken.md",
    start: "2026-10-05T00:00:00.000Z",
    end: "2026-10-05T01:00:00.000Z",
    allDay: false,
    calendar: "Sync error",
    source: "linked",
    notePath: path,
    syncState: "error",
    vaultModifiedAt: new Date(mtime).toISOString(),
  };
  const plugin = loadMethods("src/main.ts", ["deleteCalendarEventNote"], { TFile: TestFile });
  let trashed = false;
  Object.assign(plugin, {
    app: {
      vault: { getFileByPath: () => file },
      fileManager: { trashFile: async () => { trashed = true; } },
    },
    calendarNoteSnapshotForAction: async () => assert.fail("invalid YAML must not require parsing before confirmed trash"),
    calendarWriteOverrides: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    calendarCreatedNotePaths: new Map(),
    calendarEvents: [event],
    refreshOpenViews() {},
    refreshCalendarEvents: async () => {},
    recordIssue() {},
  });

  await plugin.deleteCalendarEventNote(event, CALENDAR_NOTE_DELETE_CONFIRMATION);
  assert.equal(trashed, true);

  trashed = false;
  file.stat.mtime += 1;
  await assert.rejects(
    plugin.deleteCalendarEventNote(event, CALENDAR_NOTE_DELETE_CONFIRMATION),
    /changed after it was opened.*Nothing was deleted/,
  );
  assert.equal(trashed, false);
});

test("a user-authored calendar-note-error prefix still receives full byte revalidation", async () => {
  class TestFile {
    readonly path: string;
    constructor(path: string) { this.path = path; }
  }
  const path = "Calendar/Events/Valid prefix.md";
  const file = new TestFile(path);
  const event: CalendarEventRecord = {
    id: "calendar-note-error:user-authored-id",
    title: "Valid prefix",
    start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z",
    allDay: false,
    calendar: "Vault",
    source: "vault",
    notePath: path,
    syncState: "error",
  };
  let snapshotReads = 0;
  let trashed = false;
  const plugin = loadMethods("src/main.ts", ["deleteCalendarEventNote"], { TFile: TestFile });
  Object.assign(plugin, {
    unloaded: false,
    calendarNoteSnapshotForAction: async () => {
      snapshotReads += 1;
      return { event, markdown: "exact" };
    },
    app: {
      vault: { getFileByPath: () => file, read: async () => "exact" },
      fileManager: { trashFile: async () => { trashed = true; } },
    },
    calendarWriteOverrides: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    calendarCreatedNotePaths: new Map(),
    calendarEvents: [event],
    refreshOpenViews() {},
    refreshCalendarEvents: async () => {},
    recordIssue() {},
  });

  await plugin.deleteCalendarEventNote(event, CALENDAR_NOTE_DELETE_CONFIRMATION);
  assert.equal(snapshotReads, 1);
  assert.equal(trashed, true);
});

test("deleting an event note rechecks its exact bytes immediately before trash", async () => {
  class TestFile {
    readonly path: string;
    constructor(path: string) { this.path = path; }
  }
  const path = "Elsewhere/Edited event.md";
  const file = new TestFile(path);
  const event: CalendarEventRecord = {
    id: "evt_changed_before_trash",
    title: "Edited event",
    start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z",
    allDay: false,
    calendar: "Vault",
    source: "vault",
    notePath: path,
    syncState: "clean",
  };
  const plugin = loadMethods("src/main.ts", ["deleteCalendarEventNote"], { TFile: TestFile });
  let trashed = false;
  let refreshed = false;
  Object.assign(plugin, {
    calendarNoteSnapshotForAction: async () => ({ event, markdown: "before" }),
    app: {
      vault: {
        getFileByPath: () => file,
        read: async () => "changed after confirmation opened",
      },
      fileManager: { trashFile: async () => { trashed = true; } },
    },
    calendarWriteOverrides: new Map(),
    ambiguousCalendarCreateIds: new Set(),
    calendarCreatedNotePaths: new Map(),
    calendarEvents: [event],
    refreshOpenViews() {},
    refreshCalendarEvents: async () => { refreshed = true; },
    recordIssue() {},
  });

  await assert.rejects(
    plugin.deleteCalendarEventNote(event, CALENDAR_NOTE_DELETE_CONFIRMATION),
    /changed after it was opened.*Nothing was deleted/,
  );
  assert.equal(trashed, false);
  assert.equal(refreshed, true);
});

test("disabling the plugin while an event note delete is revalidating prevents trash", async () => {
  class TestFile {
    readonly path: string;
    constructor(path: string) { this.path = path; }
  }
  const path = "Calendar/Events/Disable race.md";
  const file = new TestFile(path);
  const event: CalendarEventRecord = {
    id: "evt_disable_delete",
    title: "Disable race",
    start: "2026-10-08T10:00:00.000Z",
    end: "2026-10-08T11:00:00.000Z",
    allDay: false,
    calendar: "Vault",
    source: "vault",
    notePath: path,
    syncState: "clean",
  };
  const read = deferred<string>();
  let trashed = false;
  const plugin = loadMethods("src/main.ts", ["deleteCalendarEventNote"], { TFile: TestFile });
  Object.assign(plugin, {
    unloaded: false,
    calendarNoteSnapshotForAction: async () => ({ event, markdown: "exact" }),
    app: {
      vault: { getFileByPath: () => file, read: async () => read.promise },
      fileManager: { trashFile: async () => { trashed = true; } },
    },
    refreshCalendarEvents: async () => {},
  });

  const deletion = plugin.deleteCalendarEventNote(event, CALENDAR_NOTE_DELETE_CONFIRMATION);
  plugin.unloaded = true;
  read.resolve("exact");
  await assert.rejects(deletion, /disabled.*Nothing was deleted/);
  assert.equal(trashed, false);
});

test("calendar sync revalidates a note after a deferred EventKit read and refuses the stale write", async () => {
  const baseline = {
    id: "evt_deferred",
    title: "Baseline",
    start: "2026-10-06T08:00:00.000Z",
    end: "2026-10-06T09:00:00.000Z",
    allDay: false,
    calendar: "Activity",
    source: "linked" as const,
    notePath: "Calendar/Events/deferred.md",
    appleCalendarId: "cal_1",
    appleItemId: "item_1",
    appleExternalId: "external_1",
  };
  const syncHash = eventSyncHash(baseline);
  const before = {
    type: "event", "event-id": baseline.id, title: baseline.title,
    start: baseline.start, end: baseline.end, "all-day": false,
    calendar: baseline.calendar, "event-source": "linked",
    "apple-calendar-id": baseline.appleCalendarId, "apple-item-id": baseline.appleItemId,
    "apple-external-id": baseline.appleExternalId, "sync-hash": syncHash,
  };
  const after = { ...before, title: "Edited while Calendar was loading" };
  const outside = { ...baseline, title: "Changed in Calendar", source: "external" as const };
  const initialEventKitRead = deferred<CalendarEventRecord[]>();
  let currentMarkdown = "before";
  const file = { path: baseline.notePath, stat: { mtime: 100 } };
  let eventKitReads = 0;
  let noteWrites = 0;
  let calendarWrites = 0;
  const plugin = loadMethods("src/main.ts", [
    "readCalendarNoteSnapshot", "readCalendarNoteSnapshotByPath", "calendarNoteErrorRecord",
    "readFreshExternalEvent", "revalidateCalendarWrite", "calendarWriteRaceEvent", "performCalendarRefresh",
  ], {
    Platform: { isMacOS: true },
    getFrontMatterInfo: (markdown: string) => ({ exists: true, frontmatter: markdown }),
    parseYaml: (marker: string) => marker === "before" ? before : after,
    recordFromFrontmatter,
    resolveCalendarWriteOverride,
    calendarFetchWindow,
    calendarIdentityKeys,
    classifyLinkedAvailability,
    classifyLinkedChange,
    mergeExternalIntoLinked,
    summarizeCalendarSync,
    calendarEventVersion,
    CalendarSnapshotChangedError,
    TFile: class { static [Symbol.hasInstance]() { return true; } },
  });
  Object.assign(plugin, {
    app: {
      vault: {
        getMarkdownFiles: () => [file],
        getFileByPath: () => file,
        read: async () => currentMarkdown,
      },
      metadataCache: { getFileCache: () => ({ frontmatter: before }) },
    },
    settings: { selectedCalendarIds: ["cal_1"] },
    eventKitBridge: {
      events: async () => {
        eventKitReads += 1;
        return await initialEventKitRead.promise;
      },
      lookup: async () => outside,
    },
    hasEventKitHelper: () => true,
    calendarWriteOverrides: new Map(),
    calendarEvents: [],
    writeCalendarNote: async () => { noteWrites += 1; },
    pushLinkedEventToCalendar: async () => { calendarWrites += 1; },
    clearIssue() {},
    recordIssue() {},
    refreshOpenViews() {},
  });

  const syncing = plugin.performCalendarRefresh(true);
  await Promise.resolve();
  currentMarkdown = "after";
  file.stat.mtime = 200;
  initialEventKitRead.resolve([outside]);
  const summary = await syncing;

  assert.deepEqual(summary, { conflicts: 1, unavailable: 0, errors: 0, pending: 0 });
  assert.equal(plugin.calendarEvents[0].title, "Edited while Calendar was loading");
  assert.equal(plugin.calendarEvents[0].conflictExternal.title, "Changed in Calendar");
  assert.equal(noteWrites, 0);
  assert.equal(calendarWrites, 0);
  assert.equal(eventKitReads, 2, "revalidation re-reads the window so duplicate stable identities cannot be hidden by an exact lookup");
});

function conflictFixture() {
  const note: CalendarEventRecord = {
    id: "evt_modal",
    title: "Note version",
    start: "2026-10-06T08:00:00.000Z",
    end: "2026-10-06T09:00:00.000Z",
    allDay: false,
    calendar: "Activity",
    source: "linked" as const,
    notePath: "Calendar/Events/modal.md",
    appleCalendarId: "cal_1",
    appleItemId: "item_1",
    appleExternalId: "external_1",
    syncHash: "v1:baseline",
    vaultModifiedAt: "2026-10-05T00:00:00.000Z",
    syncState: "conflict" as const,
  };
  const external: CalendarEventRecord = {
    ...note,
    title: "Calendar version",
    source: "external" as const,
    notePath: undefined,
    syncHash: undefined,
    vaultModifiedAt: undefined,
    externalModifiedAt: "2026-10-05T00:01:00.000Z",
    syncState: "clean" as const,
  };
  return { note: { ...note, conflictExternal: external }, external };
}

function conflictResolverHarness(event: CalendarEventRecord, outside: CalendarEventRecord) {
  const plugin = loadMethods("src/main.ts", ["resolveCalendarConflict"], {
    calendarEventVersion,
    CalendarSnapshotChangedError,
    mergeExternalIntoLinked,
  });
  let current: CalendarEventRecord = { ...event, conflictExternal: undefined };
  let currentMarkdown = "current";
  let freshOutside = outside;
  let writes = 0;
  let refreshes = 0;
  Object.assign(plugin, {
    readCalendarNoteSnapshotByPath: async () => ({ event: current, markdown: currentMarkdown }),
    readFreshExternalEvent: async () => freshOutside,
    isSelectedWritableCalendar: () => true,
    writeCalendarNote: async (next: CalendarEventRecord) => {
      writes += 1;
      current = { ...next, conflictExternal: undefined };
      currentMarkdown = `written-${writes}`;
      return next;
    },
    pushLinkedEventToCalendar: async (next: CalendarEventRecord) => ({ ...next, syncState: "clean" }),
    refreshCalendarEvents: async () => { refreshes += 1; },
    recordIssue() {},
  });
  return {
    plugin,
    get writes() { return writes; },
    get refreshes() { return refreshes; },
    setCurrent(next: CalendarEventRecord) { current = next; },
    setExternal(next: CalendarEventRecord) { freshOutside = next; },
  };
}

test("a conflict choice is rejected when the note changed after the modal opened", async () => {
  const { note, external } = conflictFixture();
  const harness = conflictResolverHarness(note, external);
  harness.setCurrent({ ...note, title: "Newer note edit", conflictExternal: undefined });
  await assert.rejects(
    harness.plugin.resolveCalendarConflict(note, "external"),
    /conflict changed after the comparison opened/,
  );
  assert.equal(harness.writes, 0);
  assert.equal(harness.refreshes, 1);
});

test("a conflict choice is rejected when the Calendar item changed after the modal opened", async () => {
  const { note, external } = conflictFixture();
  const harness = conflictResolverHarness(note, external);
  harness.setExternal({ ...external, title: "Newer Calendar edit", externalModifiedAt: "2026-10-05T00:02:00.000Z" });
  await assert.rejects(
    harness.plugin.resolveCalendarConflict(note, "external"),
    /conflict changed after the comparison opened/,
  );
  assert.equal(harness.writes, 0);
  assert.equal(harness.refreshes, 1);
});

test("only the first of two independently opened conflict modals can resolve the shown versions", async () => {
  const { note, external } = conflictFixture();
  const harness = conflictResolverHarness(note, external);
  await harness.plugin.resolveCalendarConflict(note, "external");
  await assert.rejects(
    harness.plugin.resolveCalendarConflict(note, "external"),
    /conflict changed after the comparison opened/,
  );
  assert.equal(harness.writes, 1);
  assert.equal(harness.refreshes, 2);
});

test("a later conflict with freshly shown versions can be resolved after an earlier conflict", async () => {
  const { note, external } = conflictFixture();
  const harness = conflictResolverHarness(note, external);
  await harness.plugin.resolveCalendarConflict(note, "external");
  const nextExternal = {
    ...external,
    title: "Calendar version 2",
    externalModifiedAt: "2026-10-05T00:03:00.000Z",
  };
  const nextNote = {
    ...note,
    title: "Note version 2",
    syncHash: eventSyncHash(external),
    conflictExternal: nextExternal,
  };
  harness.setCurrent({ ...nextNote, conflictExternal: undefined });
  harness.setExternal(nextExternal);
  await harness.plugin.resolveCalendarConflict(nextNote, "external");
  assert.equal(harness.writes, 2);
});

test("calendar note writes use the exact markdown snapshot as a compare-and-swap guard", async () => {
  const plugin = loadMethods("src/main.ts", ["writeCalendarNote"], {
    normalizeEventKitEvent: (event: CalendarEventRecord) => event,
    updateEventNote: () => { throw new Error("must not update stale markdown"); },
    CalendarSnapshotChangedError,
  });
  const file = { path: "Calendar/Events/cas.md", stat: { mtime: 100 } };
  const { note } = conflictFixture();
  Object.assign(plugin, {
    ensureFolder: async () => {},
    app: {
      vault: {
        getFileByPath: () => file,
        process: async (_file: unknown, transform: (current: string) => string) => transform("newer markdown"),
      },
    },
    calendarWriteOverrides: new Map(),
  });

  await assert.rejects(
    plugin.writeCalendarNote(note, "shown markdown"),
    (error: unknown) => error instanceof CalendarSnapshotChangedError,
  );
  assert.equal(plugin.calendarWriteOverrides.size, 0);
});

test("an updated Calendar note returns its write-after mtime so the next action is not falsely stale", async () => {
  const plugin = loadMethods("src/main.ts", ["writeCalendarNote", "calendarNoteSnapshotForAction"], {
    normalizeEventKitEvent: (event: CalendarEventRecord) => event,
    updateEventNote: () => "saved markdown",
    CalendarSnapshotChangedError,
  });
  const file = { path: "Calendar/Events/immediate-action.md", stat: { mtime: 100 } };
  const { note } = conflictFixture();
  const current = {
    ...note,
    notePath: file.path,
    conflictExternal: undefined,
    syncState: "clean" as const,
  };
  Object.assign(plugin, {
    ensureFolder: async () => {},
    app: {
      vault: {
        getFileByPath: () => file,
        process: async (_file: unknown, transform: (markdown: string) => string) => {
          assert.equal(transform("shown markdown"), "saved markdown");
          file.stat.mtime = 250;
        },
      },
    },
    calendarWriteOverrides: new Map(),
  });

  const saved = await plugin.writeCalendarNote(current, "shown markdown");
  assert.equal(saved.vaultModifiedAt, new Date(250).toISOString());
  plugin.readCalendarNoteSnapshotByPath = async () => ({ event: { ...saved }, markdown: "saved markdown" });
  const immediateSnapshot = await plugin.calendarNoteSnapshotForAction(saved);
  assert.equal(immediateSnapshot.event.vaultModifiedAt, saved.vaultModifiedAt);
  assert.equal(plugin.calendarWriteOverrides.get(file.path).event.vaultModifiedAt, saved.vaultModifiedAt);
});

test("a newly created Calendar note returns the created file mtime", async () => {
  const plugin = loadMethods("src/main.ts", ["writeCalendarNote", "calendarNoteSnapshotForAction"], {
    normalizeEventKitEvent: (event: CalendarEventRecord) => event,
    serializeEventNote: () => "created markdown",
    eventNotePath: () => "Calendar/Events/created.md",
    CalendarSnapshotChangedError,
  });
  const file = { path: "Calendar/Events/created.md", stat: { mtime: 400 } };
  const { note } = conflictFixture();
  const creating = {
    ...note,
    notePath: undefined,
    appleCalendarId: undefined,
    appleItemId: undefined,
    appleExternalId: undefined,
    conflictExternal: undefined,
    syncState: "clean" as const,
  };
  Object.assign(plugin, {
    ensureFolder: async () => {},
    uniquePath: async () => file.path,
    app: {
      vault: {
        getFileByPath: () => null,
        create: async () => file,
      },
    },
    calendarWriteOverrides: new Map(),
  });

  const saved = await plugin.writeCalendarNote(creating);
  assert.equal(saved.vaultModifiedAt, new Date(400).toISOString());
  plugin.readCalendarNoteSnapshotByPath = async () => ({ event: { ...saved }, markdown: "created markdown" });
  await assert.doesNotReject(plugin.calendarNoteSnapshotForAction(saved));
  assert.equal(plugin.calendarWriteOverrides.get(file.path).event.vaultModifiedAt, saved.vaultModifiedAt);
});

test("dismissing the current issue clears its matching capture retry and preserves exact-ID semantics", () => {
  const plugin = loadMethods("src/main.ts", [
    "recordIssue", "clearIssueById", "currentIssueId", "dismissIssue",
  ]);
  let refreshes = 0;
  Object.assign(plugin, {
    issueSequence: 0,
    lastIssueId: 0,
    lastError: "",
    lastErrorAt: 0,
    lastErrorContext: "",
    lastErrorSource: "",
    lastCaptureFailure: null,
    refreshHomeViews: () => { refreshes += 1; },
  });
  const first = plugin.recordIssue("capture", new Error("Capture failed"), "first source");
  const second = plugin.recordIssue("capture", new Error("Capture failed"), "second source");
  plugin.lastCaptureFailure = { id: 9, issueId: second };

  plugin.dismissIssue(first);
  assert.equal(plugin.currentIssueId(), second);
  assert.equal(plugin.lastErrorSource, "second source");
  assert.deepEqual(plugin.lastCaptureFailure, { id: 9, issueId: second });
  assert.equal(refreshes, 0, "a stale card must not dismiss a newer issue");

  plugin.dismissIssue(second);
  assert.equal(plugin.currentIssueId(), 0);
  assert.equal(plugin.lastError, "");
  assert.equal(plugin.lastCaptureFailure, null);
  assert.equal(refreshes, 1);

  const repeated = plugin.recordIssue("capture", new Error("Capture failed"), "third source");
  assert.ok(repeated > second, "a repeated error must receive a new dismissible issue ID");
  assert.equal(plugin.lastError, "Capture failed");
});

test("dismissing an independent capture retry preserves the unrelated current issue", () => {
  const plugin = loadMethods("src/main.ts", [
    "recordIssue", "currentIssueId", "dismissCaptureFailure",
  ]);
  let refreshes = 0;
  Object.assign(plugin, {
    issueSequence: 0,
    lastIssueId: 0,
    lastError: "",
    lastErrorAt: 0,
    lastErrorContext: "",
    lastErrorSource: "",
    lastCaptureFailure: { id: 27, issueId: 1 },
    refreshHomeViews: () => { refreshes += 1; },
  });
  const current = plugin.recordIssue("calendar", new Error("Calendar failed"));

  plugin.dismissCaptureFailure(26);
  assert.equal(plugin.lastCaptureFailure.id, 27);
  assert.equal(refreshes, 0, "a stale retry button must not clear the current snapshot");

  plugin.dismissCaptureFailure(27);
  assert.equal(plugin.lastCaptureFailure, null);
  assert.equal(plugin.currentIssueId(), current);
  assert.equal(plugin.lastError, "Calendar failed");
  assert.equal(refreshes, 1);
});

function localSetupHarness(model: LocalAiModelInfo, remote = false): { plugin: Harness; calls: string[]; vaultCalls: string[] } {
  const calls: string[] = [];
  const vaultCalls: string[] = [];
  const host = "http://localhost:11434";
  const plugin = mainHarness([
    "checkLocalAiConnection",
    "activeLocalAiModels",
    "safeShowModel",
    "beginLocalAiAction",
    "finishLocalAiAction",
  ], {
    LocalAiError,
    aggregateLocalAiState,
    buildConnectionSummary,
    buildModelEntry,
    deriveLocalAiDaemonCode,
    deriveLocalAiModelCode,
    describeDaemonReadiness,
    describeLocalCompletionCatalog,
    describeModelReadiness,
    getActiveWorkflowModels: (settings: Harness) => [{ model: settings.aiModel }],
    localModelNamesMatch,
    mergeInspectedModelEntry,
    normalizeLocalOllamaHost,
  });
  const catalogEntry = buildModelEntry({
    ...model,
    remoteModel: remote ? model.name : undefined,
    remoteHost: remote ? "https://ollama.com" : undefined,
  });
  Object.assign(plugin, {
    settings: {
      aiProvider: "ollama",
      aiModel: model.name,
      localWritingModel: model.name,
      embeddingModel: "bge-m3",
      ollamaHost: host,
      capturePolish: false,
    },
    localAiActionToken: 0,
    localAiControllers: new Set<AbortController>(),
    localAiSummaries: new Map(),
    localAiFailure: null,
    ollamaLocalClient: {
      version: async (receivedHost: string) => { calls.push(`version:${receivedHost}`); return { version: "0.33.3" }; },
      status: async (receivedHost: string) => { calls.push(`status:${receivedHost}`); return { cloud: { disabled: false } }; },
      tags: async (receivedHost: string) => { calls.push(`tags:${receivedHost}`); return [catalogEntry]; },
      show: async (receivedHost: string, receivedModel: string) => {
        calls.push(`show:${receivedHost}:${receivedModel}`);
        if (!localModelNamesMatch(receivedModel, model.name)) {
          throw new LocalAiError("selected_model_missing", `${receivedModel} is not installed.`);
        }
        return { ...model, remoteModel: catalogEntry.remoteModel, remoteHost: catalogEntry.remoteHost };
      },
      smoke: async () => assert.fail("Check setup must not generate model output"),
      embed: async () => assert.fail("Check setup must not generate embeddings"),
      pull: async () => assert.fail("Check setup must not download models"),
    },
    omdBridge: {
      search: async () => { vaultCalls.push("search"); },
      answer: async () => { vaultCalls.push("answer"); },
    },
  });
  plugin.syncLocalAiState = (activeAction: LocalAiRuntimeState["activeAction"]) => {
    const summary = plugin.localAiSummaries.get(host) ?? null;
    plugin.localAiState = aggregateLocalAiState(plugin.settings, summary, summary?.models ?? [], activeAction);
  };
  plugin.syncLocalAiState("");
  return { plugin, calls, vaultCalls };
}

function embeddingInstallHarness(savedModel: string, catalog: LocalAiModelInfo[] = []): { plugin: Harness; calls: string[] } {
  const calls: string[] = [];
  const plugin = mainHarness(["installEmbeddingModel"], {
    buildModelEntry,
    localModelNamesMatch,
    mergeInspectedModelEntry,
    modelIsCloudBacked,
    modelSupportsEmbedding,
    normalizeLocalOllamaHost,
    oneClickInstallableEmbeddingModel,
  });
  Object.assign(plugin.settings, {
    embeddingModel: savedModel,
    ollamaHost: "http://localhost:11434",
  });
  plugin.canStartAiSetupAction = () => true;
  plugin.beginLocalAiAction = (action: string) => {
    calls.push(`begin:${action}`);
    return 1;
  };
  plugin.finishLocalAiAction = (token: number) => { calls.push(`finish:${token}`); };
  plugin.withLocalAiSignal = async (task: (signal: AbortSignal) => Promise<unknown>) => await task(new AbortController().signal);
  plugin.reportLocalAiWorkflowIssue = (error: unknown) => { plugin.issues.push(error); };
  plugin.safeShowModel = async (_host: string, model: string) => {
    calls.push(`show:${model}`);
    return { name: model, capabilities: ["embedding"] };
  };
  plugin.ollamaLocalClient = {
    tags: async () => {
      calls.push("tags");
      return catalog.map((entry) => buildModelEntry(entry));
    },
    pull: async (_host: string, model: string) => { calls.push(`pull:${model}`); },
  };
  plugin.refreshLocalAiCatalog = async (force: boolean) => { calls.push(`refresh:${String(force)}`); };
  return { plugin, calls };
}

const credential = {
  provider: "openai",
  source: "keychain",
  keychainSupported: true,
  envVar: "OPENAI_API_KEY",
  envPresent: false,
  keychainPresent: true,
};

test("local setup accepts a model that advertises both thinking and completion", async () => {
  const { plugin, calls, vaultCalls } = localSetupHarness({
    name: "qwen3:4b-instruct",
    capabilities: ["completion", "thinking", "tools"],
  });

  assert.equal(await plugin.checkLocalAiConnection(), true);
  const checked = plugin.localAiSummaries.get("http://localhost:11434").modelChecks["qwen3:4b-instruct"];
  assert.equal(checked.code, "ready");
  assert.equal(checked.supportsCompletion, true);
  assert.deepEqual(calls, [
    "version:http://localhost:11434",
    "status:http://localhost:11434",
    "tags:http://localhost:11434",
    "show:http://localhost:11434:qwen3:4b-instruct",
    "show:http://localhost:11434:bge-m3",
  ]);
  assert.deepEqual(vaultCalls, []);
});

test("local setup blocks an exposed cloud-backed custom model without touching the vault", async () => {
  const { plugin, calls, vaultCalls } = localSetupHarness({
    name: "gpt-oss:20b-cloud",
    capabilities: ["completion"],
  }, true);

  assert.equal(await plugin.checkLocalAiConnection(), false);
  const checked = plugin.localAiSummaries.get("http://localhost:11434").modelChecks["gpt-oss:20b-cloud"];
  assert.equal(checked.code, "selected_model_remote_blocked");
  assert.equal(checked.supportsCompletion, true);
  assert.deepEqual(calls, [
    "version:http://localhost:11434",
    "status:http://localhost:11434",
    "tags:http://localhost:11434",
    "show:http://localhost:11434:gpt-oss:20b-cloud",
    "show:http://localhost:11434:bge-m3",
  ]);
  assert.deepEqual(vaultCalls, []);
});

test("one-click embedding installation enforces its allowlist and stale-action snapshot before network access", async () => {
  const unsupported = embeddingInstallHarness("nomic-embed-text");
  assert.equal(await unsupported.plugin.installEmbeddingModel("nomic-embed-text"), false);
  assert.deepEqual(unsupported.calls, ["begin:install-embedding", "finish:1"]);

  const stale = embeddingInstallHarness("other-model");
  assert.equal(await stale.plugin.installEmbeddingModel("bge-m3"), false);
  assert.deepEqual(stale.calls, ["begin:install-embedding", "finish:1"]);
});

test("one-click embedding installation canonicalizes aliases and downloads only when explicitly requested", async () => {
  const installed = embeddingInstallHarness("BGE-M3", [{
    name: "bge-m3:latest",
    capabilities: ["embedding"],
  }]);
  assert.equal(await installed.plugin.installEmbeddingModel("BGE-M3:latest"), true);
  assert.deepEqual(installed.calls, [
    "begin:install-embedding",
    "tags",
    "show:bge-m3",
    "finish:1",
    "refresh:false",
  ]);

  const missing = embeddingInstallHarness("bge-m3");
  assert.equal(await missing.plugin.installEmbeddingModel("bge-m3"), true);
  assert.deepEqual(missing.calls, [
    "begin:install-embedding",
    "tags",
    "pull:bge-m3",
    "show:bge-m3",
    "finish:1",
    "refresh:false",
  ]);
});

test("Use keyword search by default persists the retrieval choice once and leaves an already-keyword setup unchanged", async () => {
  const plugin = mainHarness(["useSparseRetrieval"]);
  const calls: string[] = [];
  plugin.settings.hybridRetrievalEnabled = true;
  plugin.invalidateLocalAiState = (reason: string) => { calls.push(`invalidate:${reason}`); };
  plugin.saveSettings = async () => { calls.push("save"); };
  plugin.refreshHomeViews = () => { calls.push("refresh"); };

  assert.equal(await plugin.useSparseRetrieval(), true);
  assert.equal(plugin.settings.hybridRetrievalEnabled, false);
  assert.deepEqual(calls, ["invalidate:retrieval", "save", "refresh"]);
  assert.match(plugin.feedback.at(-1) ?? "", /Keyword search selected/u);

  assert.equal(await plugin.useSparseRetrieval(), false);
  assert.deepEqual(calls, ["invalidate:retrieval", "save", "refresh"]);
  assert.equal(plugin.notices.at(-1), "Keyword search is already selected.");
});

test("Use keyword search by default cannot invalidate an in-flight AI setup action", async () => {
  const plugin = mainHarness(["useSparseRetrieval"]);
  const calls: string[] = [];
  plugin.settings.hybridRetrievalEnabled = true;
  plugin.hostedCredentialMutation = Symbol("saving-key");
  plugin.invalidateLocalAiState = (reason: string) => { calls.push(`invalidate:${reason}`); };
  plugin.saveSettings = async () => { calls.push("save"); };
  plugin.refreshHomeViews = () => { calls.push("refresh"); };

  assert.equal(await plugin.useSparseRetrieval(), false);

  assert.equal(plugin.settings.hybridRetrievalEnabled, true);
  assert.deepEqual(calls, []);
  assert.match(plugin.notices.at(-1) ?? "", /Another AI setup action is already running/u);
  assert.match(
    readMethod("src/main.ts", "renderRetrievalDiagnostics"),
    /useSparseRetrieval\(\)\.then\(\(selected\)\s*=>\s*\{\s*if \(selected && sparse\.isConnected\)/su,
    "the warning button must claim success only when the persisted action returns true",
  );
});

test("invalid hosted credentials retain an actionable runtime state", async () => {
  const plugin = mainHarness();
  plugin.omdBridge = {
    hostedCredentialState: async () => {
      throw new Error("OpenAI rejected the developer API key. Replace it in Settings → OMD Home → AI answers, then check setup again.");
    },
  };

  await plugin.ensureHostedCredentialState("openai");

  assert.equal(plugin.hostedAiState.code, "credentials_invalid");
  assert.match(plugin.hostedAiState.detail, /rejected the developer API key/iu);
});

test("Open retrieval settings uses feature-detected navigation and falls back to manual guidance", async () => {
  const runtime = globalThis as typeof globalThis & { window?: unknown };
  const previousWindow = runtime.window;
  Object.defineProperty(runtime, "window", {
    value: { setTimeout },
    configurable: true,
    writable: true,
  });
  try {
    const plugin = mainHarness(["openRetrievalSettings"]);
    const calls: string[] = [];
    plugin.manifest = { id: "omd-home" };
    plugin.settingTab = { showRetrievalSettings: () => { calls.push("show-retrieval"); } };
    plugin.app = { setting: {
      open: () => { calls.push("open"); },
      openTabById: (id: string) => { calls.push(`tab:${id}`); },
    } };
    plugin.openRetrievalSettings();
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
    assert.deepEqual(calls, ["open", "tab:omd-home", "show-retrieval"]);

    const unavailable = mainHarness(["openRetrievalSettings"]);
    unavailable.app = { setting: { open: () => {} } };
    unavailable.settingTab = {};
    unavailable.openRetrievalSettings();
    assert.equal(unavailable.notices.at(-1), "Open settings → OMD Home → advanced AI controls → vault retrieval.");

    const failed = mainHarness(["openRetrievalSettings"]);
    failed.manifest = { id: "omd-home" };
    failed.settingTab = { showRetrievalSettings() {} };
    failed.app = { setting: {
      open: () => { throw new Error("Settings unavailable"); },
      openTabById() {},
    } };
    failed.openRetrievalSettings();
    assert.equal(failed.notices.at(-1), "Open settings → OMD Home → advanced AI controls → vault retrieval.");
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(runtime, "window");
    else Object.defineProperty(runtime, "window", { value: previousWindow, configurable: true, writable: true });
  }
});

test("hosted preview checks credentials before model selection or vault retrieval", async () => {
  const plugin = mainHarness(["previewCloudAnswer"], {
    DEFAULT_SETTINGS: { ollamaHost: "http://localhost:11434" },
    LocalAiError,
    normalizeLocalOllamaHost,
  });
  const calls: string[] = [];
  Object.assign(plugin.settings, { aiProvider: "openai", aiModel: "", ollamaHost: "http://localhost:11434" });
  plugin.currentLocalAiHost = () => null;
  plugin.qaRetrievalOptions = () => ({
    hybridRetrievalEnabled: true,
    embeddingModel: "bge-m3",
    semanticRerankEnabled: false,
  });
  plugin.prepareQaRetrieval = async () => {
    calls.push("retrieval");
    return { options: plugin.qaRetrievalOptions(), warning: null };
  };
  plugin.omdBridge = {
    hostedCredentialState: async () => {
      calls.push("credential");
      return { ...credential, source: "missing" };
    },
    previewAi: async () => {
      calls.push("preview");
      return {};
    },
  };

  await assert.rejects(
    plugin.previewCloudAnswer("What is in my vault?", "openai", ""),
    (error: unknown) => error instanceof LocalAiError && error.code === "credentials_missing",
  );
  assert.deepEqual(calls, ["credential"]);
});

test("hosted preview checks model selection only after credentials are available", async () => {
  const plugin = mainHarness(["previewCloudAnswer"], {
    DEFAULT_SETTINGS: { ollamaHost: "http://localhost:11434" },
    LocalAiError,
    normalizeLocalOllamaHost,
  });
  const calls: string[] = [];
  Object.assign(plugin.settings, { aiProvider: "openai", aiModel: "", ollamaHost: "http://localhost:11434" });
  plugin.currentLocalAiHost = () => null;
  plugin.qaRetrievalOptions = () => ({
    hybridRetrievalEnabled: true,
    embeddingModel: "bge-m3",
    semanticRerankEnabled: false,
  });
  plugin.prepareQaRetrieval = async () => {
    calls.push("retrieval");
    return { options: plugin.qaRetrievalOptions(), warning: null };
  };
  plugin.omdBridge = {
    hostedCredentialState: async () => {
      calls.push("credential");
      return credential;
    },
    previewAi: async () => {
      calls.push("preview");
      return {};
    },
  };

  await assert.rejects(
    plugin.previewCloudAnswer("What is in my vault?", "openai", ""),
    (error: unknown) => error instanceof LocalAiError && error.code === "selected_model_missing",
  );
  assert.deepEqual(calls, ["credential"]);
});

for (const model of ["gpt-4", "future-openai-model"]) {
  test(`hosted preview blocks ${model} before vault retrieval or generation`, async () => {
    const plugin = mainHarness(["previewCloudAnswer"], {
      DEFAULT_SETTINGS: { ollamaHost: "http://localhost:11434" },
      normalizeLocalOllamaHost,
    });
    const calls: string[] = [];
    Object.assign(plugin.settings, { aiProvider: "openai", aiModel: model, ollamaHost: "http://localhost:11434" });
    plugin.hostedAiState = {
      provider: "openai",
      checkedModel: model,
      checkedAnswerCompatibility: model === "gpt-4" ? "unsupported" : "unverified",
      checkedAnswerContract: null,
      code: "selected_model_incompatible",
      detail: `Backend rejected ${model} for the exact answer contract.`,
      activeAction: "",
      models: [{ name: "gpt-4o-mini" }, { name: "o3-mini" }, { name: model }],
    };
    plugin.currentLocalAiHost = () => null;
    plugin.qaRetrievalOptions = () => ({ hybridRetrievalEnabled: true, embeddingModel: "bge-m3", semanticRerankEnabled: false });
    plugin.prepareQaRetrieval = async () => {
      calls.push("retrieval");
      return { options: plugin.qaRetrievalOptions(), warning: null };
    };
    plugin.omdBridge = {
      hostedCredentialState: async () => { calls.push("credential"); return credential; },
      previewAi: async () => { calls.push("preview"); return {}; },
    };

    await assert.rejects(
      plugin.previewCloudAnswer("What is in my vault?", "openai", model),
      (error: unknown) => error instanceof LocalAiError
        && error.code === "selected_model_incompatible"
        && /Backend rejected/u.test(error.message),
    );
    assert.deepEqual(calls, ["credential"]);
  });
}

test("hosted preview requires Check setup for the exact verified OpenAI model", async () => {
  const plugin = mainHarness(["previewCloudAnswer"], {
    DEFAULT_SETTINGS: { ollamaHost: "http://localhost:11434" },
    normalizeLocalOllamaHost,
  });
  const calls: string[] = [];
  Object.assign(plugin.settings, { aiProvider: "openai", aiModel: "gpt-4o-mini", ollamaHost: "http://localhost:11434" });
  plugin.currentLocalAiHost = () => null;
  plugin.vaultPath = () => "/vault";
  plugin.qaRetrievalOptions = () => ({ hybridRetrievalEnabled: false, embeddingModel: "", semanticRerankEnabled: false });
  plugin.prepareQaRetrieval = async () => {
    calls.push("retrieval");
    return { options: plugin.qaRetrievalOptions(), warning: null, warningModel: null };
  };
  plugin.omdBridge = {
    hostedCredentialState: async () => { calls.push("credential"); return credential; },
    previewAi: async () => {
      calls.push("preview");
      return { preview: { destination_domain: "api.openai.com" } };
    },
  };

  await assert.rejects(
    plugin.previewCloudAnswer("What is in my vault?", "openai", "gpt-4o-mini"),
    (error: unknown) => error instanceof LocalAiError
      && error.code === "selected_model_incompatible"
      && /Run Check setup/iu.test(error.message),
  );
  assert.deepEqual(calls, ["credential"]);

  plugin.hostedAiState = {
    provider: "openai",
    checkedModel: "gpt-4o-mini",
    checkedAnswerCompatibility: "supported",
    checkedAnswerContract: null,
    code: "selected_model_incompatible",
    detail: "The backend response omitted the exact answer contract.",
    activeAction: "",
    models: [{ name: "gpt-4o-mini" }],
  };
  calls.length = 0;
  await assert.rejects(
    plugin.previewCloudAnswer("What is in my vault?", "openai", "gpt-4o-mini"),
    (error: unknown) => error instanceof LocalAiError
      && error.code === "selected_model_incompatible"
      && /omitted the exact answer contract/iu.test(error.message),
  );
  assert.deepEqual(calls, ["credential"]);

  plugin.hostedAiState = {
    provider: "openai",
    checkedModel: "gpt-4o-mini",
    checkedAnswerCompatibility: "supported",
    checkedAnswerContract: "strict_json_schema",
    code: "ready",
    activeAction: "",
    models: [{ name: "gpt-4o-mini" }],
  };
  calls.length = 0;
  await plugin.previewCloudAnswer("What is in my vault?", "openai", "gpt-4o-mini");
  assert.deepEqual(calls, ["credential", "retrieval", "preview"]);
});

for (const provider of ["ollama", "openai"] as const) {
  test(`${provider} answer stops before consent or generation when local retrieval finds no evidence`, async () => {
    let consentOpened = false;
    let executed = false;
    const plugin = mainHarness(["askOmd"], {
      cloudAnswerPermissionEnabled: () => true,
      CloudAnswerConsentModal: class {
        constructor() { consentOpened = true; }
      },
    });
    Object.assign(plugin.settings, {
      aiProvider: provider,
      aiModel: provider === "ollama" ? "qwen3:4b-instruct" : "o3-mini",
      hybridRetrievalEnabled: false,
    });
    plugin.previewLocalAnswer = async () => ({ preview: { evidence: [] }, retrieval: {} });
    plugin.previewCloudAnswer = async () => ({
      provider: "openai",
      model: "o3-mini",
      endpoint: "http://localhost:11434",
      preview: { evidence: [] },
      retrieval: {},
    });
    plugin.executeLocalAnswer = async () => { executed = true; return {}; };
    plugin.executeCloudAnswer = async () => { executed = true; return {}; };
    const messages: string[] = [];
    const output = {
      hidden: true,
      empty() { messages.length = 0; },
      createDiv(options: { text?: string }) { messages.push(options.text ?? ""); return {}; },
    };

    await plugin.askOmd("Question without matching notes", output);

    assert.equal(consentOpened, false);
    assert.equal(executed, false);
    assert.deepEqual(messages, ["No relevant vault evidence was found. No model request was sent."]);
  });
}

for (const [warning, model, expectedButtons] of [
  ["hybrid_retrieval_model_not_installed", "bge-m3", ["Install model", "Use keyword search by default", "Open retrieval settings"]],
  ["hybrid_retrieval_daemon_unreachable", null, ["Use keyword search by default", "Open retrieval settings"]],
  ["hybrid_retrieval_model_unsupported", null, ["Use keyword search by default", "Open retrieval settings"]],
] as const) {
  test(`zero-evidence Ask preserves ${warning} recovery actions`, async () => {
    const plugin = mainHarness(["askOmd"]);
    Object.assign(plugin.settings, {
      aiProvider: "ollama",
      aiModel: "qwen3:4b-instruct",
      hybridRetrievalEnabled: true,
    });
    plugin.previewLocalAnswer = async () => ({
      preview: { evidence: [], warnings: [warning] },
      retrieval: { hybridRetrievalEnabled: false },
      embeddingFallbackModel: model,
    });
    plugin.executeLocalAnswer = async () => assert.fail("No model request may run without evidence");

    const texts: string[] = [];
    const buttons: string[] = [];
    const element = (): Record<string, any> => ({
      isConnected: true,
      createDiv(options: { text?: string } = {}) {
        if (options.text) texts.push(options.text);
        return element();
      },
      createSpan(options: { text?: string } = {}) {
        if (options.text) texts.push(options.text);
        return element();
      },
      createEl(_tag: string, options: { text?: string } = {}) {
        if (options.text) buttons.push(options.text);
        return { isConnected: true, disabled: false, addEventListener() {} };
      },
    });
    const output = Object.assign(element(), {
      hidden: true,
      empty() {
        texts.length = 0;
        buttons.length = 0;
      },
    });

    await plugin.askOmd("Question without matching notes", output);

    assert.match(texts.join(" "), /No relevant vault evidence was found/u);
    assert.match(texts.join(" "), warning === "hybrid_retrieval_model_not_installed"
      ? /not installed in Ollama/u
      : warning === "hybrid_retrieval_daemon_unreachable"
        ? /could not be reached/u
        : /does not support embeddings/u);
    assert.match(texts.join(" "), /This evidence check used keyword search only\./u);
    assert.doesNotMatch(texts.join(" "), /this answer used keyword search only/iu);
    assert.deepEqual(buttons, expectedButtons);
  });
}

test("retrieval diagnostics use answer wording after an answer exists", () => {
  const plugin = mainHarness();
  plugin.settings.hybridRetrievalEnabled = true;
  const texts: string[] = [];
  const element = (): Record<string, any> => ({
    isConnected: true,
    createDiv() { return element(); },
    createSpan(options: { text?: string } = {}) {
      if (options.text) texts.push(options.text);
      return element();
    },
    createEl() { return { isConnected: true, disabled: false, addEventListener() {} }; },
  });

  plugin.renderRetrievalDiagnostics(
    element(),
    ["hybrid_retrieval_daemon_unreachable"],
    null,
  );

  assert.match(texts.join(" "), /, so this answer used keyword search only\./u);
  assert.doesNotMatch(texts.join(" "), /evidence check/iu);
});

test("an already keyword-only setup does not offer a redundant retrieval switch", () => {
  const plugin = mainHarness();
  plugin.settings.hybridRetrievalEnabled = false;
  const buttons: string[] = [];
  const element = (): Record<string, any> => ({
    isConnected: true,
    createDiv() { return element(); },
    createSpan() { return element(); },
    createEl(_tag: string, options: { text?: string } = {}) {
      if (options.text) buttons.push(options.text);
      return { isConnected: true, disabled: false, addEventListener() {} };
    },
  });

  plugin.renderRetrievalDiagnostics(
    element(),
    ["hybrid_retrieval_daemon_unreachable"],
    null,
  );

  assert.deepEqual(buttons, ["Open retrieval settings"]);
});

for (const [code, warning] of [
  ["selected_model_missing", "hybrid_retrieval_model_not_installed"],
  ["daemon_unreachable", "hybrid_retrieval_daemon_unreachable"],
  ["selected_model_incompatible", "hybrid_retrieval_model_unsupported"],
] as const) {
  test(`hybrid retrieval classifies ${code} before falling back to sparse`, async () => {
    const plugin = loadMethods("src/main.ts", ["prepareQaRetrieval"], {
      LocalAiError,
      normalizeLocalOllamaHost,
    });
    plugin.settings = { ollamaHost: "http://localhost:11434" };
    plugin.qaRetrievalOptions = () => ({
      hybridRetrievalEnabled: true,
      embeddingModel: "bge-m3",
      embeddingModelRevision: "sha256:saved",
      semanticRerankEnabled: true,
    });
    plugin.ollamaLocalClient = {
      status: async () => { throw new LocalAiError(code, `Injected ${code}`); },
    };

    const prepared = await plugin.prepareQaRetrieval();
    assert.equal(prepared.warning, warning);
    assert.deepEqual(prepared.options, {
      hybridRetrievalEnabled: false,
      embeddingModel: "bge-m3",
      embeddingModelRevision: undefined,
      semanticRerankEnabled: false,
    });
  });
}

for (const [stage, injectedCode] of [
  ["catalog", "provider_catalog_unavailable"],
  ["model inspection", "model_unavailable"],
] as const) {
  test(`hybrid retrieval reports a setup-check failure when reachable Ollama ${stage} fails`, async () => {
    const plugin = loadMethods("src/main.ts", ["prepareQaRetrieval"], {
      LocalAiError,
      buildModelEntry,
      deriveLocalAiDaemonCode,
      describeDaemonReadiness,
      localModelNamesMatch,
      mergeInspectedModelEntry,
      modelIsCloudBacked,
      modelSupportsEmbedding,
      normalizeLocalOllamaHost,
    });
    plugin.settings = { ollamaHost: "http://localhost:11434" };
    plugin.qaRetrievalOptions = () => ({
      hybridRetrievalEnabled: true,
      embeddingModel: "bge-m3",
      embeddingModelRevision: "sha256:saved",
      semanticRerankEnabled: true,
    });
    plugin.ollamaLocalClient = {
      status: async () => ({ cloud: { disabled: true } }),
      tags: async () => {
        if (stage === "catalog") throw new LocalAiError(injectedCode, `Injected ${injectedCode}`);
        return [buildModelEntry({ name: "bge-m3", capabilities: ["embedding"] })];
      },
    };
    plugin.safeShowModel = async () => {
      throw new LocalAiError(injectedCode, `Injected ${injectedCode}`);
    };

    const prepared = await plugin.prepareQaRetrieval();
    assert.equal(prepared.warning, "hybrid_retrieval_check_failed");
    assert.equal(prepared.options.hybridRetrievalEnabled, false);
    assert.equal(prepared.options.semanticRerankEnabled, false);
  });
}

test("failed OMD hydration records one attempt and Check setup explicitly retries", async () => {
  const plugin = mainHarness();
  let attempts = 0;
  plugin.requireReadyOmdExecutable = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("OMD executable not found");
    return "/Applications/OMD/bin/omd";
  };
  plugin.omdBridge = {
    discoverProviderModels: async () => ({ models: ["test-model"], credential, destinationDomain: "api.openai.com" }),
  };
  await plugin.ensureHostedCredentialState("openai");
  assert.equal(plugin.hostedAiState.provider, "openai");
  assert.equal(typeof plugin.hostedAiState.checkedAt, "number");
  assert.match(plugin.hostedAiState.detail, /OMD executable not found.+Check setup to retry/u);
  await plugin.ensureHostedCredentialState("openai");
  assert.equal(attempts, 1, "a re-render must not retry failed automatic hydration");
  await plugin.checkHostedAiConnection();
  assert.equal(attempts, 2);
  assert.equal(plugin.hostedAiState.credential, credential);
  assert.equal(plugin.hostedAiState.code, "selected_model_missing");
  assert.equal(plugin.hostedAiState.activeAction, "");
});

test("hosted setup rejects an unexpected provider destination before checking a model", async () => {
  const plugin = mainHarness([], { LocalAiError });
  let modelChecks = 0;
  let catalogChecks = 0;
  Object.assign(plugin.settings, {
    aiProvider: "openai",
    aiModel: "test-model",
    aiModels: { openai: "test-model" },
  });
  plugin.omdBridge = {
    discoverProviderModels: async () => {
      catalogChecks += 1;
      throw new Error("Selected-model setup must use the combined model check");
    },
    checkProviderModel: async () => {
      modelChecks += 1;
      return {
        model: "test-model",
        available: true,
        answerCompatibility: "supported",
        answerCompatibilityReason: "The exact model contract was checked.",
        answerContract: "strict_json_schema",
        models: ["test-model"],
        alternativeModels: [],
        credential,
        destinationDomain: "unexpected.example",
      };
    },
  };

  assert.equal(await plugin.checkHostedAiConnection(), false);
  assert.equal(modelChecks, 1);
  assert.equal(catalogChecks, 0);
  assert.equal(plugin.hostedAiState.code, "provider_destination_mismatch");
  assert.match(plugin.hostedAiState.detail, /unexpected request destination/iu);
});

for (const [model, expectedStatus] of [["gpt-4", "unsupported"], ["future-openai-model", "unverified"]] as const) {
  test(`hosted setup keeps an available but ${expectedStatus} OpenAI model incompatible`, async () => {
    const plugin = mainHarness();
    Object.assign(plugin.settings, {
      aiProvider: "openai",
      aiModel: model,
      aiModels: { openai: model },
    });
    plugin.omdBridge = {
      discoverProviderModels: async () => ({
        models: [model, "gpt-4o-mini", "o3-mini"],
        credential,
        destinationDomain: "api.openai.com",
      }),
      checkProviderModel: async () => ({
        model,
        available: true,
        answerCompatibility: expectedStatus,
        answerCompatibilityReason: `${model} failed the exact backend answer contract check.`,
        answerContract: null,
        models: [model, "gpt-4o-mini", "o3-mini"],
        alternativeModels: [],
        credential,
        destinationDomain: "api.openai.com",
      }),
    };

    assert.equal(await plugin.checkHostedAiConnection(), false);
    assert.equal(plugin.hostedAiState.code, "selected_model_incompatible");
    assert.equal(plugin.hostedAiState.checkedAnswerCompatibility, expectedStatus);
    assert.match(plugin.hostedAiState.detail, /exact backend answer contract/iu);
    assert.equal(plugin.hostedAiState.models.find((entry: Harness) => entry.name === model).supportsCompletion, false);
    assert.equal(plugin.hostedAiState.models.find((entry: Harness) => entry.name === "gpt-4o-mini").answerCompatibility, undefined);
    assert.equal(plugin.settings.aiModels.openai, model, "Check setup must not switch the selected model");
  });
}

test("hosted setup trusts the exact backend compatibility result for GPT-4.1", async () => {
  const plugin = mainHarness();
  let catalogCalls = 0;
  let modelCheckCalls = 0;
  Object.assign(plugin.settings, {
    aiProvider: "openai",
    aiModel: "gpt-4.1",
    aiModels: { openai: "gpt-4.1" },
  });
  plugin.omdBridge = {
    discoverProviderModels: async () => {
      catalogCalls += 1;
      throw new Error("Selected-model setup must not repeat catalog discovery");
    },
    checkProviderModel: async () => {
      modelCheckCalls += 1;
      return {
        model: "gpt-4.1",
        available: true,
        answerCompatibility: "supported",
        answerCompatibilityReason: "gpt-4.1 supports the OpenAI JSON schema answer contract.",
        answerContract: "strict_json_schema",
        models: ["gpt-4", "gpt-4.1"],
        alternativeModels: [],
        credential,
        destinationDomain: "api.openai.com",
      };
    },
  };

  assert.equal(await plugin.checkHostedAiConnection(), true);
  assert.equal(catalogCalls, 0);
  assert.equal(modelCheckCalls, 1);
  assert.equal(plugin.hostedAiState.code, "ready");
  assert.equal(plugin.hostedAiState.checkedModel, "gpt-4.1");
  assert.equal(plugin.hostedAiState.checkedAnswerCompatibility, "supported");
  assert.equal(plugin.hostedAiState.checkedAnswerContract, "strict_json_schema");
  assert.match(plugin.hostedAiState.detail, /OpenAI JSON schema answer contract/iu);
  assert.equal(plugin.settings.aiModels.openai, "gpt-4.1");
});

test("hosted setup rejects a supported result without an explicit answer contract", async () => {
  const plugin = mainHarness();
  Object.assign(plugin.settings, {
    aiProvider: "openai",
    aiModel: "gpt-4.1",
    aiModels: { openai: "gpt-4.1" },
  });
  plugin.omdBridge = {
    discoverProviderModels: async () => ({
      models: ["gpt-4.1"],
      credential,
      destinationDomain: "api.openai.com",
    }),
    checkProviderModel: async () => ({
      model: "gpt-4.1",
      available: true,
      answerCompatibility: "supported",
      answerCompatibilityReason: "The backend marked gpt-4.1 compatible.",
      answerContract: null,
      models: ["gpt-4.1"],
      alternativeModels: [],
      credential,
      destinationDomain: "api.openai.com",
    }),
  };

  assert.equal(await plugin.checkHostedAiConnection(), false);
  assert.equal(plugin.hostedAiState.code, "selected_model_incompatible");
  assert.match(plugin.hostedAiState.detail, /did not identify the answer contract/iu);
  assert.equal(plugin.hostedAiState.models[0].supportsCompletion, false);
});

test("failed credential bridge hydration remains attempted until explicitly forced", async () => {
  const plugin = mainHarness();
  let attempts = 0;
  plugin.omdBridge = { hostedCredentialState: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("Keychain lookup failed");
    return credential;
  } };
  await plugin.ensureHostedCredentialState("openai");
  await plugin.ensureHostedCredentialState("openai");
  assert.equal(attempts, 1);
  assert.equal(plugin.hostedAiState.code, "credentials_missing");
  await plugin.ensureHostedCredentialState("openai", true);
  assert.equal(attempts, 2);
  assert.equal(plugin.hostedAiState.credential, credential);
});

test("credential hydration restarts after switching away from and back to the same provider", async () => {
  const plugin = mainHarness();
  const firstCredential = deferred<unknown>();
  const enteredFirst = deferred<void>();
  let attempts = 0;
  plugin.omdBridge = { hostedCredentialState: async () => {
    attempts += 1;
    if (attempts === 1) {
      enteredFirst.resolve();
      return await firstCredential.promise;
    }
    return credential;
  } };

  const first = plugin.ensureHostedCredentialState("openai");
  await enteredFirst.promise;
  plugin.settings.aiProvider = "ollama";
  plugin.localAiActionToken += 1;
  plugin.syncHostedAiState("");
  plugin.settings.aiProvider = "openai";
  plugin.localAiActionToken += 1;
  plugin.syncHostedAiState("");

  await plugin.ensureHostedCredentialState("openai");
  firstCredential.resolve({ ...credential, source: "missing" });
  await first;

  assert.equal(attempts, 2);
  assert.equal(plugin.hostedAiState.credential, credential);
});

test("an aborted OMD search forwards cancellation and stays silent", async () => {
  const plugin = mainHarness(["searchWithOmd"]);
  const entered = deferred<void>();
  const pending = deferred<void>();
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  plugin.vaultPath = () => "/vault";
  plugin.omdBridge = {
    async search(_vault: string, _query: string, signal?: AbortSignal) {
      receivedSignal = signal;
      entered.resolve();
      await pending.promise;
      signal?.throwIfAborted();
      return [];
    },
  };
  const output = { empty() {}, hidden: false, createDiv() {} };

  const searching = plugin.searchWithOmd("missing note", output, controller.signal);
  await entered.promise;
  controller.abort();
  pending.resolve();
  await searching;

  assert.equal(receivedSignal, controller.signal);
  assert.deepEqual(plugin.notices, []);
});

for (const action of ["checkHostedAiConnection", "saveHostedApiKey", "deleteHostedApiKey"]) {
  for (const staleBy of ["provider", "token", "unload"]) {
    for (const fails of [false, true]) {
      test(`${action} ignores ${fails ? "failure" : "success"} after ${staleBy} changes`, async () => {
        const plugin = mainHarness();
        const pendingBridge = deferred<unknown>();
        const enteredBridge = deferred<void>();
        const bridgeCall = () => { enteredBridge.resolve(); return pendingBridge.promise; };
        plugin.omdBridge = {
          discoverProviderModels: bridgeCall,
          storeHostedApiKey: bridgeCall,
          deleteHostedApiKey: bridgeCall,
        };
        const pending = plugin[action]("typed-key");
        await enteredBridge.promise;
        if (staleBy === "provider") plugin.settings.aiProvider = "anthropic";
        if (staleBy === "token") plugin.localAiActionToken += 1;
        if (staleBy === "unload") plugin.unloaded = true;
        plugin.syncHostedAiState("");
        const state = plugin.hostedAiState;
        const feedback = [...plugin.feedback];
        if (fails) pendingBridge.reject(new Error("Late provider failure"));
        else pendingBridge.resolve(action === "checkHostedAiConnection"
          ? { models: ["late-model"], credential, destinationDomain: "api.openai.com" }
          : credential);
        await pending;
        assert.equal(plugin.hostedAiState, state);
        assert.deepEqual(plugin.feedback, feedback);
        assert.deepEqual(plugin.issues, []);
        assert.deepEqual(plugin.notices, []);
      });
    }
  }

  test(`${action} ignores an aborted bridge result`, async () => {
    const plugin = mainHarness();
    const abort = () => { throw new DOMException("Cancelled", "AbortError"); };
    plugin.omdBridge = { discoverProviderModels: abort, storeHostedApiKey: abort, deleteHostedApiKey: abort };
    await plugin[action]("typed-key");
    assert.equal(plugin.hostedAiState.code, "unchecked");
    assert.equal(plugin.hostedAiState.activeAction, "");
    assert.deepEqual(plugin.issues, []);
    assert.deepEqual(plugin.notices, []);
    assert.equal(plugin.feedback.length, 1, "aborted results must not publish failure feedback");
  });
}

test("credential hydration cannot overwrite a newer save action", async () => {
  const plugin = mainHarness();
  const pendingCredential = deferred<unknown>();
  const entered = deferred<void>();
  plugin.omdBridge = {
    hostedCredentialState: () => { entered.resolve(); return pendingCredential.promise; },
    storeHostedApiKey: async (_provider: string, key: string) => { assert.equal(key, "typed-key"); return credential; },
  };
  const hydration = plugin.ensureHostedCredentialState("openai");
  await entered.promise;
  assert.equal(await plugin.saveHostedApiKey("typed-key"), true);
  const saved = plugin.hostedAiState;
  pendingCredential.resolve({ ...credential, source: "missing" });
  await hydration;
  assert.equal(plugin.hostedAiState, saved);
});

test("provider or model invalidation aborts a live hosted keychain mutation", async () => {
  const plugin = mainHarness(["invalidateLocalAiState", "cancelLocalAiRequests"]);
  plugin.currentLocalAiHost = () => null;
  plugin.syncLocalAiState = () => {};
  plugin.localAiSummaries = new Map();
  const entered = deferred<void>();
  let signal: AbortSignal | undefined;
  plugin.omdBridge = {
    storeHostedApiKey: async (_provider: string, _key: string, receivedSignal: AbortSignal) => {
      signal = receivedSignal;
      entered.resolve();
      await new Promise<void>((_resolve, reject) => receivedSignal.addEventListener(
        "abort",
        () => reject(new DOMException("Cancelled", "AbortError")),
        { once: true },
      ));
      return credential;
    },
  };
  const pending = plugin.saveHostedApiKey("typed-key");
  await entered.promise;
  plugin.invalidateLocalAiState("provider");
  assert.equal(signal?.aborted, true);
  assert.equal(await pending, false);
  assert.equal(plugin.hostedAiState.activeAction, "");
});

test("cancelled hosted credential mutation drains before another setup action starts", async () => {
  const plugin = mainHarness(["invalidateLocalAiState", "cancelLocalAiRequests"]);
  plugin.currentLocalAiHost = () => null;
  plugin.syncLocalAiState = () => {};
  plugin.localAiSummaries = new Map();
  const firstSave = deferred<typeof credential>();
  const saveEntered = deferred<void>();
  let saveCalls = 0;
  let deleteCalls = 0;
  let checkCalls = 0;
  let firstSignal: AbortSignal | undefined;
  plugin.omdBridge = {
    storeHostedApiKey: async (_provider: string, _key: string, signal: AbortSignal) => {
      saveCalls += 1;
      if (saveCalls === 1) {
        firstSignal = signal;
        saveEntered.resolve();
        return await firstSave.promise;
      }
      return credential;
    },
    deleteHostedApiKey: async () => {
      deleteCalls += 1;
      return { ...credential, source: "missing" };
    },
    discoverProviderModels: async () => {
      checkCalls += 1;
      return { models: ["test-model"], credential, destinationDomain: "api.openai.com" };
    },
  };

  const pending = plugin.saveHostedApiKey("first-key");
  await saveEntered.promise;
  plugin.invalidateLocalAiState("answer-model");
  assert.equal(firstSignal?.aborted, true);

  await plugin.deleteHostedApiKey();
  assert.equal(await plugin.saveHostedApiKey("blocked-key"), false);
  assert.equal(await plugin.checkHostedAiConnection(), false);
  assert.equal(saveCalls, 1, "a second save must not enter the Keychain bridge while the cancelled save drains");
  assert.equal(deleteCalls, 0, "delete must not enter the Keychain bridge while the cancelled save drains");
  assert.equal(checkCalls, 0, "Check setup must not read stale credentials while the cancelled save drains");

  firstSave.resolve(credential);
  assert.equal(await pending, false);
  assert.equal(await plugin.saveHostedApiKey("after-drain"), true);
  await plugin.deleteHostedApiKey();
  assert.equal(saveCalls, 2);
  assert.equal(deleteCalls, 1);
  await plugin.checkHostedAiConnection();
  assert.equal(checkCalls, 1, "non-mutation setup resumes after the credential drain finishes");
});

test("hosted setup refreshes Home at action boundaries", () => {
  const plugin = mainHarness();
  let refreshes = 0;
  plugin.refreshHomeViews = () => { refreshes += 1; };
  const token = plugin.beginHostedAiAction("save-key");
  plugin.finishHostedAiAction(token, "openai");
  assert.equal(refreshes, 2);
});

test("hosted credential drain completion refreshes Home exactly once", () => {
  const plugin = mainHarness();
  let refreshes = 0;
  plugin.refreshHomeViews = () => { refreshes += 1; };
  const mutation = plugin.beginHostedCredentialMutation();
  assert.equal(plugin.aiSetupBusy(), true);

  plugin.finishHostedCredentialMutation(mutation);
  assert.equal(plugin.aiSetupBusy(), false);
  assert.equal(refreshes, 1);

  plugin.finishHostedCredentialMutation(mutation);
  assert.equal(refreshes, 1, "a stale owner must not publish another completion refresh");
});

test("starting a hosted credential mutation aborts an active cloud preview before consent or provider execution", async () => {
  const previewEntered = deferred<void>();
  let consentOpened = false;
  let executeCalls = 0;
  const plugin = mainHarness(["askOmd", "previewCloudAnswer", "executeCloudAnswer"], {
    DEFAULT_SETTINGS: { ollamaHost: "http://localhost:11434" },
    cloudAnswerPermissionEnabled: () => true,
    normalizeLocalOllamaHost,
    CloudAnswerConsentModal: class {
      constructor() { consentOpened = true; }
    },
  });
  Object.assign(plugin.settings, {
    aiProvider: "openai",
    aiModel: "o3-mini",
    aiModels: { openai: "o3-mini" },
    hybridRetrievalEnabled: false,
    ollamaHost: "http://localhost:11434",
  });
  plugin.hostedAiState = {
    provider: "openai",
    checkedModel: "o3-mini",
    checkedAnswerCompatibility: "supported",
    checkedAnswerContract: "strict_json_schema",
    code: "ready",
    activeAction: "",
    models: [{ name: "o3-mini" }],
    credential,
    destinationDomain: "api.openai.com",
  };
  plugin.currentLocalAiHost = () => null;
  plugin.qaRetrievalOptions = () => ({ hybridRetrievalEnabled: false });
  plugin.prepareQaRetrieval = async () => ({
    options: { hybridRetrievalEnabled: false },
    warning: null,
    warningModel: null,
  });
  plugin.omdBridge = {
    hostedCredentialState: async () => credential,
    previewAi: async (
      _vault: string,
      _query: string,
      _provider: string,
      _model: string,
      _endpoint: string,
      _retrieval: unknown,
      signal: AbortSignal,
    ) => {
      previewEntered.resolve();
      return await new Promise((_resolve, reject) => signal.addEventListener(
        "abort",
        () => reject(new DOMException("Credential changed", "AbortError")),
        { once: true },
      ));
    },
    executeAi: async () => {
      executeCalls += 1;
      return {};
    },
  };
  plugin.vaultPath = () => "/test-vault";
  const output = { hidden: false, empty() {}, createDiv() { return {}; } };

  const asking = plugin.askOmd("Summarise the note", output);
  await previewEntered.promise;
  plugin.beginHostedCredentialMutation();
  await asking;

  assert.equal(consentOpened, false);
  assert.equal(executeCalls, 0);
  assert.deepEqual(plugin.issues, []);
});

test("cloud provider execution cannot start while a hosted credential mutation is pending", async () => {
  let executeCalls = 0;
  const plugin = mainHarness(["executeCloudAnswer"]);
  plugin.hostedCredentialMutation = Symbol("replacing-key");
  plugin.omdBridge = {
    executeAi: async () => {
      executeCalls += 1;
      return {};
    },
  };
  plugin.vaultPath = () => "/test-vault";

  await assert.rejects(
    plugin.executeCloudAnswer("Question", {
      provider: "openai",
      model: "o3-mini",
      endpoint: "http://localhost:11434",
      preview: { consent_grant: "grant", warnings: [] },
      retrieval: { hybridRetrievalEnabled: false },
      embeddingFallbackModel: null,
    }),
    { name: "AbortError" },
  );
  assert.equal(executeCalls, 0);
});

test("a cloud-consent generation rejects an away-and-back route before any send", () => {
  const plugin = mainHarness([], {
    LocalAiError: class LocalAiError extends Error {
      constructor(_code: string, detail: string) { super(detail); }
    },
  });
  let previewChecks = 0;
  plugin.assertCloudPreviewStillCurrent = () => { previewChecks += 1; };
  const modal = { closed: 0, close() { this.closed += 1; } };
  plugin.cloudAnswerConsentModals.add(modal);
  const generation = plugin.cloudAnswerConsentGeneration;
  plugin.invalidateCloudAnswerConsent(); // provider changed away
  plugin.invalidateCloudAnswerConsent(); // and back to the same route
  assert.equal(modal.closed, 1);
  assert.throws(
    () => plugin.assertCloudConsentStillCurrent({ provider: "openai", model: "gpt-test", endpoint: "http://localhost:11434" }, generation),
    /settings changed after preview/u,
  );
  assert.equal(previewChecks, 0, "stale consent must be rejected before a cloud send can start");
  assert.match(readMethod("src/main.ts", "askOmd"), /assertCloudConsentStillCurrent\(preview, consentGeneration\)[\s\S]*executeCloudAnswer/u);
});

test("shared setup publishes the verified executable and capture probes it before other candidates", async () => {
  const verified = "/Applications/OMD/bin/omd";
  let checks = 0;
  const preferred: Array<string | undefined> = [];
  const plugin = loadMethods("src/main.ts", ["runOmdCapabilityCheck", "resolvedOmdExecutable", "requireCaptureOmdExecutable"], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
      _resolve: unknown,
      preferredExecutable?: string,
    ) => {
      preferred.push(preferredExecutable);
      const executable = preferredExecutable || verified;
      checks += 1;
      await validate(executable);
      return { executable, mode: "automatic" };
    },
    process,
    omdReadyMessage: () => "Ready",
    hasCaptureLanguageOverrides: () => false,
    probeOmdCaptureExecutable: async () => {},
    socialCaptureProvider,
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd", captureOcrLanguage: "unsupported-pack", captureAsrLanguage: "zh" },
    omdCapabilityGeneration: 1,
    usesAutomaticOmdDiscovery: () => true,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireRecognitionCapability: async () => ({ protocol_version: 1 }),
      requireEnrichNote: async () => ({ protocol_version: 1 }),
      requireCaptureLanguages: async () => { assert.fail("Capture recognition cannot block shared setup"); },
    },
  });
  assert.equal(await plugin.runOmdCapabilityCheck(1), true);
  assert.equal(plugin.resolvedOmdExecutable(), verified);
  assert.equal(plugin.enrichmentCapability.resolvedExecutable, verified);
  assert.equal(await plugin.requireCaptureOmdExecutable({}), verified);
  assert.deepEqual(preferred, [undefined, verified]);
  assert.equal(checks, 2);
  assert.equal(plugin.resolvedOmdExecutable(), verified, "capture discovery cannot replace the shared verified path");
});

test("automatic setup falls back to an enrich-only OMD when no recognition-capable candidate exists", async () => {
  const legacy = "/legacy/bin/omd";
  let discoveryCalls = 0;
  const plugin = loadMethods("src/main.ts", ["runOmdCapabilityCheck"], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
    ) => {
      discoveryCalls += 1;
      await validate(legacy);
      return { executable: legacy, mode: "automatic" };
    },
    process,
    omdReadyMessage: () => "Ready",
    isEnrichmentError: () => false,
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd" },
    omdCapabilityGeneration: 1,
    usesAutomaticOmdDiscovery: () => true,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireRecognitionCapability: async () => { throw new Error("Recognition options unavailable"); },
      requireEnrichNote: async () => ({ enrich_note: { supported: true, schema_versions: [1] } }),
    },
  });

  assert.equal(await plugin.runOmdCapabilityCheck(1), true);
  assert.equal(discoveryCalls, 2);
  assert.equal(plugin.enrichmentCapability.resolvedExecutable, legacy);
});

test("custom setup accepts an enrich-only OMD without applying automatic discovery preferences", async () => {
  const custom = "/custom/bin/omd";
  let recognitionProbeCalls = 0;
  const plugin = loadMethods("src/main.ts", ["runOmdCapabilityCheck"], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
    ) => {
      await validate(custom);
      return { executable: custom, mode: "custom" };
    },
    process,
    omdReadyMessage: () => "Ready",
  });
  Object.assign(plugin, {
    settings: { omdExecutable: custom },
    omdCapabilityGeneration: 1,
    usesAutomaticOmdDiscovery: () => false,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireRecognitionCapability: async () => {
        recognitionProbeCalls += 1;
        throw new Error("Recognition options unavailable");
      },
      requireEnrichNote: async () => ({ enrich_note: { supported: true, schema_versions: [1] } }),
    },
  });

  assert.equal(await plugin.runOmdCapabilityCheck(1), true);
  assert.equal(recognitionProbeCalls, 0);
  assert.equal(plugin.enrichmentCapability.resolvedExecutable, custom);
});

test("capture retry keeps the last verified OMD ahead of a capture-compatible legacy PATH binary", async () => {
  const legacy = "/legacy/bin/omd";
  const verified = "/Applications/OMD/bin/omd";
  const retryEntered = deferred<void>();
  const releaseRetry = deferred<void>();
  const preferred: Array<string | undefined> = [];
  const captureProbes: string[] = [];
  let discovery = 0;
  const plugin = loadMethods("src/main.ts", [
    "runOmdCapabilityCheck",
    "resetEnrichmentCapability",
    "requireCaptureOmdExecutable",
  ], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
      _resolve: unknown,
      preferredExecutable?: string,
    ) => {
      discovery += 1;
      preferred.push(preferredExecutable);
      if (discovery === 2) {
        retryEntered.resolve();
        await releaseRetry.promise;
      }
      const candidates = [...new Set([preferredExecutable, legacy, verified].filter(Boolean) as string[])];
      let failure: unknown;
      for (const candidate of candidates) {
        try {
          await validate(candidate);
          return { executable: candidate, mode: "automatic" };
        } catch (error) {
          failure = error;
        }
      }
      throw failure;
    },
    process,
    omdReadyMessage: () => "Ready",
    hasCaptureLanguageOverrides: () => false,
    probeOmdCaptureExecutable: async (executable: string) => { captureProbes.push(executable); },
    socialCaptureProvider,
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd" },
    omdCapabilityGeneration: 1,
    omdCapabilityCheck: null,
    discoveredOmdExecutable: "",
    lastVerifiedOmdExecutable: "",
    usesAutomaticOmdDiscovery: () => true,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireRecognitionCapability: async (executable: string) => {
        if (executable === legacy) throw new Error("Legacy OMD has no enrich-note capability");
        return { protocol_version: 1 };
      },
      requireEnrichNote: async (executable: string) => {
        if (executable === legacy) throw new Error("Legacy OMD has no enrich-note capability");
        return { protocol_version: 1 };
      },
      requireCaptureLanguages: async () => {},
      cancelActive() {},
      clear() {},
    },
  });

  assert.equal(await plugin.runOmdCapabilityCheck(1), true);
  plugin.resetEnrichmentCapability(true);
  assert.equal(plugin.discoveredOmdExecutable, "");
  assert.equal(plugin.lastVerifiedOmdExecutable, verified);

  const retry = plugin.requireCaptureOmdExecutable({});
  await retryEntered.promise;
  assert.equal(preferred[1], verified);
  releaseRetry.resolve();
  assert.equal(await retry, verified);
  assert.deepEqual(captureProbes, [verified], "retry must not accept the legacy PATH binary before the verified hint");
  plugin.resetEnrichmentCapability();
  assert.equal(plugin.lastVerifiedOmdExecutable, "", "an explicit executable-setting reset must discard the old hint");
});

test("cold-start capture shares pending automatic setup discovery before probing PATH", async () => {
  const legacy = "/legacy/bin/omd";
  const verified = "/Applications/OMD/bin/omd";
  const setupEntered = deferred<void>();
  const releaseSetup = deferred<void>();
  const preferred: Array<string | undefined> = [];
  const captureProbes: string[] = [];
  let discovery = 0;
  const plugin = loadMethods("src/main.ts", [
    "checkEnrichmentCapability",
    "runOmdCapabilityCheck",
    "requireCaptureOmdExecutable",
  ], {
    discoverOmdExecutable: async (
      _saved: string,
      _options: unknown,
      validate: (path: string) => Promise<unknown>,
      _resolve: unknown,
      preferredExecutable?: string,
    ) => {
      discovery += 1;
      preferred.push(preferredExecutable);
      if (discovery === 1) {
        setupEntered.resolve();
        await releaseSetup.promise;
      }
      const candidates = [...new Set([preferredExecutable, legacy, verified].filter(Boolean) as string[])];
      let failure: unknown;
      for (const candidate of candidates) {
        try {
          await validate(candidate);
          return { executable: candidate, mode: "automatic" };
        } catch (error) {
          failure = error;
        }
      }
      throw failure;
    },
    process,
    omdReadyMessage: () => "Ready",
    isEnrichmentError: () => false,
    hasCaptureLanguageOverrides: () => false,
    probeOmdCaptureExecutable: async (executable: string) => { captureProbes.push(executable); },
    socialCaptureProvider,
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd" },
    omdCapabilityGeneration: 0,
    omdCapabilityCheck: null,
    discoveredOmdExecutable: "",
    lastVerifiedOmdExecutable: "",
    enrichmentCapability: { status: "unchecked", message: "Unchecked" },
    usesAutomaticOmdDiscovery: () => true,
    refreshHomeViews() {},
    omdCapabilityService: {
      requireRecognitionCapability: async (executable: string) => {
        if (executable === legacy) throw new Error("Legacy OMD has no enrich-note capability");
        return { protocol_version: 1 };
      },
      requireEnrichNote: async (executable: string) => {
        if (executable === legacy) throw new Error("Legacy OMD has no enrich-note capability");
        return { protocol_version: 1 };
      },
      requireCaptureLanguages: async () => {},
      cancelActive() {},
      clear() {},
    },
  });

  const setup = plugin.checkEnrichmentCapability();
  await setupEntered.promise;
  const capture = plugin.requireCaptureOmdExecutable({});
  await Promise.resolve();
  assert.equal(discovery, 1, "capture should not launch competing discovery while setup is pending");
  assert.deepEqual(captureProbes, []);

  releaseSetup.resolve();
  assert.equal(await setup, true);
  assert.equal(await capture, verified);
  assert.deepEqual(preferred, ["", verified]);
  assert.deepEqual(captureProbes, [verified], "cold-start capture must not accept the legacy PATH binary");
});

test("cancelled capture stops waiting without cancelling shared automatic discovery", async () => {
  const sharedDiscovery = deferred<boolean>();
  let captureDiscoveryCalls = 0;
  const plugin = loadMethods("src/main.ts", ["requireCaptureOmdExecutable"], {
    discoverOmdExecutable: async () => {
      captureDiscoveryCalls += 1;
      return { executable: "/Applications/OMD/bin/omd", mode: "automatic" };
    },
    process,
    socialCaptureProvider,
  });
  Object.assign(plugin, {
    settings: { omdExecutable: "omd" },
    omdCapabilityCheck: sharedDiscovery.promise,
    discoveredOmdExecutable: "",
    lastVerifiedOmdExecutable: "",
    usesAutomaticOmdDiscovery: () => true,
  });

  const controller = new AbortController();
  const capture = plugin.requireCaptureOmdExecutable({}, controller.signal);
  const observed = capture.then(
    (value: string) => ({ value, error: null as unknown }),
    (error: unknown) => ({ value: "", error }),
  );
  let captureSettled = false;
  void observed.then(() => { captureSettled = true; });

  controller.abort();
  await new Promise<void>((resolveTick) => setImmediate(resolveTick));
  assert.equal(captureSettled, true, "the caller should not wait for shared discovery after cancellation");
  const result = await observed;
  assert.equal(result.value, "");
  assert.equal((result.error as Error).name, "AbortError");
  assert.equal(captureDiscoveryCalls, 0);

  sharedDiscovery.resolve(true);
  assert.equal(await sharedDiscovery.promise, true, "caller cancellation must not cancel shared discovery");
});

test("AI setup actions refuse to overlap across local and hosted controls", () => {
  const notices: string[] = [];
  const plugin = loadMethods("src/main.ts", ["aiSetupBusy", "canStartAiSetupAction"], {
    Notice: class { constructor(value: string) { notices.push(value); } },
  });
  plugin.localAiState = { activeAction: "" };
  plugin.hostedAiState = null;
  assert.equal(plugin.canStartAiSetupAction(), true);

  plugin.localAiState.activeAction = "check-connection";
  assert.equal(plugin.canStartAiSetupAction(), false);
  plugin.localAiState.activeAction = "";
  plugin.hostedAiState = { activeAction: "save-key" };
  assert.equal(plugin.canStartAiSetupAction(false), false);
  assert.equal(notices.length, 1);

  plugin.hostedAiState = null;
  plugin.hostedCredentialMutation = Symbol("draining-keychain-child");
  assert.equal(plugin.aiSetupBusy(), true);
  assert.equal(plugin.canStartAiSetupAction(false), false);

  for (const method of [
    "checkHostedAiConnection",
    "checkOllamaCloudConnection",
    "saveHostedApiKey",
    "deleteHostedApiKey",
    "refreshLocalAiCatalog",
    "checkLocalAiConnection",
    "smokeLocalAiWorkflow",
    "testLocalEmbeddings",
  ]) {
    assert.match(readMethod("src/main.ts", method), /canStartAiSetupAction/u, method);
  }
});

test("Ollama Cloud setup canonicalizes a saved alias to the catalog model", async () => {
  const host = "http://localhost:11434";
  const catalogModel = buildModelEntry({
    name: "cloud-alias:latest",
    capabilities: ["completion"],
    remoteModel: "gpt-oss:20b",
    remoteHost: "https://ollama.com",
  });
  const plugin = mainHarness(["checkOllamaCloudConnection"], {
    buildConnectionSummary,
    buildModelEntry,
    localModelNamesMatch,
    mergeInspectedModelEntry,
    modelIsVerifiedOllamaCloud,
    normalizeLocalOllamaHost,
  });
  Object.assign(plugin, {
    settings: {
      aiProvider: "ollama-cloud",
      aiModel: "cloud-alias",
      aiModels: { "ollama-cloud": "cloud-alias" },
      ollamaHost: host,
    },
    localAiSummaries: new Map(),
    localAiFailure: null,
    localAiActionToken: 1,
    canStartAiSetupAction: () => true,
    beginLocalAiAction: () => 1,
    finishLocalAiAction() {},
    syncLocalAiState() {},
    ollamaLocalClient: {
      version: async () => ({ version: "0.33.3" }),
      status: async () => ({ cloud: { disabled: false } }),
      tags: async () => [catalogModel],
      show: async (_receivedHost: string, receivedModel: string) => {
        assert.equal(receivedModel, "cloud-alias");
        return {
          name: receivedModel,
          capabilities: ["completion"],
          remoteModel: "gpt-oss:20b",
          remoteHost: "https://ollama.com",
        };
      },
    },
  });

  assert.equal(await plugin.checkOllamaCloudConnection(), true);
  const models = plugin.localAiSummaries.get(host).models;
  assert.deepEqual(models.map((model: LocalAiModelInfo) => model.name), ["cloud-alias:latest"]);
  assert.equal(models[0].remoteModel, "gpt-oss:20b");
});

test("Ollama Cloud setup publishes a fresh catalog when the saved model was removed", async () => {
  const host = "http://localhost:11434";
  const replacement = buildModelEntry({
    name: "cloud-b:latest",
    capabilities: ["completion"],
    remoteModel: "gpt-oss:120b",
    remoteHost: "https://ollama.com",
  });
  const plugin = mainHarness(["checkOllamaCloudConnection"], {
    buildConnectionSummary,
    buildModelEntry,
    localModelNamesMatch,
    mergeInspectedModelEntry,
    modelIsVerifiedOllamaCloud,
    normalizeLocalOllamaHost,
  });
  Object.assign(plugin, {
    settings: {
      aiProvider: "ollama-cloud",
      aiModel: "cloud-a:latest",
      aiModels: { "ollama-cloud": "cloud-a:latest" },
      ollamaHost: host,
    },
    localAiSummaries: new Map(),
    localAiFailure: null,
    localAiActionToken: 1,
    localAiState: { activeAction: "check-connection" },
    canStartAiSetupAction: () => true,
    beginLocalAiAction: () => 1,
    finishLocalAiAction() {},
    syncLocalAiState() {},
    setLocalAiFailure() {},
    ollamaLocalClient: {
      version: async () => ({ version: "0.33.3" }),
      status: async () => ({ cloud: { disabled: false } }),
      tags: async () => [replacement],
      show: async () => {
        throw new LocalAiError("selected_model_missing", "cloud-a:latest is no longer installed.");
      },
    },
  });

  assert.equal(await plugin.checkOllamaCloudConnection(), false);
  assert.deepEqual(
    plugin.localAiSummaries.get(host).models.map((model: LocalAiModelInfo) => model.name),
    ["cloud-b:latest"],
  );
  assert.match(plugin.feedback.at(-1) ?? "", /cloud-a:latest is no longer installed/u);
});

for (const failure of ["no-cloud-model", "incompatible-cloud-model", "cloud-model-inspection-unavailable"] as const) {
  test(`Ollama Cloud ${failure} feedback does not overwrite healthy local daemon readiness`, async () => {
    const host = "http://localhost:11434";
    const healthy = buildConnectionSummary({
      host,
      checkedAt: 1,
      version: "0.33.3",
      daemonCode: "ready",
      daemonDetail: "Ollama is reachable.",
      models: [buildModelEntry({ name: "qwen3:4b", capabilities: ["completion"] })],
      modelChecks: {},
    });
    const verifiedCloudModel = buildModelEntry({
      name: "gpt-oss:20b-cloud",
      capabilities: ["completion"],
      remoteModel: "gpt-oss:20b",
      remoteHost: "https://ollama.com",
    });
    const plugin = mainHarness(["checkOllamaCloudConnection"], {
      buildConnectionSummary,
      buildModelEntry,
      localModelNamesMatch,
      mergeInspectedModelEntry,
      modelIsVerifiedOllamaCloud,
      normalizeLocalOllamaHost,
    });
    Object.assign(plugin, {
      settings: {
        aiProvider: "ollama-cloud",
        aiModel: failure === "no-cloud-model"
          ? ""
          : failure === "cloud-model-inspection-unavailable" ? "gpt-oss:20b-cloud" : "local-not-cloud:latest",
        aiModels: {
          "ollama-cloud": failure === "no-cloud-model"
            ? ""
            : failure === "cloud-model-inspection-unavailable" ? "gpt-oss:20b-cloud" : "local-not-cloud:latest",
        },
        ollamaHost: host,
      },
      localAiSummaries: new Map([[host, healthy]]),
      localAiFailure: null,
      canStartAiSetupAction: () => true,
      beginLocalAiAction: () => 1,
      finishLocalAiAction() {},
      syncLocalAiState() {},
      ollamaLocalClient: {
        version: async () => ({ version: "0.33.3" }),
        status: async () => ({ cloud: { disabled: false } }),
        tags: async () => failure === "no-cloud-model" ? [] : [verifiedCloudModel],
        show: async () => {
          if (failure === "cloud-model-inspection-unavailable") {
            throw new LocalAiError("model_unavailable", "The selected Ollama Cloud model could not be inspected.");
          }
          return {
            name: "local-not-cloud:latest",
            capabilities: ["completion"],
          };
        },
      },
    });
    let localFailureWrites = 0;
    plugin.setLocalAiFailure = () => { localFailureWrites += 1; };

    assert.equal(await plugin.checkOllamaCloudConnection(), false);
    assert.equal(localFailureWrites, 0);
    assert.equal(plugin.localAiSummaries.get(host), healthy);
    assert.equal(plugin.localAiFailure, null);
    assert.match(plugin.feedback.at(-1) ?? "", /Ollama Cloud setup failed/u);
    assert.equal(plugin.issues.length, 1);
  });
}

test("a deferred AI setup operation rejects a second public setup action", async () => {
  const plugin = mainHarness();
  const pendingSave = deferred<typeof credential>();
  const saveEntered = deferred<void>();
  let deleteCalls = 0;
  plugin.omdBridge = {
    storeHostedApiKey: async () => {
      saveEntered.resolve();
      return await pendingSave.promise;
    },
    deleteHostedApiKey: async () => {
      deleteCalls += 1;
      return { ...credential, source: "missing" };
    },
  };

  const saving = plugin.saveHostedApiKey("typed-key");
  await saveEntered.promise;
  assert.equal(plugin.hostedAiState.activeAction, "save-key");
  await plugin.deleteHostedApiKey();
  assert.equal(deleteCalls, 0, "the second action must not enter its bridge boundary");
  assert.match(plugin.notices.at(-1) ?? "", /Another AI setup action is already running/u);

  pendingSave.resolve(credential);
  assert.equal(await saving, true);
  assert.equal(plugin.hostedAiState.activeAction, "");
});

test("password input forwards the typed API key to Keychain and clears only confirmed saves", async () => {
  const inputs: Harness[] = [];
  const buttons: Harness[] = [];
  class TextComponent {
    inputEl = { type: "text", autocomplete: "" };
    value = "";
    change!: (value: string) => void;
    constructor() { inputs.push(this); }
    setValue(value: string) { this.value = value; return this; }
    setPlaceholder() { return this; }
    setDisabled() { return this; }
    onChange(change: (value: string) => void) { this.change = change; return this; }
  }
  class Setting {
    controlEl = {};
    settingEl = { addClass() {} };
    setName() { return this; }
    setDesc() { return this; }
    addButton(callback: (button: Harness) => void) {
      const button: Harness = {
        setButtonText() { return button; },
        setDisabled() { return button; },
        onClick(click: () => Promise<void>) { button.click = click; return button; },
      };
      buttons.push(button);
      callback(button);
      return this;
    }
  }
  const tab = loadMethods("src/settings.ts", ["hostedCredentialSetting", "runAiSetupAction"], {
    Platform: { isMacOS: true }, Setting, TextComponent, aiProviderEnvVar,
  });
  tab.hostedCredentialDrafts = new Map();
  const container = { isConnected: true };
  tab.rerenderLocalAiSection = () => tab.hostedCredentialSetting(container, "openai");
  const saved: string[] = [];
  let confirmed = false;
  let setupChecks = 0;
  tab.plugin = {
    aiSetupBusy: () => false,
    hostedAiState: null,
    localAiState: { activeAction: "" },
    saveHostedApiKey: async (value: string) => { saved.push(value); return confirmed; },
    checkHostedAiConnection: async () => { setupChecks += 1; return true; },
    settings: {},
  };
  tab.hostedCredentialSetting(container, "openai");
  assert.equal(inputs[0].inputEl.type, "password");
  inputs[0].setValue("sk-actual-typed-secret").change("sk-actual-typed-secret");
  await buttons[0].click();
  assert.equal(inputs.at(-1)?.value, "sk-actual-typed-secret");
  assert.equal(setupChecks, 0);
  confirmed = true;
  await buttons[0].click();
  assert.deepEqual(saved, ["sk-actual-typed-secret", "sk-actual-typed-secret"]);
  assert.equal(setupChecks, 1);
  assert.equal(inputs.at(-1)?.value, "");
  assert.deepEqual(tab.plugin.settings, {});
});

test("unload closes cloud consent and blocks even an approval queued just before unload", async () => {
  const decision = deferred<boolean>();
  const opened = deferred<void>();
  let closed = 0;
  let formattingClosed = 0;
  let calendarClosed = 0;
  let calendarCleanup = 0;
  const calendarGuards = new WeakMap<object, () => boolean>();
  const plugin = mainHarness(["askOmd", "trackCalendarModal", "onunload"], {
    cloudAnswerPermissionEnabled: () => true,
    setCalendarModalActionGuard: (modal: object, guard: () => boolean) => calendarGuards.set(modal, guard),
    CloudAnswerConsentModal: class {
      openAndWait() { opened.resolve(); return decision.promise; }
      close() { closed += 1; decision.resolve(false); }
    },
  });
  Object.assign(plugin, {
    cloudAnswerConsentModals: new Set(),
    markdownFormattingModals: new Set([{ close() { formattingClosed += 1; } }]),
    calendarModals: new Set(),
    calendarRefreshTimer: null,
    calendarWriteOverrides: new Map(),
    localAiSummaries: new Map(),
    omdCapabilityService: { dispose() {} },
    omdEnrichmentRunner: { dispose() {} },
    qaRetrievalOptions: () => ({}),
    previewCloudAnswer: async () => ({
      provider: "openai",
      retrieval: {},
      preview: {
        preview: {},
        evidence: [{ path: "Note.md", title: "Note", evidence: "Approved excerpt", score: 1 }],
      },
    }),
    executeCloudAnswer: async () => { assert.fail("No evidence may be sent after unload"); },
    assertCloudPreviewStillCurrent: () => {},
  });
  const normallyClosed = {
    onClose() { calendarCleanup += 1; },
    close() { this.onClose(); },
  };
  plugin.trackCalendarModal(normallyClosed);
  normallyClosed.close();
  assert.equal(plugin.calendarModals.size, 0, "normal close unregisters without replacing subclass cleanup");
  assert.equal(calendarCleanup, 1);
  const unloadClosed = {
    onClose() { calendarCleanup += 1; },
    close() { calendarClosed += 1; this.onClose(); },
  };
  plugin.trackCalendarModal(unloadClosed);
  assert.equal(plugin.calendarModals.size, 1);
  const output = { hidden: false, empty() {}, createDiv() {} };
  const answer = plugin.askOmd("Question", output);
  await opened.promise;
  assert.equal(plugin.cloudAnswerConsentModals.size, 1);
  decision.resolve(true);
  plugin.onunload();
  await answer;
  assert.equal(closed, 1);
  assert.equal(formattingClosed, 1);
  assert.equal(calendarClosed, 1);
  assert.equal(calendarCleanup, 2);
  assert.equal(calendarGuards.get(unloadClosed)?.(), false, "tracked actions remain blocked after unload");
  assert.equal(plugin.calendarModals.size, 0);
  assert.equal(plugin.markdownFormattingModals.size, 0);
  assert.equal(plugin.cloudAnswerConsentModals.size, 0);
  assert.deepEqual(plugin.issues, []);
});

test("unload aborts a pending cloud preview before consent or evidence send", async () => {
  const previewEntered = deferred<void>();
  let previewSignal: AbortSignal | undefined;
  let consentOpened = false;
  let executeCalls = 0;
  let bridgeDisposed = 0;
  const plugin = mainHarness(["askOmd", "previewCloudAnswer", "executeCloudAnswer", "onunload"], {
    DEFAULT_SETTINGS: { ollamaHost: "http://localhost:11434" },
    cloudAnswerPermissionEnabled: () => true,
    normalizeLocalOllamaHost,
    CloudAnswerConsentModal: class {
      constructor() { consentOpened = true; }
    },
  });
  Object.assign(plugin.settings, {
    aiProvider: "openai",
    aiModel: "o3-mini",
    aiModels: { openai: "o3-mini" },
    hybridRetrievalEnabled: false,
    ollamaHost: "http://localhost:11434",
  });
  plugin.hostedAiState = {
    provider: "openai",
    checkedModel: "o3-mini",
    checkedAnswerCompatibility: "supported",
    checkedAnswerContract: "strict_json_schema",
    code: "ready",
    activeAction: "",
    models: [{ name: "o3-mini" }],
    credential,
    destinationDomain: "api.openai.com",
  };
  Object.assign(plugin, {
    markdownFormattingModals: new Set(),
    calendarRefreshTimer: null,
    calendarWriteOverrides: new Map(),
    localAiSummaries: new Map(),
    omdCapabilityService: { dispose() {} },
    omdEnrichmentRunner: { dispose() {} },
    currentLocalAiHost: () => null,
    qaRetrievalOptions: () => ({ hybridRetrievalEnabled: false }),
    prepareQaRetrieval: async () => ({
      options: { hybridRetrievalEnabled: false },
      warning: null,
      warningModel: null,
    }),
    vaultPath: () => "/test-vault",
    omdBridge: {
      hostedCredentialState: async () => credential,
      previewAi: async (
        _vault: string,
        _query: string,
        _provider: string,
        _model: string,
        _endpoint: string,
        _retrieval: unknown,
        signal: AbortSignal,
      ) => {
        previewSignal = signal;
        previewEntered.resolve();
        return await new Promise((_resolve, reject) => signal.addEventListener(
          "abort",
          () => reject(new DOMException("Plugin unloaded", "AbortError")),
          { once: true },
        ));
      },
      executeAi: async () => {
        executeCalls += 1;
        return {};
      },
      dispose: () => { bridgeDisposed += 1; },
    },
  });
  const output = { hidden: false, empty() {}, createDiv() { return {}; } };

  const asking = plugin.askOmd("Summarise the note", output);
  await previewEntered.promise;
  assert.equal(plugin.cloudAnswerControllers.size, 1);
  plugin.onunload();
  await asking;

  assert.equal(previewSignal?.aborted, true);
  assert.equal(consentOpened, false);
  assert.equal(executeCalls, 0);
  assert.equal(plugin.cloudAnswerControllers.size, 0);
  assert.equal(plugin.localAiControllers.size, 0);
  assert.equal(plugin.cloudAnswerConsentModals.size, 0);
  assert.equal(bridgeDisposed, 1);
  assert.deepEqual(plugin.issues, []);
});

test("recognition-default changes do not cancel a running local Ask", async () => {
  const previewEntered = deferred<void>();
  const releasePreview = deferred<void>();
  let previewSignal: AbortSignal | undefined;
  let renderedAnswer: unknown;
  const plugin = mainHarness(["askOmd"]);
  Object.assign(plugin.settings, {
    aiProvider: "ollama",
    aiModel: "qwen3:4b-instruct",
    hybridRetrievalEnabled: false,
    captureOcrLanguage: "eng",
    captureAsrLanguage: "en",
  });
  Object.assign(plugin, {
    requireReadyOmdExecutable: async () => "/legacy/bin/omd",
    previewLocalAnswer: async (_query: string, parentSignal?: AbortSignal) => await plugin.withLocalAiSignal(
      async (signal: AbortSignal) => {
        previewSignal = signal;
        previewEntered.resolve();
        await releasePreview.promise;
        signal.throwIfAborted();
        return {
          preview: {
            evidence: [{ path: "Note.md", title: "Note", evidence: "Local fact", score: 1 }],
            warnings: [],
          },
          retrieval: { hybridRetrievalEnabled: false },
          embeddingFallbackModel: null,
        };
      },
      parentSignal,
    ),
    executeLocalAnswer: async () => ({ answer_markdown: "Source states:\n- Local fact. [[Note.md]]\n\nModel inference:\n- None." }),
    renderAiAnswer: (_output: unknown, answer: unknown) => { renderedAnswer = answer; },
  });
  const output = { hidden: false, empty() {}, createDiv() { return {}; } };

  const asking = plugin.askOmd("What does the note say?", output);
  await previewEntered.promise;
  plugin.settings.captureOcrLanguage = "chi_sim+eng";
  plugin.settings.captureAsrLanguage = "auto-detect";
  assert.equal(previewSignal?.aborted, false);
  releasePreview.resolve();
  await asking;

  assert.deepEqual(renderedAnswer, {
    answer_markdown: "Source states:\n- Local fact. [[Note.md]]\n\nModel inference:\n- None.",
  });
  assert.equal(plugin.localAiControllers.size, 0);
  assert.deepEqual(plugin.issues, []);
});

test("local Q&A remains available when the selected OMD has no recognition override", async () => {
  let rendered = false;
  const plugin = mainHarness(["askOmd"]);
  Object.assign(plugin.settings, {
    aiProvider: "ollama",
    aiModel: "qwen3:4b-instruct",
    hybridRetrievalEnabled: false,
    captureOcrLanguage: "chi_sim+eng",
    captureAsrLanguage: "zh",
  });
  Object.assign(plugin, {
    requireReadyOmdExecutable: async () => "/legacy/bin/omd",
    requireCaptureOmdExecutable: async () => assert.fail("Q&A must not require recognition capability"),
    previewLocalAnswer: async () => ({
      preview: {
        evidence: [{ path: "Legacy.md", title: "Legacy", evidence: "Supported Q&A", score: 1 }],
        warnings: [],
      },
      retrieval: { hybridRetrievalEnabled: false },
      embeddingFallbackModel: null,
    }),
    executeLocalAnswer: async () => ({ answer_markdown: "Source states:\n- Supported Q&A. [[Legacy.md]]\n\nModel inference:\n- None." }),
    renderAiAnswer: () => { rendered = true; },
  });
  const output = { hidden: false, empty() {}, createDiv() { return {}; } };

  await plugin.askOmd("Can legacy OMD answer?", output);

  assert.equal(rendered, true);
  assert.deepEqual(plugin.issues, []);
});

test("unloaded lifecycle refuses new local-AI signal work", async () => {
  const plugin = mainHarness();
  plugin.unloaded = true;
  await assert.rejects(plugin.withLocalAiSignal(async () => assert.fail("Work cannot start after unload")), { name: "AbortError" });
});

test("an obsolete local Ask preserves its abort through the safety gate without publishing stale AI state", async () => {
  const notices: string[] = [];
  const statusEntered = deferred<void>();
  const status = deferred<never>();
  const priorSummary = { host: "http://localhost:11434", daemonCode: "ready" };
  const priorFailure = { host: "http://localhost:11434", daemonCode: "daemon_unreachable" };
  const plugin = loadMethods("src/main.ts", [
    "askOmd",
    "runLocalAiGated",
    "withLocalAiSignal",
    "runLocalAiSafetyGate",
  ], {
    Notice: class { constructor(value: string) { notices.push(value); } },
    selectedAiModel: () => "local-model",
    executeWithLocalAiGate: async (
      snapshot: unknown,
      _getCurrentSnapshot: unknown,
      gate: (snapshot: unknown, signal?: AbortSignal) => Promise<void>,
      downstream: (snapshot: unknown, signal?: AbortSignal) => Promise<unknown>,
      signal: AbortSignal,
    ) => {
      await gate(snapshot, signal);
      return await downstream(snapshot, signal);
    },
  });
  Object.assign(plugin, {
    unloaded: false,
    settings: { aiProvider: "ollama", hybridRetrievalEnabled: false },
    localAiControllers: new Set<AbortController>(),
    localAiState: { activeAction: "" },
    localAiSummaries: new Map([["http://localhost:11434", priorSummary]]),
    localAiFailure: priorFailure,
    ollamaLocalClient: {
      status: async () => {
        statusEntered.resolve();
        return await status.promise;
      },
      tags: async () => assert.fail("Cancellation must stop before model-state updates"),
    },
    requireReadyOmdExecutable: async () => "/Applications/OMD/bin/omd",
    qaRetrievalOptions: () => ({}),
    previewLocalAnswer: async (_query: string, signal: AbortSignal) => ({
      preview: await plugin.runLocalAiGated(
        { enabled: true, host: "http://localhost:11434", model: "local-model" },
        () => ({ enabled: true, host: "http://localhost:11434", model: "local-model" }),
        async () => assert.fail("Cancellation must stop before the local Ask downstream request"),
        signal,
      ),
      retrieval: {},
    }),
    clearIssue() { assert.fail("An obsolete Ask must not clear global AI state"); },
    renderAiAnswer() { assert.fail("An obsolete Ask must not render a result"); },
    reportLocalAiWorkflowIssue() { assert.fail("An obsolete Ask must not report a global AI issue"); },
    syncLocalAiState() { assert.fail("An obsolete Ask must not refresh local AI readiness"); },
  });
  const output = { hidden: true, empty() {}, createDiv() {} };
  const controller = new AbortController();
  const asking = plugin.askOmd("obsolete question", output, controller.signal);
  await statusEntered.promise;
  const aborted = new DOMException("Cancelled", "AbortError");
  controller.abort();
  status.reject(aborted);
  await asking;

  assert.equal(plugin.localAiSummaries.get("http://localhost:11434"), priorSummary);
  assert.equal(plugin.localAiFailure, priorFailure);
  assert.deepEqual(notices, []);
});
