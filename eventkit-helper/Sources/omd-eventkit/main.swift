import EventKit
import Foundation
import Darwin

struct CalendarsResponse: Encodable { let ok = true; let calendars: [CalendarDescriptor] }
struct EventsResponse: Encodable { let ok = true; let events: [EventRecord] }
struct EventResponse: Encodable { let ok = true; let event: EventRecord }
struct EventLookupResponse: Encodable { let ok = true; let event: EventRecord? }
struct OkResponse: Encodable { let ok = true }
struct VersionResponse: Encodable { let ok = true; let version = 3 }

struct CalendarDescriptor: Codable {
    let id: String
    let title: String
    let sourceId: String
    let sourceTitle: String
    let sourceType: String
    let allowsModifications: Bool
    let color: String?
}

struct EventRecord: Codable {
    var id: String
    var title: String
    var start: String
    var end: String
    var allDay: Bool
    var calendar: String
    var source: String
    var notePath: String?
    var location: String?
    var appleCalendarId: String?
    var appleItemId: String?
    var appleExternalId: String?
    var occurrenceDate: String?
    var lastSyncedAt: String?
    var vaultModifiedAt: String?
    var externalModifiedAt: String?
    var clientRequestId: String?
    var syncState: String?
    var readOnly: Bool?
}

enum HelperError: LocalizedError {
    case invalidArguments(String)
    case permissionDenied
    case calendarNotFound
    case eventNotFound
    case eventChanged
    case eventAmbiguous
    case occurrenceNotLocated
    case createRequestConflict

    var errorDescription: String? {
        switch self {
        case .invalidArguments(let detail): return detail
        case .permissionDenied: return "Calendar access was not granted in System Settings"
        case .calendarNotFound: return "The selected Calendar is unavailable or no longer writable"
        case .eventNotFound: return "The Calendar event no longer exists"
        case .eventChanged: return "The Calendar event changed since it was last read"
        case .eventAmbiguous: return "Calendar event lookup was ambiguous; nothing was changed"
        case .occurrenceNotLocated: return "The Calendar occurrence could not be located safely; nothing was changed"
        case .createRequestConflict: return "Calendar create request conflicts with an existing event; nothing was changed"
        }
    }
}

@main
struct OmdEventKit {
    static func main() async {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let command = arguments.first else { throw HelperError.invalidArguments("Expected version, calendars, events, lookup, upsert, or delete") }
            if command == "version" {
                try emit(VersionResponse())
                return
            }
            let store = EKEventStore()
            guard try await store.requestFullAccessToEvents() else { throw HelperError.permissionDenied }
            switch command {
            case "calendars": try outputCalendars(store)
            case "events": try outputEvents(store, arguments: Array(arguments.dropFirst()))
            case "lookup": try outputEvent(store, arguments: Array(arguments.dropFirst()))
            case "upsert": try upsertEvent(store, arguments: Array(arguments.dropFirst()))
            case "delete": try deleteEvent(store, arguments: Array(arguments.dropFirst()))
            default: throw HelperError.invalidArguments("Unknown EventKit command")
            }
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }

    static func outputCalendars(_ store: EKEventStore) throws {
        let sourceCalendars = store.calendars(for: .event)
        let descriptors: [CalendarDescriptor] = sourceCalendars.map { calendar in
            CalendarDescriptor(
                id: calendar.calendarIdentifier,
                title: calendar.title,
                sourceId: calendar.source.sourceIdentifier,
                sourceTitle: calendar.source.title,
                sourceType: sourceName(calendar.source.sourceType),
                allowsModifications: calendar.allowsContentModifications,
                color: hexColor(calendar.cgColor)
            )
        }
        let calendars = descriptors.sorted { lhs, rhs in
            let sourceOrder = lhs.sourceTitle.localizedCaseInsensitiveCompare(rhs.sourceTitle)
            if sourceOrder != .orderedSame { return sourceOrder == .orderedAscending }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
        try emit(CalendarsResponse(calendars: calendars))
    }

    static func outputEvents(_ store: EKEventStore, arguments: [String]) throws {
        let start = try isoDateTime(value(after: "--start", in: arguments))
        let end = try isoDateTime(value(after: "--end", in: arguments))
        let ids = Set(try value(after: "--calendars", in: arguments).split(separator: ",").map(String.init))
        let calendars = store.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let events = store.events(matching: predicate).map(eventRecord)
        try emit(EventsResponse(events: events))
    }

    static func outputEvent(_ store: EKEventStore, arguments: [String]) throws {
        let identifier = try value(after: "--id", in: arguments)
        let occurrenceDate = try optionalValue(after: "--occurrence-date", in: arguments)
        let startHint = try optionalValue(after: "--start-hint", in: arguments)
        do {
            let event = try resolveEvent(
                store,
                identifier: identifier,
                occurrenceDate: occurrenceDate,
                startHint: startHint
            )
            try emit(EventLookupResponse(event: event.map(eventRecord)))
        } catch HelperError.occurrenceNotLocated {
            try emit(EventLookupResponse(event: nil))
        }
    }

    static func upsertEvent(_ store: EKEventStore, arguments: [String]) throws {
        let span = spanValue(try optionalValue(after: "--span", in: arguments) ?? "this")
        let input = try JSONDecoder().decode(EventRecord.self, from: FileHandle.standardInput.readDataToEndOfFile())
        let dateRange = try eventDateRange(input, localTimeZone: Calendar.current.timeZone)
        let event: EKEvent
        if let identifier = input.appleItemId {
            guard let existing = try resolveEvent(
                store,
                identifier: identifier,
                occurrenceDate: input.occurrenceDate,
                startHint: try optionalValue(after: "--start-hint", in: arguments)
            ) else {
                throw HelperError.eventNotFound
            }
            guard existing.refresh() else { throw HelperError.eventNotFound }
            try requireUnchangedExternalVersion(input.externalModifiedAt, for: existing)
            event = existing
        } else {
            guard let calendarId = input.appleCalendarId,
                  let calendar = store.calendar(withIdentifier: calendarId),
                  calendar.allowsContentModifications else { throw HelperError.calendarNotFound }
            let marker = try clientRequestMarker(input.clientRequestId)
            let matching = findCreateRequestEvents(
                store,
                calendar: calendar,
                marker: marker,
                around: dateRange.start
            )
            if matching.count > 1 { throw HelperError.createRequestConflict }
            if let recovered = matching.first {
                guard createPayloadMatches(recovered, input: input, dateRange: dateRange, calendar: calendar) else {
                    throw HelperError.createRequestConflict
                }
                try emit(EventResponse(event: eventRecord(recovered)))
                return
            }
            let created = EKEvent(eventStore: store)
            created.calendar = calendar
            guard created.url == nil else { throw HelperError.createRequestConflict }
            created.url = marker
            event = created
        }
        event.title = input.title
        event.isAllDay = input.allDay
        if input.allDay {
            // EventKit stores all-day boundaries as Date values. Anchor the note's
            // floating YYYY-MM-DD dates in Calendar's local time zone so a UTC
            // conversion cannot move either exclusive boundary to another day.
            event.timeZone = Calendar.current.timeZone
        }
        event.startDate = dateRange.start
        event.endDate = dateRange.end
        event.location = input.location
        try store.save(event, span: span, commit: true)
        try emit(EventResponse(event: eventRecord(event)))
    }

    static func deleteEvent(_ store: EKEventStore, arguments: [String]) throws {
        let identifier = try value(after: "--id", in: arguments)
        let occurrenceDate = try optionalValue(after: "--occurrence-date", in: arguments)
        let startHint = try optionalValue(after: "--start-hint", in: arguments)
        guard let event = try resolveEvent(
            store,
            identifier: identifier,
            occurrenceDate: occurrenceDate,
            startHint: startHint
        ) else {
            throw HelperError.eventNotFound
        }
        guard event.refresh() else { throw HelperError.eventNotFound }
        try requireUnchangedExternalVersion(try optionalValue(after: "--modified-at", in: arguments), for: event)
        try store.remove(event, span: spanValue(try optionalValue(after: "--span", in: arguments) ?? "this"), commit: true)
        try emit(OkResponse())
    }
}

func requireUnchangedExternalVersion(_ expectedValue: String?, for event: EKEvent) throws {
    guard let expectedValue else { throw HelperError.eventChanged }
    guard let actual = event.lastModifiedDate else { throw HelperError.eventChanged }
    let expected = try isoDateTime(expectedValue)
    guard isoString(actual) == isoString(expected) else { throw HelperError.eventChanged }
}

func eventRecord(_ event: EKEvent) -> EventRecord {
    let localTimeZone = event.timeZone ?? Calendar.current.timeZone
    return EventRecord(
        id: eventRecordId(event),
        title: event.title ?? "Untitled event",
        start: event.isAllDay ? dateOnlyString(event.startDate, timeZone: localTimeZone) : isoString(event.startDate),
        end: event.isAllDay ? dateOnlyString(event.endDate, timeZone: localTimeZone) : isoString(event.endDate),
        allDay: event.isAllDay,
        calendar: event.calendar.title,
        source: "external",
        notePath: nil,
        location: event.location,
        appleCalendarId: event.calendar.calendarIdentifier,
        appleItemId: event.eventIdentifier,
        appleExternalId: event.calendarItemExternalIdentifier,
        occurrenceDate: event.occurrenceDate.map(isoString),
        lastSyncedAt: nil,
        vaultModifiedAt: nil,
        externalModifiedAt: event.lastModifiedDate.map(isoString),
        clientRequestId: clientRequestId(from: event.url),
        syncState: "clean",
        readOnly: !event.calendar.allowsContentModifications
    )
}

func eventRecordId(_ event: EKEvent) -> String {
    let identifier = event.eventIdentifier ?? event.calendarItemIdentifier
    guard let occurrence = event.occurrenceDate else { return "apple:\(identifier)" }
    let milliseconds = Int64((occurrence.timeIntervalSince1970 * 1_000).rounded())
    return "apple:\(identifier):occurrence:\(milliseconds)"
}

func resolveEvent(
    _ store: EKEventStore,
    identifier: String,
    occurrenceDate: String?,
    startHint: String?
) throws -> EKEvent? {
    guard let occurrenceDate else { return store.event(withIdentifier: identifier) }
    let wanted = try isoDateTime(occurrenceDate)
    guard let startHint else {
        throw HelperError.invalidArguments("Recurring Calendar operations require the current occurrence start")
    }
    let currentStart = try eventStartHint(startHint)
    let window = boundedSearchWindow(around: currentStart)
    let predicate = store.predicateForEvents(withStart: window.start, end: window.end, calendars: nil)
    let matches = store.events(matching: predicate).filter { event in
        guard event.eventIdentifier == identifier, let actual = event.occurrenceDate else { return false }
        return sameInstant(actual, wanted)
    }
    if matches.count > 1 { throw HelperError.eventAmbiguous }
    guard let match = matches.first else { throw HelperError.occurrenceNotLocated }
    return match
}

func eventStartHint(_ value: String) throws -> Date {
    if value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
        return try dateOnly(value, timeZone: Calendar.current.timeZone)
    }
    return try isoDateTime(value)
}

