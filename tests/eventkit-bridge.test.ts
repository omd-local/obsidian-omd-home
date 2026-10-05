import assert from "node:assert/strict";
import test from "node:test";
import { eventKitErrorMessage, eventKitProcessErrorMessage } from "../src/eventkit-errors.ts";
import {
  EventKitBridge,
  EventKitHelperCompatibilityError,
  EXPECTED_EVENTKIT_HELPER_PROTOCOL_VERSION,
  eventKitBridgeErrorMessage,
  eventKitMutationCommitState,
  isEventKitHelperAvailable,
  normalizeEventKitCalendar,
  normalizeEventKitEvent,
  parseEventKitHelperProtocolVersion,
  requireCompatibleEventKitHelperProtocol,
  resolveEventKitHelperPath,
} from "../src/eventkit-bridge.ts";

test("EventKit helper path prefers an override and otherwise resolves beside the installed plugin", () => {
  assert.equal(
    resolveEventKitHelperPath(" /custom/omd-eventkit ", "/vault", ".obsidian/plugins/omd-home"),
    "/custom/omd-eventkit",
  );
  assert.equal(
    resolveEventKitHelperPath("", "/vault/", "/.obsidian/plugins/omd-home/"),
    "/vault/.obsidian/plugins/omd-home/omd-eventkit",
  );
  assert.equal(resolveEventKitHelperPath("", "", ".obsidian/plugins/omd-home"), "");
});

test("EventKit helper availability requires an executable regular file", () => {
  const fileSystem = {
    constants: { X_OK: 1 },
    statSync: (path: string) => ({ isFile: () => path === "/plugin/omd-eventkit" }),
    accessSync: (path: string) => {
      if (path !== "/plugin/omd-eventkit") throw new Error("not executable");
    },
  };
  assert.equal(isEventKitHelperAvailable("/plugin/omd-eventkit", fileSystem), true);
  assert.equal(isEventKitHelperAvailable("/plugin", fileSystem), false);
  assert.equal(isEventKitHelperAvailable("", fileSystem), false);
});

test("sanitizes EventKit permission and writeability errors", () => {
  assert.equal(
    eventKitErrorMessage("Calendar access was not granted in System Settings\n"),
    "Calendar access was not granted in System Settings.",
  );
  assert.equal(
    eventKitErrorMessage("The selected Calendar is unavailable or no longer writable\n"),
    "The selected Calendar is unavailable or no longer writable.",
  );
});

test("maps EventKit compare-and-swap failures to safe recovery actions", () => {
  assert.equal(
    eventKitBridgeErrorMessage("The Calendar event changed since it was last read\n"),
    "The Calendar event changed after it was last read. Run Sync, review the latest version, then try again.",
  );
  assert.equal(
    eventKitBridgeErrorMessage("The Calendar event no longer exists\n"),
    "The Calendar event no longer exists. Run Sync to refresh Calendar; linked notes can then use Recreate or Detach.",
  );
  assert.equal(
    eventKitBridgeErrorMessage("Recurring Calendar operations require the current occurrence start\n"),
    "Calendar could not safely locate this recurring occurrence. Nothing was changed; run Sync and try again.",
  );
  assert.equal(
    eventKitBridgeErrorMessage("The Calendar occurrence could not be located safely; nothing was changed\n"),
    "Calendar could not confirm this recurring occurrence. Nothing was changed; run Sync and review the series before trying again.",
  );
});

test("classifies helper-side validation failures as definitely not committed", () => {
  for (const stderr of [
    "The Calendar event changed since it was last read",
    "Calendar event lookup was ambiguous; nothing was changed",
    "The Calendar occurrence could not be located safely; nothing was changed",
    "Calendar create request conflicts with an existing event; nothing was changed",
    "Recurring Calendar operations require the current occurrence start",
  ]) {
    assert.equal(eventKitMutationCommitState(stderr), "not-committed");
  }
  assert.equal(eventKitMutationCommitState("EventKit save failed after an unknown system error"), "unknown");
});

test("sanitizes EventKit request validation and unknown helper stderr", () => {
  assert.equal(
    eventKitErrorMessage("Missing --id\n"),
    "Calendar helper rejected the request. Check OMD Home settings and try again.",
  );
  assert.equal(
    eventKitErrorMessage("Traceback: /Users/shion/Library/Calendars\n"),
    "Calendar helper failed. Check the local EventKit setup and try again.",
  );
});

test("sanitizes EventKit process launch errors without exposing the configured path", () => {
  const privatePath = "/Users/example/private/bin/omd-eventkit";
  const message = eventKitProcessErrorMessage(new Error(`spawn ${privatePath} ENOENT`));
  assert.equal(message, "The configured EventKit helper could not be found.");
  assert.equal(message.includes(privatePath), false);
});

