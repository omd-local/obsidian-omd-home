import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import * as calendarSync from "../src/calendar-sync.ts";
import * as calendarUi from "../src/calendar-ui.ts";

class ContentStub {
  controls = [{ disabled: false }, { disabled: true }];
  attributes = new Map<string, string>();
  querySelectorAll() { return this.controls; }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  empty() {}
}

const notices: string[] = [];
class ModalStub {
  contentEl = new ContentStub();
  closed = false;
  opened = false;
  open() { this.opened = true; }
  close() { this.closed = true; this.onClose(); }
  onClose() {}
}

const source = readFileSync(new URL("../src/calendar-view.ts", import.meta.url), "utf8");
const compiled = transformSync(`${source}\nexport { EventEditorModal, EventConflictModal, SyncRequiredModal, RecreateCalendarConfirmationModal, DeleteEventNoteConfirmationModal, DeleteCalendarEventConfirmationModal };`, {
  loader: "ts", format: "cjs", target: "es2022",
}).code;
const module = { exports: {} };
Function("require", "module", "exports", compiled)((id: string) => {
  if (id === "obsidian") return {
    ItemView: class { app = {}; }, Modal: ModalStub, Setting: class {},
    Notice: class { constructor(message: string) { notices.push(message); } },
  };
  if (id === "./calendar-sync") return calendarSync;
  if (id === "./calendar-ui") return calendarUi;
  if (id.startsWith("fullcalendar")) return { Calendar: class {} };
  throw new Error(`Unexpected dependency ${id}`);
}, module, module.exports);

interface EditorStub extends ModalStub {
  saveDraft(): Promise<void>;
  runDetachAction(confirmation: string, missingMessage: string): Promise<void>;
  recreateCalendarCopy(): Promise<void>;
  retryCalendarSync(): Promise<void>;
}
interface ConflictStub extends ModalStub { resolve(choice: "vault" | "external"): Promise<void>; }
interface RecreateConfirmationStub extends ModalStub {
  confirm(): Promise<void>;
  targetCalendar: { id: string; title: string; selectedCalendarIds: readonly string[] };
}
interface DeleteConfirmationStub extends ModalStub { confirm(): Promise<void>; }
interface CalendarViewStub {
  syncButton: { disabled: boolean; setText(value: string): void };
  syncEvents(): Promise<void>;
  onOpen(): Promise<void>;
  onClose(): Promise<void>;
  openTrackedModal(modal: ModalStub): void;
  render(): void;
}
const classes = module.exports as {
  EventEditorModal: new (...args: unknown[]) => EditorStub;
  EventConflictModal: new (...args: unknown[]) => ConflictStub;
  RecreateCalendarConfirmationModal: new (...args: unknown[]) => RecreateConfirmationStub;
  DeleteEventNoteConfirmationModal: new (...args: unknown[]) => DeleteConfirmationStub;
  DeleteCalendarEventConfirmationModal: new (...args: unknown[]) => DeleteConfirmationStub;
  OmdCalendarView: new (...args: unknown[]) => CalendarViewStub;
  setCalendarModalActionGuard(modal: ModalStub, guard: () => boolean): void;
};
const event = {
  id: "test-event", title: "A long English title / 中文会议 / اجتماع المراجعة", source: "vault",
  start: "2026-09-16T10:00:00Z", end: "2026-09-16T11:00:00Z", allDay: false, syncState: "clean",
};

test("event editor accepts only one Save while its callback is pending", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  const modal = new classes.EventEditorModal({}, event, null, async () => { writes++; await pending; }, {});
  const first = modal.saveDraft();
  const second = modal.saveDraft();
  const writesWhilePending = writes;
  const disabledWhilePending = modal.contentEl.controls[0].disabled;
  release();
  await Promise.all([first, second]);
  assert.equal(writesWhilePending, 1);
  assert.equal(disabledWhilePending, true);
  assert.equal(modal.closed, true);
  assert.equal(modal.contentEl.controls[0].disabled, false);
  assert.equal(modal.contentEl.controls[1].disabled, true, "read-only fields must remain disabled");
});