func clientRequestMarker(_ rawValue: String?) throws -> URL {
    guard let value = rawValue,
          !value.isEmpty,
          value == value.trimmingCharacters(in: .whitespacesAndNewlines),
          value.utf8.count <= 512,
          value.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) }) else {
        throw HelperError.invalidArguments("New Calendar events require a valid client request ID")
    }
    // Keep this marker canonical and independent of the user's locale. RFC 3986
    // unreserved ASCII is the only text emitted without percent encoding.
    let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
    guard let encoded = value.addingPercentEncoding(withAllowedCharacters: allowed),
          let marker = URL(string: "omd-home://calendar-event/\(encoded)") else {
        throw HelperError.invalidArguments("New Calendar events require a valid client request ID")
    }
    return marker
}

func clientRequestId(from url: URL?) -> String? {
    guard let url,
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme == "omd-home",
          components.host == "calendar-event",
          components.user == nil,
          components.password == nil,
          components.port == nil,
          components.query == nil,
          components.fragment == nil else { return nil }
    let path = components.percentEncodedPath
    guard path.hasPrefix("/"), path.dropFirst().contains("/") == false else { return nil }
    let encoded = String(path.dropFirst())
    guard !encoded.isEmpty,
          let decoded = encoded.removingPercentEncoding,
          let canonical = try? clientRequestMarker(decoded),
          canonical.absoluteString == url.absoluteString else { return nil }
    return decoded
}

func findCreateRequestEvents(
    _ store: EKEventStore,
    calendar: EKCalendar,
    marker: URL,
    around start: Date
) -> [EKEvent] {
    let window = boundedSearchWindow(around: start)
    let predicate = store.predicateForEvents(withStart: window.start, end: window.end, calendars: [calendar])
    return store.events(matching: predicate).filter { $0.url?.absoluteString == marker.absoluteString }
}