test("normalizes EventKit display and identity strings before synchronization", () => {
  const calendar = normalizeEventKitCalendar({
    id: " cal_1 ",
    title: " Activity ",
    sourceId: " source_1 ",
    sourceTitle: " iCloud ",
    sourceType: "caldav",
    allowsModifications: true,
  });
  assert.equal(calendar.id, "cal_1");
  assert.equal(calendar.title, "Activity");
  assert.equal(calendar.sourceTitle, "iCloud");

  const event = normalizeEventKitEvent({
    id: " apple_1 ",
    title: " QA event ",
    start: " 2026-08-17T03:45:00.000Z ",
    end: " 2026-08-17T04:45:00.000Z ",
    allDay: false,
    calendar: " Activity ",
    source: "external",
    appleCalendarId: " cal_1 ",
    appleItemId: " item_1 ",
    appleExternalId: " external_1 ",
    occurrenceDate: " 2026-08-17T03:45:00.000Z ",
    externalModifiedAt: " 2026-08-17T03:44:59.000Z ",
    clientRequestId: " request_1 ",
  });
  assert.equal(event.calendar, "Activity");
  assert.equal(event.appleItemId, "item_1");
  assert.equal(event.occurrenceDate, "2026-08-17T03:45:00.000Z");
  assert.equal(event.externalModifiedAt, "2026-08-17T03:44:59.000Z");
  assert.equal(event.clientRequestId, "request_1");
  assert.equal(event.title, "QA event");
});

test("bridge normalization preserves the all-day date-only and exclusive-end contract", () => {
  const event = normalizeEventKitEvent({
    id: " apple_all_day ",
    title: " Local holiday ",
    start: " 2026-09-27 ",
    end: " 2026-09-28 ",
    allDay: true,
    calendar: " Activity ",
    source: "external",
  });
  assert.equal(event.start, "2026-09-27");
  assert.equal(event.end, "2026-09-28");
  assert.equal(event.allDay, true);
});

test("bridge forwards the exact recurrence occurrence to lookup and version-guarded delete", async () => {
  const bridge = new EventKitBridge(() => "/plugin/omd-eventkit");
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  Object.assign(bridge, {
    call: async (args: string[], stdin?: string) => {
      calls.push({ args, stdin });
      if (args[0] === "version") return { ok: true, version: 2 };
      if (args[0] === "lookup") {
        return {
          ok: true,
          event: {
            id: "apple:series_1:occurrence:1791266400000",
            title: "Later occurrence",
            start: "2026-10-06T02:00:00.000Z",
            end: "2026-10-06T03:00:00.000Z",
            allDay: false,
            calendar: "Activity",
            source: "external",
            appleItemId: "series_1",
            occurrenceDate: "2026-09-01T02:00:00.000Z",
          },
        };
      }
      if (args[0] === "delete") return { ok: true };
      throw new Error(`unexpected command ${args[0]}`);
    },
  });

  const occurrenceDate = "2026-09-01T02:00:00.000Z";
  const currentStart = "2026-10-06T02:00:00.000Z";
  const found = await bridge.lookup("series_1", occurrenceDate, currentStart);
  assert.equal(found?.occurrenceDate, occurrenceDate);
  assert.deepEqual(calls.map((entry) => entry.args), [
    ["version"],
    [
      "lookup", "--id", "series_1",
      "--occurrence-date", occurrenceDate,
      "--start-hint", currentStart,
    ],
  ]);

  calls.length = 0;
  await bridge.remove(
    "series_1",
    "2026-10-06T01:59:59.000Z",
    "future",
    occurrenceDate,
    currentStart,
  );
  assert.deepEqual(calls.map((entry) => entry.args), [
    ["version"],
    [
      "delete", "--id", "series_1", "--span", "future",
      "--modified-at", "2026-10-06T01:59:59.000Z",
      "--occurrence-date", occurrenceDate,
      "--start-hint", currentStart,
    ],
  ]);
});

test("bridge keeps distinct recurring occurrence ids and sends create request markers", async () => {
  const first = normalizeEventKitEvent({
    id: "apple:series_1:occurrence:1791266400000",
    title: "First occurrence",
    start: "2026-10-06T02:00:00.000Z",
    end: "2026-10-06T03:00:00.000Z",
    allDay: false,
    calendar: "Activity",
    source: "external",
    appleItemId: "series_1",
    occurrenceDate: "2026-10-06T02:00:00.000Z",
  });
  const second = normalizeEventKitEvent({
    ...first,
    id: "apple:series_1:occurrence:1791871200000",
    title: "Second occurrence",
    start: "2026-10-13T02:00:00.000Z",
    end: "2026-10-13T03:00:00.000Z",
    occurrenceDate: "2026-10-13T02:00:00.000Z",
  });
  assert.equal(first.appleItemId, second.appleItemId);
  assert.notEqual(first.id, second.id);

  const bridge = new EventKitBridge(() => "/plugin/omd-eventkit");
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  Object.assign(bridge, {
    call: async (args: string[], stdin?: string) => {
      calls.push({ args, stdin });
      if (args[0] === "version") return { ok: true, version: 2 };
      if (args[0] === "upsert") return { ok: true, event: first };
      throw new Error(`unexpected command ${args[0]}`);
    },
  });
  await bridge.upsert({
    id: "local_create_1",
    title: "Idempotent create",
    start: "2026-10-06T02:00:00.000Z",
    end: "2026-10-06T03:00:00.000Z",
    allDay: false,
    calendar: "Activity",
    source: "linked",
    appleCalendarId: "calendar_1",
    clientRequestId: "local_create_1",
  });
  assert.deepEqual(calls.map((entry) => entry.args), [
    ["version"],
    ["upsert", "--span", "this"],
  ]);
  assert.equal(JSON.parse(calls[1]!.stdin ?? "{}").clientRequestId, "local_create_1");
});

