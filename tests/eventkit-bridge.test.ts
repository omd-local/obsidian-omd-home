import assert from "node:assert/strict";
import test from "node:test";
import { eventKitErrorMessage, eventKitProcessErrorMessage } from "../src/eventkit-errors.ts";
import { normalizeEventKitCalendar, normalizeEventKitEvent } from "../src/eventkit-bridge.ts";

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
  });
  assert.equal(event.calendar, "Activity");
  assert.equal(event.appleItemId, "item_1");
  assert.equal(event.title, "QA event");
});
