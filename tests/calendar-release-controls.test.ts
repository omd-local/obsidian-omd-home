import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
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
  close() { this.closed = true; }
}

const source = readFileSync(new URL("../src/calendar-view.ts", import.meta.url), "utf8");
const compiled = transformSync(`${source}\nexport { EventEditorModal, EventConflictModal, SyncRequiredModal };`, {
  loader: "ts", format: "cjs", target: "es2022",
}).code;
const module = { exports: {} };
Function("require", "module", "exports", compiled)((id: string) => {
  if (id === "obsidian") return {
    ItemView: class {}, Modal: ModalStub, Setting: class {},
    Notice: class { constructor(message: string) { notices.push(message); } },
  };
  if (id === "./calendar-ui") return calendarUi;
  if (id.startsWith("fullcalendar")) return { Calendar: class {} };
  throw new Error(`Unexpected dependency ${id}`);
}, module, module.exports);

interface EditorStub extends ModalStub {
  saveDraft(): Promise<void>;
  runDetachAction(deleteExternal: boolean, missingMessage: string): Promise<void>;
}
interface ConflictStub extends ModalStub { resolve(choice: "vault" | "external"): Promise<void>; }
interface CalendarViewStub {
  syncButton: { disabled: boolean; setText(value: string): void };
  syncEvents(): Promise<void>;
  render(): void;
}
const classes = module.exports as {
  EventEditorModal: new (...args: unknown[]) => EditorStub;
  EventConflictModal: new (...args: unknown[]) => ConflictStub;
  OmdCalendarView: new (...args: unknown[]) => CalendarViewStub;
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
  await modal.runDetachAction(false, "Unavailable");
  release();
  await first;
  assert.equal(detaches, 0);
});

test("Calendar Sync shows progress, coalesces repeated clicks and restores its button", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let syncs = 0;
  let label = "Sync";
  const view = new classes.OmdCalendarView({}, { synchronizeCalendarEvents: async () => { syncs++; await pending; } });
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
});
