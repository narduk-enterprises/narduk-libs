import Foundation
import Testing

@testable import NardukActivityKit

#if os(macOS)
    import AppKit
#endif

private enum Feature: String, ActivityTaxonomy {
    case open, paste, share
    var title: String {
        switch self {
        case .open: "Open"
        case .paste: "Paste"
        case .share: "Share"
        }
    }
}

private enum Region: String, ActivityTaxonomy {
    case list, detail
    var title: String { self == .list ? "List" : "Detail" }
}

private typealias Summary = ActivitySummary<Feature, Region>

struct ActivitySummaryTests {
    private let start = Date(timeIntervalSince1970: 1_793_700_000)

    private func at(_ seconds: Double) -> Date { start.addingTimeInterval(seconds) }

    @Test func ranksFeaturesAndPanelsAndSplitsSessionsOnLongPauses() {
        let events = [
            ActivityEvent(t: at(0), kind: .session, name: "start"),
            ActivityEvent(t: at(10), kind: .feature, name: Feature.open.rawValue, detail: "a"),
            ActivityEvent(t: at(20), kind: .feature, name: Feature.open.rawValue, detail: "b"),
            ActivityEvent(t: at(30), kind: .feature, name: Feature.paste.rawValue),
            ActivityEvent(t: at(40), kind: .dwell, name: Region.detail.rawValue, subject: "one", duration: 90),
            ActivityEvent(t: at(50), kind: .dwell, name: Region.list.rawValue, subject: "one", duration: 15),
            // An hour later is a new session.
            ActivityEvent(t: at(3_700), kind: .feature, name: "retired"),
        ]
        let summary = Summary(events: events)
        #expect(summary.sessions == 2)
        #expect(summary.activeSeconds == 50)
        #expect(summary.features.map(\.id) == ["open", "paste", "retired"])
        #expect(summary.features.first?.value == 2)
        #expect(summary.features.first?.title == "Open")
        // A name the app no longer has still shows, by its id.
        #expect(summary.features.last?.title == "retired")
        #expect(summary.regions.map(\.title) == ["Detail", "List"])
        #expect(summary.subjects.map(\.id) == ["one"])
        #expect(summary.unusedFeatures == [.share])
    }

    @Test func timeAfterTheAppStopsBeingActiveIsNotActiveTime() {
        let events = [
            ActivityEvent(t: at(0), kind: .session, name: "start"),
            ActivityEvent(t: at(60), kind: .session, name: "end"),
            // Flushed samples after the end do not start or extend a session.
            ActivityEvent(t: at(61), kind: .heat, cells: ["1,1": 3]),
            ActivityEvent(t: at(600), kind: .session, name: "start"),
            ActivityEvent(t: at(630), kind: .feature, name: Feature.open.rawValue),
        ]
        let summary = Summary(events: events)
        #expect(summary.sessions == 1)
        #expect(summary.activeSeconds == 60 + 30)
    }

    @Test func emptyHistoryIsEmptyNotZeroActivity() {
        let summary = Summary(events: [])
        #expect(summary.isEmpty)
        #expect(summary.unusedFeatures.count == Feature.allCases.count)
    }
}

struct ActivityEventFormatTests {
    /// Logs already on disk stay readable and new lines stay the same: the bytes are the format.
    @Test func theJSONLineIsStable() throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = .sortedKeys
        let event = ActivityEvent(t: Date(timeIntervalSince1970: 100), kind: .subject, window: 7, subject: "NVDA")
        let line = String(decoding: try encoder.encode(event), as: UTF8.self)
        #expect(line == #"{"kind":"stock","symbol":"NVDA","t":100,"v":1,"window":7}"#)
    }

    @Test func aLineFromAnEarlierLogDecodes() throws {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        let line = #"{"duration":4.5,"kind":"dwell","name":"chart","symbol":"AAPL","t":100,"v":1,"future":true}"#
        let event = try decoder.decode(ActivityEvent.self, from: Data(line.utf8))
        #expect(event.kind == .dwell)
        #expect(event.subject == "AAPL")
        #expect(event.duration == 4.5)
    }
}

