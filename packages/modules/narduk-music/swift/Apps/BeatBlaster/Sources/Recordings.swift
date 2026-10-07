import AVFoundation
import Foundation

/// One saved take: an AAC `.m4a` in the app's Documents folder (nothing leaves the device unless the child shares it).
struct Recording: Identifiable, Equatable {
    let url: URL
    let date: Date
    let seconds: Double
    var bytes = 0
    var id: URL { url }
    var name: String { url.deletingPathExtension().lastPathComponent }

    /// The name a child reads: the time stamp a new take carries is dropped (the row shows the date on its own line).
    var title: String {
        let stamp = #/ \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}( \d+)?$/#
        let trimmed = name.replacing(stamp, with: "")
        return trimmed.isEmpty ? name : trimmed
    }

    /// "Today 4:02 PM", "Yesterday 9:15 AM" or "Oct 3, 9:15 AM", plus the length.
    var detail: String {
        let calendar = Calendar.current
        let time = date.formatted(date: .omitted, time: .shortened)
        let day =
            calendar.isDateInToday(date)
            ? "Today \(time)"
            : calendar.isDateInYesterday(date)
                ? "Yesterday \(time)" : date.formatted(.dateTime.month(.abbreviated).day().hour().minute())
        return "\(day) · \(clockText(seconds))"
    }
}

/// Where takes are kept, newest first. The directory is injectable so the tests use a temporary one.
struct RecordingStore {
    let directory: URL
    /// Takes shorter than this are left out of the list, so the near-empty takes older builds saved stay on disk but
    /// out of the way. Below `BlasterAudio.minTakeSeconds` (2) because a take's file runs a little shorter than its clock.
    var shortest: Double = 1.5

    static var standard: RecordingStore {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return RecordingStore(directory: documents.appendingPathComponent("Recordings", isDirectory: true))
    }

    /// A file name safe on every file system: no separators or reserved characters, never empty, never long.
    static func cleanName(_ raw: String) -> String {
        let banned = CharacterSet(charactersIn: "/\\:?%*|\"<>").union(.controlCharacters)
        let cleaned = raw.components(separatedBy: banned).joined().trimmingCharacters(in: .whitespacesAndNewlines)
        let limited = String(cleaned.prefix(60)).trimmingCharacters(in: .whitespacesAndNewlines)
        return limited.isEmpty ? "My song" : limited
    }

    /// A fresh, unused path for a take of `title` (the time keeps two takes of one song apart).
    func newTakeURL(title: String, date: Date = Date()) -> URL {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH.mm.ss"
        return unusedURL(stem: "\(Self.cleanName(title)) \(formatter.string(from: date))")
    }

    /// `list()` off the main actor: it opens every take to read its length, and a child can have hundreds.
    func load(sweep: Bool = false) async -> [Recording] {
        let store = self
        return await Task.detached(priority: .userInitiated) { store.list(sweep: sweep) }.value
    }

    /// The takes worth showing. With `sweep`, the near-empty ones (older builds saved them) are deleted on the way, unless
    /// written in the last minute: that one may be a take still being finished.
    func list(sweep: Bool = false, now: Date = Date()) -> [Recording] {
        let keys: [URLResourceKey] = [.contentModificationDateKey, .fileSizeKey]
        let files =
            (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys)) ?? []
        return files.filter { $0.pathExtension == "m4a" }
            .compactMap { url -> Recording? in
                let values = try? url.resourceValues(forKeys: Set(keys))
                let date = values?.contentModificationDate ?? now
                let seconds = Self.duration(of: url)
                guard seconds > 0, seconds >= shortest else {
                    if sweep, now.timeIntervalSince(date) > 60 { try? FileManager.default.removeItem(at: url) }
                    return nil
                }
                return Recording(url: url, date: date, seconds: seconds, bytes: values?.fileSize ?? 0)
            }
            .sorted { $0.date > $1.date }
    }

    /// Renames to `name` (cleaned); a clash gets a number. Returns the new URL.
    @discardableResult func rename(_ recording: Recording, to name: String) throws -> URL {
        let clean = Self.cleanName(name)
        guard clean != recording.name else { return recording.url }
        let target = unusedURL(stem: clean)
        try FileManager.default.moveItem(at: recording.url, to: target)
        return target
    }

    func delete(_ recording: Recording) {
        try? FileManager.default.removeItem(at: recording.url)
    }

    /// Where share copies go: one folder per copy, so two takes of one song can be shared together.
    static var shareFolder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("Share", isDirectory: true)
    }

    /// A copy named for the song alone ("Rocket Party.m4a", not the stamped file name), to send to someone.
    static func shareCopy(of recording: Recording) throws -> URL {
        let folder = shareFolder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let copy = folder.appendingPathComponent(cleanName(recording.title)).appendingPathExtension("m4a")
        try FileManager.default.copyItem(at: recording.url, to: copy)
        return copy
    }

    /// Share copies are only needed while the share sheet sends them.
    static func clearShareCopies() {
        try? FileManager.default.removeItem(at: shareFolder)
    }

    static func duration(of url: URL) -> Double {
        guard let file = try? AVAudioFile(forReading: url), file.processingFormat.sampleRate > 0 else { return 0 }
        return Double(file.length) / file.processingFormat.sampleRate
    }

    private func unusedURL(stem: String) -> URL {
        var candidate = directory.appendingPathComponent(stem).appendingPathExtension("m4a")
        var n = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = directory.appendingPathComponent("\(stem) \(n)").appendingPathExtension("m4a")
            n += 1
        }
        return candidate
    }
}

/// The order My Songs lists takes in.
enum RecordingSort: String, CaseIterable, Identifiable {
    case newest = "Newest"
    case oldest = "Oldest"
    case longest = "Longest"
    case name = "A to Z"
    var id: String { rawValue }

    /// Sorted, and narrowed to titles containing `search` (any case) when there is one.
    func apply(_ recordings: [Recording], search: String = "") -> [Recording] {
        let query = search.trimmingCharacters(in: .whitespaces)
        let found = query.isEmpty ? recordings : recordings.filter { $0.title.localizedStandardContains(query) }
        switch self {
        case .newest: return found.sorted { $0.date > $1.date }
        case .oldest: return found.sorted { $0.date < $1.date }
        case .longest: return found.sorted { $0.seconds > $1.seconds }
        case .name: return found.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        }
    }
}

/// "12 songs · 34 MB": how much My Songs holds.
func libraryText(_ recordings: [Recording]) -> String {
    let count = recordings.count == 1 ? "1 song" : "\(recordings.count) songs"
    let size = ByteCountFormatter.string(
        fromByteCount: Int64(recordings.reduce(0) { $0 + $1.bytes }), countStyle: .file)
    return "\(count) · \(size)"
}

/// mm:ss, or h:mm:ss once a take passes an hour.
func clockText(_ seconds: Double) -> String {
    let total = max(0, Int(seconds))
    let (hours, minutes, secs) = (total / 3600, (total % 3600) / 60, total % 60)
    return hours > 0
        ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%02d:%02d", minutes, secs)
}