test("failed event save restores controls and permits a deliberate retry", async () => {
  notices.length = 0;
  let writes = 0;
  const modal = new classes.EventEditorModal({}, event, null, async () => {
    if (++writes === 1) throw new Error("Calendar is unavailable");
  }, {});
  await modal.saveDraft();
  assert.equal(modal.closed, false);
  assert.equal(modal.contentEl.controls[0].disabled, false);
  assert.deepEqual(notices, ["Calendar is unavailable"]);
  await modal.saveDraft();
  assert.equal(writes, 2);
  assert.equal(modal.closed, true);
});

test("conflicting Calendar resolution choices cannot both run", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const choices: string[] = [];
  const modal = new classes.EventConflictModal({}, event, async (choice: string) => { choices.push(choice); await pending; });
  const first = modal.resolve("vault");
  const second = modal.resolve("external");
  release();
  await Promise.all([first, second]);
  assert.deepEqual(choices, ["vault"]);
});

test("saving prevents a competing detach from changing the same event", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let detaches = 0;
  const modal = new classes.EventEditorModal({}, event, null, async () => pending, {
    detachCalendarEvent: async () => { detaches++; },
  });
  const first = modal.saveDraft();
  await modal.runDetachAction(calendarSync.CALENDAR_DETACH_CONFIRMATION, "Unavailable");
  release();
  await first;
  assert.equal(detaches, 0);
});

test("Recreate opens a separate confirmation and Cancel performs no write", async () => {
  notices.length = 0;
  let recreates = 0;
  const targetIds: string[] = [];
  const selectionSnapshots: string[][] = [];
  let tracked: RecreateConfirmationStub | undefined;
  const unverified = new classes.EventEditorModal({}, {
    ...event,
    source: "linked",
    syncState: "unavailable",
    unavailableReason: "unknown",
    appleItemId: "possibly-present",
  }, { id: "cal_1", title: "Work", selectedCalendarIds: ["cal_1", "cal_2"] }, async () => {}, {
    recreateCalendarEvent: async (
      _event: unknown,
      _confirmation: unknown,
      targetId: string,
      selectedCalendarIds: readonly string[],
    ) => {
      recreates++;
      targetIds.push(targetId);
      selectionSnapshots.push([...selectedCalendarIds]);
    },
    trackModal: (modal: RecreateConfirmationStub) => {
      tracked = modal;
      return modal;
    },
  });
  await unverified.recreateCalendarCopy();
  assert.equal(recreates, 0);
  assert.equal(unverified.closed, false);
  assert.equal(tracked?.targetCalendar.title, "Work");
  await tracked?.confirm();
  assert.deepEqual(targetIds, ["cal_1"]);
  assert.deepEqual(selectionSnapshots, [["cal_1", "cal_2"]]);

  const target = { id: "cal_1", title: "Work", selectedCalendarIds: ["cal_1"] };
  const cancelled = new classes.RecreateCalendarConfirmationModal({}, event, target, async () => { recreates++; });
  cancelled.close();
  assert.equal(recreates, 1);

  const confirmed = new classes.RecreateCalendarConfirmationModal({}, event, target, async () => { recreates++; });
  await confirmed.confirm();
  assert.equal(recreates, 2);
  assert.equal(confirmed.closed, true);
});

test("destructive Calendar actions require a separate confirmation and coalesce repeated clicks", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let noteDeletes = 0;
  const cancelled = new classes.DeleteEventNoteConfirmationModal({}, event, false, async () => { noteDeletes++; });
  cancelled.close();
  assert.equal(noteDeletes, 0);

  const confirmed = new classes.DeleteEventNoteConfirmationModal({}, event, true, async () => {
    noteDeletes++;
    await pending;
  });
  const first = confirmed.confirm();
  const second = confirmed.confirm();
  assert.equal(noteDeletes, 1);
  assert.equal(confirmed.contentEl.controls[0].disabled, true);
  release();
  await Promise.all([first, second]);
  assert.equal(confirmed.closed, true);

  let calendarDeletes = 0;
  const calendar = new classes.DeleteCalendarEventConfirmationModal({}, event, true, async () => { calendarDeletes++; });
  await calendar.confirm();
  assert.equal(calendarDeletes, 1);
  assert.equal(calendar.closed, true);
});