struct ActivityLogTests {
    @Test func appendsReadsExportsPrunesAndClearsDayFiles() async throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: "activity-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        let utc = try #require(TimeZone(identifier: "UTC"))
        let log = ActivityLog(folder: folder, keepDays: 30, timeZone: utc)
        let now = Date(timeIntervalSince1970: 1_793_750_400)  // 2026-11-04 00:00 UTC
        let old = now.addingTimeInterval(-40 * 86_400)
        try await log.append([ActivityEvent(t: old, kind: .feature, name: "open")])
        try await log.append([ActivityEvent(t: now, kind: .feature, name: "paste")])
        try await log.append([ActivityEvent(t: now.addingTimeInterval(60), kind: .subject, subject: "one")])
        // A damaged line is skipped, not fatal.
        let today = folder.appending(path: "2026-11-04.jsonl")
        let handle = try FileHandle(forWritingTo: today)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("{not json\n".utf8))
        try handle.close()

        let recent = await log.events(days: 7, now: now)
        #expect(recent.map(\.kind) == [.feature, .subject])
        #expect(await log.events(days: 60, now: now).count == 3)

        let exported = folder.appending(path: "export.json")
        try await log.export(to: exported)
        #expect(try String(contentsOf: exported, encoding: .utf8).contains("one"))

        try await log.prune(now: now)
        #expect(await log.events(days: 60, now: now).count == 2)
        try await log.clear()
        #expect(await log.events(days: 60, now: now).isEmpty)
    }
}

#if os(macOS)
    @MainActor
    struct ActivityRecorderTests {
        private func recorder() -> (ActivityRecorder, URL) {
            // The recorder reads NSApp, which exists once the shared application does.
            _ = NSApplication.shared
            let folder = FileManager.default.temporaryDirectory.appending(path: "activity-\(UUID().uuidString)")
            return (ActivityRecorder(log: ActivityLog(folder: folder)), folder)
        }

        @Test func nothingIsRecordedWhileRecordingIsOff() async {
            let (recorder, folder) = recorder()
            defer { try? FileManager.default.removeItem(at: folder) }
            recorder.record(feature: Feature.open)
            recorder.subjectShown("one")
            await recorder.written()
            #expect(await recorder.log.events(days: 1).isEmpty)
        }

        @Test func featuresAndSubjectsReachTheLogBetweenSessionMarks() async {
            let (recorder, folder) = recorder()
            defer { try? FileManager.default.removeItem(at: folder) }
            recorder.setRecording(true)
            recorder.record(feature: Feature.paste, detail: "3 rows")
            recorder.subjectShown("one")
            recorder.subjectShown("")
            await recorder.finish()
            let events = await recorder.log.events(days: 1)
            recorder.setRecording(false)
            #expect(events.map(\.kind) == [.session, .feature, .subject, .session])
            #expect(events.first?.name == "start")
            #expect(events.last?.name == "end")
            #expect(events[1].name == "paste")
            #expect(events[1].detail == "3 rows")
        }

        @Test func aClickInARegionIsCountedForThatPanel() async throws {
            let (recorder, folder) = recorder()
            defer { try? FileManager.default.removeItem(at: folder) }
            let window = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 200, height: 100), styleMask: [.titled], backing: .buffered,
                defer: false)
            window.isReleasedWhenClosed = false
            defer { window.close() }
            let view = ActivityRegionView(region: Region.detail.rawValue, recorder: recorder)
            view.subject = "one"
            view.panel.value = CGRect(x: 0, y: 0, width: 100, height: 100)
            window.contentView?.addSubview(view)
            recorder.setRecording(true)
            let click = try #require(
                NSEvent.mouseEvent(
                    with: .leftMouseDown, location: NSPoint(x: 50, y: 50), modifierFlags: [], timestamp: 1,
                    windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1))
            recorder.handle(click)
            await recorder.written()
            recorder.setRecording(false)
            let clicks = await recorder.log.events(days: 1).filter { $0.kind == .click }
            #expect(clicks.count == 1)
            #expect(clicks.first?.name == "detail")
            #expect(clicks.first?.subject == "one")
            #expect(clicks.first?.x == 0.25)
            #expect(clicks.first?.y == 0.5)
        }

        @Test func durationsReadShort() {
            #expect(activityDuration(45) == "45s")
            #expect(activityDuration(720) == "12m")
            #expect(activityDuration(4_320) == "1h 12m")
        }
    }
#endif
