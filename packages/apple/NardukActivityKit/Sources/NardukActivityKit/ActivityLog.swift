import Foundation

/// Day files of JSON lines under one folder on this Mac. Nothing here sends anything anywhere.
public actor ActivityLog {
    public let folder: URL
    /// Days kept before the oldest files are removed.
    public let keepDays: Int
    private let calendar: Calendar
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(folder: URL, keepDays: Int = 90, timeZone: TimeZone = .current) {
        self.folder = folder
        self.keepDays = keepDays
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        self.calendar = calendar
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = .sortedKeys
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
    }

    public func append(_ events: [ActivityEvent]) throws {
        guard !events.isEmpty else { return }
        try FileManager.default.createDirectory(
            at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        for (day, group) in Dictionary(grouping: events, by: { fileName(for: $0.t) }) {
            var data = Data()
            for event in group {
                data.append(try encoder.encode(event))
                data.append(0x0A)
            }
            let url = folder.appending(path: day)
            if let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } else {
                try data.write(to: url, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            }
        }
    }

    /// Events from the last `days` days, oldest first. A line that does not decode is skipped, never fatal.
    public func events(days: Int, now: Date = .now) -> [ActivityEvent] {
        guard let start = calendar.date(byAdding: .day, value: -(days - 1), to: calendar.startOfDay(for: now))
        else { return [] }
        let earliest = fileName(for: start)
        return dayFiles().filter { $0 >= earliest }.flatMap { name -> [ActivityEvent] in
            guard let data = try? Data(contentsOf: folder.appending(path: name)) else { return [] }
            return data.split(separator: 0x0A).compactMap { try? decoder.decode(ActivityEvent.self, from: Data($0)) }
        }.sorted { $0.t < $1.t }
    }

    /// Remove day files older than `keepDays`, judged by the date in each file's name.
    public func prune(now: Date = .now) throws {
        guard let cutoff = calendar.date(byAdding: .day, value: -keepDays, to: calendar.startOfDay(for: now))
        else { return }
        let oldest = fileName(for: cutoff)
        for name in dayFiles() where name < oldest {
            try FileManager.default.removeItem(at: folder.appending(path: name))
        }
    }

    public func clear() throws {
        for name in dayFiles() { try FileManager.default.removeItem(at: folder.appending(path: name)) }
    }

    /// Every kept day in one JSON-lines file, for the person to send on if they choose.
    public func export(to url: URL) throws {
        var data = Data()
        for name in dayFiles() {
            if let day = try? Data(contentsOf: folder.appending(path: name)) { data.append(day) }
        }
        try data.write(to: url, options: .atomic)
    }

    func fileName(for date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d.jsonl", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    private func dayFiles() -> [String] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        return names.filter { $0.count == 16 && $0.hasSuffix(".jsonl") }.sorted()
    }
}