func createPayloadMatches(
    _ event: EKEvent,
    input: EventRecord,
    dateRange: (start: Date, end: Date),
    calendar: EKCalendar
) -> Bool {
    event.title == input.title
        && sameInstant(event.startDate, dateRange.start)
        && sameInstant(event.endDate, dateRange.end)
        && event.isAllDay == input.allDay
        && (event.location ?? "") == (input.location ?? "")
        && event.calendar.calendarIdentifier == calendar.calendarIdentifier
}

func boundedSearchWindow(around value: Date) -> (start: Date, end: Date) {
    (value.addingTimeInterval(-86_400), value.addingTimeInterval(86_400))
}

func sameInstant(_ lhs: Date, _ rhs: Date) -> Bool {
    isoString(lhs) == isoString(rhs)
}

func sourceName(_ value: EKSourceType) -> String {
    switch value {
    case .local: return "local"
    case .calDAV: return "caldav"
    case .exchange: return "exchange"
    case .subscribed: return "subscribed"
    case .birthdays: return "birthdays"
    default: return "unknown"
    }
}

func spanValue(_ value: String) -> EKSpan { value == "future" ? .futureEvents : .thisEvent }

func value(after flag: String, in arguments: [String]) throws -> String {
    guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
        throw HelperError.invalidArguments("Missing \(flag)")
    }
    return arguments[index + 1]
}

func optionalValue(after flag: String, in arguments: [String]) throws -> String? {
    guard arguments.contains(flag) else { return nil }
    return try value(after: flag, in: arguments)
}

func eventDateRange(_ input: EventRecord, localTimeZone: TimeZone) throws -> (start: Date, end: Date) {
    let start = input.allDay
        ? try dateOnly(input.start, timeZone: localTimeZone)
        : try isoDateTime(input.start)
    let end = input.allDay
        ? try dateOnly(input.end, timeZone: localTimeZone)
        : try isoDateTime(input.end)
    guard end > start else {
        throw HelperError.invalidArguments("Event End must be after Start; all-day End is exclusive")
    }
    return (start, end)
}

func dateOnly(_ value: String, timeZone: TimeZone) throws -> Date {
    guard value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else {
        throw HelperError.invalidArguments("All-day events require YYYY-MM-DD dates")
    }
    let parts = value.split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 3,
          let year = Int(parts[0]),
          let month = Int(parts[1]),
          let day = Int(parts[2]) else {
        throw HelperError.invalidArguments("All-day events require YYYY-MM-DD dates")
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = timeZone
    let components = DateComponents(timeZone: timeZone, year: year, month: month, day: day)
    guard let date = calendar.date(from: components) else {
        throw HelperError.invalidArguments("Invalid all-day calendar date")
    }
    let verified = calendar.dateComponents([.year, .month, .day], from: date)
    guard verified.year == year, verified.month == month, verified.day == day else {
        throw HelperError.invalidArguments("Invalid all-day calendar date")
    }
    return date
}

func dateOnlyString(_ value: Date, timeZone: TimeZone) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.locale = Locale(identifier: "en_US_POSIX")
    calendar.timeZone = timeZone
    let components = calendar.dateComponents([.year, .month, .day], from: value)
    return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
}

func isoDateTime(_ value: String) throws -> Date {
    guard value.range(
        of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"#,
        options: .regularExpression
    ) != nil else {
        throw HelperError.invalidArguments("Timed events require an ISO-8601 date-time with a time zone")
    }
    guard let date = makeISOFormatter(fractional: true).date(from: value) ?? makeISOFormatter(fractional: false).date(from: value) else {
        throw HelperError.invalidArguments("Invalid ISO-8601 date-time")
    }
    return date
}

func isoString(_ value: Date) -> String { makeISOFormatter(fractional: true).string(from: value) }

func makeISOFormatter(fractional: Bool) -> ISO8601DateFormatter {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = fractional ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
    return formatter
}

func hexColor(_ color: CGColor?) -> String? {
    guard let components = color?.components, components.count >= 3 else { return nil }
    return String(format: "#%02X%02X%02X", Int(components[0] * 255), Int(components[1] * 255), Int(components[2] * 255))
}

func emit<T: Encodable>(_ value: T) throws {
    let data = try JSONEncoder().encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}