test("a tracked Calendar modal refuses a stale confirmation after its owner unloads", async () => {
  let active = true;
  let deletes = 0;
  const modal = new classes.DeleteCalendarEventConfirmationModal({}, event, true, async () => { deletes++; });
  classes.setCalendarModalActionGuard(modal, () => active);
  active = false;
  await modal.confirm();
  assert.equal(deletes, 0);
  assert.equal(modal.closed, true);
});

test("closing a Calendar view closes only its owned modals and blocks a late initial render", async () => {
  let releaseRefresh!: () => void;
  const refresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const track = <T extends ModalStub>(modal: T, onClose?: () => void, ownerIsActive: () => boolean = () => true): T | null => {
    if (!ownerIsActive()) return null;
    const original = modal.onClose.bind(modal);
    modal.onClose = () => { onClose?.(); original(); };
    classes.setCalendarModalActionGuard(modal, ownerIsActive);
    return modal;
  };
  const plugin = { refreshCalendarEvents: async () => refresh, trackCalendarModal: track };
  const first = new classes.OmdCalendarView({}, plugin);
  const second = new classes.OmdCalendarView({}, plugin);
  const firstModal = new ModalStub();
  const secondModal = new ModalStub();
  first.openTrackedModal(firstModal);
  second.openTrackedModal(secondModal);
  let renders = 0;
  first.render = () => { renders++; };
  const opening = first.onOpen();
  await first.onClose();
  releaseRefresh();
  await opening;
  assert.equal(firstModal.closed, true);
  assert.equal(secondModal.closed, false);
  assert.equal(renders, 0, "a refresh completing after tab close must not render the closed view");
});

test("unverified linked events can retry Sync from the recovery panel", async () => {
  notices.length = 0;
  let syncs = 0;
  const modal = new classes.EventEditorModal({}, {
    ...event,
    source: "linked",
    syncState: "unavailable",
    unavailableReason: "calendar-deselected",
  }, null, async () => {}, {
    synchronizeCalendarEvents: async () => {
      syncs++;
      return { conflicts: 0, unavailable: 1, errors: 0, pending: 0 };
    },
  });
  await modal.retryCalendarSync();
  assert.equal(syncs, 1);
  assert.equal(modal.closed, true);
  assert.deepEqual(notices, [
    "Calendar sync needs review: 1 linked note needs Calendar recovery. Its Calendar copy may have been deleted, moved, or belong to a Calendar that is not selected. Open the highlighted linked note for safe recovery options.",
  ]);
});

test("Calendar Sync shows progress, coalesces repeated clicks and restores its button", async () => {
  notices.length = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let syncs = 0;
  let label = "Sync";
  const view = new classes.OmdCalendarView({}, { synchronizeCalendarEvents: async () => {
    syncs++;
    await pending;
    return { conflicts: 1, unavailable: 0, errors: 0, pending: 0 };
  } });
  view.syncButton = { disabled: false, setText(value: string) { label = value; } };
  view.render = () => {};
  const first = view.syncEvents();
  const second = view.syncEvents();
  assert.equal(label, "Syncing…");
  assert.equal(view.syncButton.disabled, true);
  release();
  await Promise.all([first, second]);
  assert.equal(syncs, 1);
  assert.equal(label, "Sync");
  assert.equal(view.syncButton.disabled, false);
  assert.deepEqual(notices, [
    "Calendar sync needs review: 1 conflict. Open the highlighted events to compare versions and choose one.",
  ]);
});