test("bridge sends the pre-edit start hint when updating a moved recurrence", async () => {
  const bridge = new EventKitBridge(() => "/plugin/omd-eventkit");
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const edited = {
    id: "apple:series_2:occurrence:1788231600000",
    title: "Moved again",
    start: "2026-11-20T09:00:00.000Z",
    end: "2026-11-20T10:00:00.000Z",
    allDay: false,
    calendar: "Activity",
    source: "linked",
    appleCalendarId: "calendar_1",
    appleItemId: "series_2",
    occurrenceDate: "2026-09-01T09:00:00.000Z",
    externalModifiedAt: "2026-10-05T01:00:00.000Z",
  } as const;
  Object.assign(bridge, {
    call: async (args: string[], stdin?: string) => {
      calls.push({ args, stdin });
      if (args[0] === "version") return { ok: true, version: 2 };
      if (args[0] === "upsert") return { ok: true, event: edited };
      throw new Error(`unexpected command ${args[0]}`);
    },
  });

  const preEditStart = "2026-10-12T09:00:00.000Z";
  await bridge.upsert(edited, "this", preEditStart);
  assert.deepEqual(calls.map((entry) => entry.args), [
    ["version"],
    ["upsert", "--span", "this", "--start-hint", preEditStart],
  ]);
});

test("an executable protocol-v1 helper is rejected before any Calendar read", async () => {
  const bridge = new EventKitBridge(() => "/plugin/omd-eventkit");
  const calls: string[][] = [];
  Object.assign(bridge, {
    call: async (args: string[]) => {
      calls.push(args);
      if (args[0] === "version") return { ok: true, version: 1 };
      throw new Error("an incompatible helper must not receive Calendar commands");
    },
  });

  await assert.rejects(
    bridge.calendars(),
    (error: unknown) => error instanceof EventKitHelperCompatibilityError
      && error.code === "eventkit_helper_incompatible"
      && error.expectedVersion === 2
      && error.actualVersion === 1
      && !error.message.includes("/plugin/omd-eventkit"),
  );
  assert.deepEqual(calls, [["version"]]);

  const event = {
      id: "evt_1",
      title: "Blocked write",
      start: "2026-10-06T08:00:00.000Z",
      end: "2026-10-06T09:00:00.000Z",
      allDay: false,
      calendar: "Activity",
      source: "linked",
      appleCalendarId: "cal_1",
  } as const;
  const blockedOperations = [
    () => bridge.events(["cal_1"], event.start, event.end),
    () => bridge.lookup("item_1"),
    () => bridge.upsert(event),
    () => bridge.remove("item_1", "2026-10-06T07:59:00.000Z"),
  ];
  for (const operation of blockedOperations) {
    calls.length = 0;
    await assert.rejects(operation(), EventKitHelperCompatibilityError);
    assert.deepEqual(calls, [["version"]]);
  }
});

test("a protocol-v2 helper proceeds from compatibility probe to Calendar access", async () => {
  const bridge = new EventKitBridge(() => "/plugin/omd-eventkit");
  const calls: string[][] = [];
  Object.assign(bridge, {
    call: async (args: string[]) => {
      calls.push(args);
      if (args[0] === "version") return { ok: true, version: 2 };
      if (args[0] === "calendars") return { ok: true, calendars: [] };
      throw new Error(`unexpected command ${args[0]}`);
    },
  });

  assert.deepEqual(await bridge.calendars(), []);
  assert.deepEqual(calls, [["version"], ["calendars"]]);
});

test("helper protocol parsing accepts only the exact supported integer contract", () => {
  assert.equal(EXPECTED_EVENTKIT_HELPER_PROTOCOL_VERSION, 2);
  assert.equal(parseEventKitHelperProtocolVersion(2), 2);
  assert.equal(requireCompatibleEventKitHelperProtocol(2), 2);
  for (const invalid of [undefined, null, "2", 0, 2.5]) {
    assert.throws(() => parseEventKitHelperProtocolVersion(invalid), EventKitHelperCompatibilityError);
  }
  assert.throws(
    () => requireCompatibleEventKitHelperProtocol(1),
    (error: unknown) => error instanceof EventKitHelperCompatibilityError && error.actualVersion === 1,
  );
});
