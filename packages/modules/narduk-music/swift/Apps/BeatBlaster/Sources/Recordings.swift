import AVFoundation
import Foundation

/// One saved take: an AAC `.m4a` in the app's Documents folder (nothing leaves the device unless the child shares it).
struct Recording: Identifiable, Equatable {
    let url: URL
    let date: Date
    let seconds: Double
    var id: URL { url }
    var name: String { url.deletingPathExtension().lastPathComponent }
}

/// Where takes are kept, newest first. The directory is injectable so the tests use a temporary one.
struct RecordingStore {
    let directory: URL

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

    func list() -> [Recording] {
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        let files =
            (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys)) ?? []
        return files.filter { $0.pathExtension == "m4a" }
            .compactMap { url -> Recording? in
                let seconds = Self.duration(of: url)
                guard seconds > 0 else { return nil }
                let date = (try? url.resourceValues(forKeys: Set(keys)).contentModificationDate) ?? Date()
                return Recording(url: url, date: date, seconds: seconds)
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

/// mm:ss, or h:mm:ss once a take passes an hour.
func clockText(_ seconds: Double) -> String {
    let total = max(0, Int(seconds))
    let (hours, minutes, secs) = (total / 3600, (total % 3600) / 60, total % 60)
    return hours > 0
        ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%02d:%02d", minutes, secs)
}
