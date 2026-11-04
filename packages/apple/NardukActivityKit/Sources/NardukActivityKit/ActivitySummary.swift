import Foundation

/// What the Activity window shows: deliberately short, most-used first.
public struct ActivitySummary<Feature: ActivityTaxonomy, Region: ActivityTaxonomy>: Sendable {
    public struct Count: Equatable, Sendable {
        public let id: String
        public let title: String
        public let value: Double
    }
    public var sessions = 0
    /// Seconds between each session's first and last event.
    public var activeSeconds: Double = 0
    public var features: [Count] = []
    public var unusedFeatures: [Feature] = []
    public var regions: [Count] = []
    public var subjects: [Count] = []
    public var isEmpty: Bool { sessions == 0 && features.isEmpty && regions.isEmpty }

    /// A pause this long between events starts a new session.
    public static var sessionGap: TimeInterval { 15 * 60 }

    public init(events: [ActivityEvent]) {
        let sorted = events.sorted { $0.t < $1.t }
        // Only what the person did marks time; flushed samples and layouts are stamped when written.
        let marks = sorted.filter { [.session, .feature, .dwell, .click, .subject].contains($0.kind) }
        var previous: ActivityEvent?
        for event in marks {
            if let previous, event.t.timeIntervalSince(previous.t) <= Self.sessionGap {
                // Time after the app stopped being active is not active time.
                if !(previous.kind == .session && previous.name == "end") {
                    activeSeconds += event.t.timeIntervalSince(previous.t)
                }
            } else {
                sessions += 1
            }
            previous = event
        }

        var featureCounts: [String: Double] = [:]
        var regionSeconds: [String: Double] = [:]
        var subjectSeconds: [String: Double] = [:]
        for event in sorted {
            switch event.kind {
            case .feature: if let name = event.name { featureCounts[name, default: 0] += 1 }
            case .dwell:
                guard let name = event.name, let duration = event.duration, duration > 0 else { continue }
                regionSeconds[name, default: 0] += duration
                if let subject = event.subject { subjectSeconds[subject, default: 0] += duration }
            default: continue
            }
        }
        features = Self.ranked(featureCounts) { Feature(rawValue: $0)?.title ?? $0 }
        regions = Self.ranked(regionSeconds) { Region(rawValue: $0)?.title ?? $0 }
        subjects = Self.ranked(subjectSeconds) { $0 }
        unusedFeatures = Feature.allCases.filter { featureCounts[$0.rawValue] == nil }
    }

    private static func ranked(_ values: [String: Double], title: (String) -> String) -> [Count] {
        values.map { Count(id: $0.key, title: title($0.key), value: $0.value) }
            .sorted { $0.value == $1.value ? $0.id < $1.id : $0.value > $1.value }
    }
}
