import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helperSource = readFileSync(
  new URL("../eventkit-helper/Sources/omd-eventkit/main.swift", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string): string {
  const startIndex = helperSource.indexOf(start);
  const endIndex = helperSource.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source boundary: ${start}`);
  assert.notEqual(endIndex, -1, `missing source boundary: ${end}`);
  return helperSource.slice(startIndex, endIndex);
}

const upsertSource = sourceBetween("static func upsertEvent", "static func deleteEvent");
const resolveSource = sourceBetween("func resolveEvent", "func clientRequestMarker");

test("EventKit helper advertises safety protocol v2", () => {
  assert.match(helperSource, /struct VersionResponse: Encodable \{ let ok = true; let version = 2 \}/u);
});

test("identified updates resolve the exact occurrence and never recreate a missing item", () => {
  assert.match(
    upsertSource,
    /if let identifier = input\.appleItemId \{\s*guard let existing = try resolveEvent\([\s\S]*identifier: identifier,[\s\S]*occurrenceDate: input\.occurrenceDate,[\s\S]*startHint: try optionalValue\(after: "--start-hint", in: arguments\)[\s\S]*\) else \{\s*throw HelperError\.eventNotFound/u,
  );
  assert.match(
    upsertSource,
    /try requireUnchangedExternalVersion\(input\.externalModifiedAt, for: existing\)\s*event = existing/u,
  );
  const existingBranch = upsertSource.slice(
    upsertSource.indexOf("if let identifier = input.appleItemId"),
    upsertSource.indexOf("} else {"),
  );
  assert.doesNotMatch(existingBranch, /EKEvent\(eventStore:/u);
  assert.doesNotMatch(existingBranch, /\.url\s*=/u);
  assert.doesNotMatch(existingBranch, /\.notes\s*=/u);
});

test("new-event retries use one canonical request marker and exact payload matching", () => {
  assert.match(helperSource, /var clientRequestId: String\?/u);
  assert.match(
    upsertSource,
    /let marker = try clientRequestMarker\(input\.clientRequestId\)[\s\S]*let matching = findCreateRequestEvents\([\s\S]*calendar: calendar,[\s\S]*marker: marker,[\s\S]*around: dateRange\.start/u,
  );
  assert.match(upsertSource, /if matching\.count > 1 \{ throw HelperError\.createRequestConflict \}/u);
  assert.match(
    upsertSource,
    /if let recovered = matching\.first \{\s*guard createPayloadMatches\(recovered, input: input, dateRange: dateRange, calendar: calendar\) else \{\s*throw HelperError\.createRequestConflict\s*\}\s*try emit\(EventResponse\(event: eventRecord\(recovered\)\)\)\s*return/u,
  );
  assert.match(
    upsertSource,
    /let created = EKEvent\(eventStore: store\)\s*created\.calendar = calendar\s*guard created\.url == nil else \{ throw HelperError\.createRequestConflict \}\s*created\.url = marker/u,
  );
  assert.ok(
    upsertSource.indexOf("findCreateRequestEvents") < upsertSource.indexOf("EKEvent(eventStore: store)"),
    "marker recovery must run before creating a new EventKit item",
  );
});

test("request markers are strict, reversible, and do not claim ordinary event URLs", () => {
  assert.match(
    helperSource,
    /CharacterSet\(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-\._~"\)/u,
  );
  assert.match(helperSource, /omd-home:\/\/calendar-event\/\\\(encoded\)/u);
  assert.match(
    helperSource,
    /components\.scheme == "omd-home",\s*components\.host == "calendar-event",\s*components\.user == nil,\s*components\.password == nil,\s*components\.port == nil,\s*components\.query == nil,\s*components\.fragment == nil/u,
  );
  assert.match(
    helperSource,
    /let canonical = try\? clientRequestMarker\(decoded\),\s*canonical\.absoluteString == url\.absoluteString/u,
  );
  assert.match(helperSource, /clientRequestId: clientRequestId\(from: event\.url\)/u);
});

test("idempotent recovery rejects marker collisions whose payload differs", () => {
  const payloadSource = sourceBetween("func createPayloadMatches", "func boundedSearchWindow");
  for (const contract of [
    /event\.title == input\.title/u,
    /sameInstant\(event\.startDate, dateRange\.start\)/u,
    /sameInstant\(event\.endDate, dateRange\.end\)/u,
    /event\.isAllDay == input\.allDay/u,
    /\(event\.location \?\? ""\) == \(input\.location \?\? ""\)/u,
    /event\.calendar\.calendarIdentifier == calendar\.calendarIdentifier/u,
  ]) assert.match(payloadSource, contract);
  assert.match(
    helperSource,
    /return store\.events\(matching: predicate\)\.filter \{ \$0\.url\?\.absoluteString == marker\.absoluteString \}/u,
  );
});

test("lookup, update, and delete resolve a requested recurrence occurrence from its current start", () => {
  assert.match(
    helperSource,
    /static func outputEvent[\s\S]*let occurrenceDate = try optionalValue\(after: "--occurrence-date", in: arguments\)[\s\S]*let startHint = try optionalValue\(after: "--start-hint", in: arguments\)[\s\S]*occurrenceDate: occurrenceDate,[\s\S]*startHint: startHint/u,
  );
  assert.match(
    helperSource,
    /static func deleteEvent[\s\S]*let occurrenceDate = try optionalValue\(after: "--occurrence-date", in: arguments\)[\s\S]*let startHint = try optionalValue\(after: "--start-hint", in: arguments\)[\s\S]*occurrenceDate: occurrenceDate,[\s\S]*startHint: startHint/u,
  );
  assert.match(resolveSource, /guard let occurrenceDate else \{ return store\.event\(withIdentifier: identifier\) \}/u);
  assert.match(
    resolveSource,
    /guard let startHint else \{[\s\S]*Recurring Calendar operations require the current occurrence start[\s\S]*let currentStart = try eventStartHint\(startHint\)[\s\S]*boundedSearchWindow\(around: currentStart\)[\s\S]*predicateForEvents\(withStart: window\.start, end: window\.end, calendars: nil\)[\s\S]*event\.eventIdentifier == identifier[\s\S]*let actual = event\.occurrenceDate[\s\S]*sameInstant\(actual, wanted\)/u,
  );
  assert.match(resolveSource, /if matches\.count > 1 \{ throw HelperError\.eventAmbiguous \}/u);
  assert.match(
    resolveSource,
    /guard let match = matches\.first else \{ throw HelperError\.occurrenceNotLocated \}\s*return match/u,
  );
  assert.match(
    helperSource,
    /func eventStartHint[\s\S]*\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$[\s\S]*dateOnly\(value, timeZone: Calendar\.current\.timeZone\)[\s\S]*isoDateTime\(value\)/u,
  );
});

test("recurring occurrences have distinct UI ids while retaining the raw Apple identifier", () => {
  assert.match(
    helperSource,
    /func eventRecordId[\s\S]*guard let occurrence = event\.occurrenceDate else \{ return "apple:\\\(identifier\)" \}[\s\S]*return "apple:\\\(identifier\):occurrence:\\\(milliseconds\)"/u,
  );
  assert.match(helperSource, /id: eventRecordId\(event\)/u);
  assert.match(helperSource, /appleItemId: event\.eventIdentifier/u);

  const occurrenceId = (identifier: string, instant: string): string => (
    `apple:${identifier}:occurrence:${new Date(instant).getTime()}`
  );
  assert.notEqual(
    occurrenceId("series-1", "2026-10-06T09:00:00.000Z"),
    occurrenceId("series-1", "2026-10-13T09:00:00.000Z"),
  );
});

test("recurrence mutations preserve requested EventKit span semantics", () => {
  assert.match(
    helperSource,
    /func spanValue\(_ value: String\) -> EKSpan \{ value == "future" \? \.futureEvents : \.thisEvent \}/u,
  );
  assert.match(upsertSource, /try store\.save\(event, span: span, commit: true\)/u);
  assert.match(
    helperSource,
    /try store\.remove\(event, span: spanValue\(try optionalValue\(after: "--span", in: arguments\) \?\? "this"\), commit: true\)/u,
  );
});

test("EventKit compare-and-swap runs before update or delete", () => {
  assert.match(
    upsertSource,
    /guard existing\.refresh\(\) else \{ throw HelperError\.eventNotFound \}\s*try requireUnchangedExternalVersion\(input\.externalModifiedAt, for: existing\)/u,
  );
  assert.match(
    helperSource,
    /guard isoString\(actual\) == isoString\(expected\) else \{ throw HelperError\.eventChanged \}/u,
  );
  assert.match(helperSource, /guard let expectedValue else \{ throw HelperError\.eventChanged \}/u);
  assert.match(
    helperSource,
    /guard event\.refresh\(\) else \{ throw HelperError\.eventNotFound \}\s*try requireUnchangedExternalVersion\(try optionalValue\(after: "--modified-at", in: arguments\), for: event\)\s*try store\.remove/u,
  );
});

test("EventKit all-day writes parse date-only exclusive bounds in Calendar local time", () => {
  assert.match(
    helperSource,
    /let dateRange = try eventDateRange\(input, localTimeZone: Calendar\.current\.timeZone\)/u,
  );
  assert.match(
    helperSource,
    /if input\.allDay \{[\s\S]*event\.timeZone = Calendar\.current\.timeZone[\s\S]*\}\s*event\.startDate = dateRange\.start\s*event\.endDate = dateRange\.end/u,
  );
  assert.match(
    helperSource,
    /let start = input\.allDay\s*\? try dateOnly\(input\.start, timeZone: localTimeZone\)\s*:\s*try isoDateTime\(input\.start\)/u,
  );
  assert.match(
    helperSource,
    /let end = input\.allDay\s*\? try dateOnly\(input\.end, timeZone: localTimeZone\)\s*:\s*try isoDateTime\(input\.end\)[\s\S]*guard end > start/u,
  );
  assert.match(helperSource, /Calendar\(identifier: \.gregorian\)[\s\S]*calendar\.timeZone = timeZone/u);
  assert.match(helperSource, /All-day events require YYYY-MM-DD dates/u);
});

test("EventKit all-day reads preserve date-only note boundaries instead of converting through UTC", () => {
  assert.match(
    helperSource,
    /start: event\.isAllDay \? dateOnlyString\(event\.startDate, timeZone: localTimeZone\) : isoString\(event\.startDate\)/u,
  );
  assert.match(
    helperSource,
    /end: event\.isAllDay \? dateOnlyString\(event\.endDate, timeZone: localTimeZone\) : isoString\(event\.endDate\)/u,
  );
});

test("EventKit timed writes still require an ISO date-time with an explicit time zone", () => {
  assert.match(
    helperSource,
    /func isoDateTime\([\s\S]*\\d\{2\}T\\d\{2\}:\\d\{2\}:\\d\{2\}[\s\S]*\(\?:Z\|\[\+-\]\\d\{2\}:\\d\{2\}\)\$/u,
  );
  assert.match(helperSource, /Timed events require an ISO-8601 date-time with a time zone/u);
});
