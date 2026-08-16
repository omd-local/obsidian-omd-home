import EventKit
import Foundation
import Darwin

struct CalendarsResponse: Encodable { let ok = true; let calendars: [CalendarDescriptor] }
struct EventsResponse: Encodable { let ok = true; let events: [EventRecord] }
struct EventResponse: Encodable { let ok = true; let event: EventRecord }
struct OkResponse: Encodable { let ok = true }
struct VersionResponse: Encodable { let ok = true; let version = 1 }

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
    var syncState: String?
    var readOnly: Bool?
}

enum HelperError: LocalizedError {
    case invalidArguments(String)
    case permissionDenied
    case calendarNotFound
    case eventNotFound

    var errorDescription: String? {
        switch self {
        case .invalidArguments(let detail): return detail
        case .permissionDenied: return "Calendar access was not granted in System Settings"
        case .calendarNotFound: return "The selected Calendar is unavailable or no longer writable"
        case .eventNotFound: return "The Calendar event no longer exists"
        }
    }
}

@main
struct OmdEventKit {
    static func main() async {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let command = arguments.first else { throw HelperError.invalidArguments("Expected version, calendars, events, upsert, or delete") }
            if command == "version" {
                try emit(VersionResponse())
                return
            }
            let store = EKEventStore()
            guard try await store.requestFullAccessToEvents() else { throw HelperError.permissionDenied }
            switch command {
            case "calendars": try outputCalendars(store)
            case "events": try outputEvents(store, arguments: Array(arguments.dropFirst()))
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
        let start = try isoDate(value(after: "--start", in: arguments))
        let end = try isoDate(value(after: "--end", in: arguments))
        let ids = Set(try value(after: "--calendars", in: arguments).split(separator: ",").map(String.init))
        let calendars = store.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
        let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let events = store.events(matching: predicate).map(eventRecord)
        try emit(EventsResponse(events: events))
    }

    static func upsertEvent(_ store: EKEventStore, arguments: [String]) throws {
        let span = spanValue(try optionalValue(after: "--span", in: arguments) ?? "this")
        let input = try JSONDecoder().decode(EventRecord.self, from: FileHandle.standardInput.readDataToEndOfFile())
        let event: EKEvent
        if let identifier = input.appleItemId, let existing = store.event(withIdentifier: identifier) {
            event = existing
        } else {
            event = EKEvent(eventStore: store)
            guard let calendarId = input.appleCalendarId,
                  let calendar = store.calendar(withIdentifier: calendarId),
                  calendar.allowsContentModifications else { throw HelperError.calendarNotFound }
            event.calendar = calendar
        }
        event.title = input.title
        event.startDate = try isoDate(input.start)
        event.endDate = try isoDate(input.end)
        event.isAllDay = input.allDay
        event.location = input.location
        try store.save(event, span: span, commit: true)
        try emit(EventResponse(event: eventRecord(event)))
    }

    static func deleteEvent(_ store: EKEventStore, arguments: [String]) throws {
        let identifier = try value(after: "--id", in: arguments)
        guard let event = store.event(withIdentifier: identifier) else { throw HelperError.eventNotFound }
        try store.remove(event, span: spanValue(try optionalValue(after: "--span", in: arguments) ?? "this"), commit: true)
        try emit(OkResponse())
    }
}

func eventRecord(_ event: EKEvent) -> EventRecord {
    EventRecord(
        id: "apple:\(event.eventIdentifier ?? event.calendarItemIdentifier)",
        title: event.title ?? "Untitled event",
        start: isoString(event.startDate),
        end: isoString(event.endDate),
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
        syncState: "clean",
        readOnly: !event.calendar.allowsContentModifications
    )
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

func isoDate(_ value: String) throws -> Date {
    guard let date = makeISOFormatter(fractional: true).date(from: value) ?? makeISOFormatter(fractional: false).date(from: value) else {
        throw HelperError.invalidArguments("Invalid ISO-8601 date")
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
