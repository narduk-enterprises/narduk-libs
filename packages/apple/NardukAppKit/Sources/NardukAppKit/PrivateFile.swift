import Foundation

/// Owner-only app data on disk: the folder is 0700, the file 0600, and a write replaces the file atomically, so a crash
/// leaves the old file or the new one and never half of either.
public enum PrivateFile {
    public static func createFolder(at url: URL) throws {
        try FileManager.default.createDirectory(
            at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }

    public static func write(_ data: Data, to url: URL) throws {
        try createFolder(at: url.deletingLastPathComponent())
        try data.write(to: url, options: .atomic)
        try restrict(url)
    }

    /// Copies a file into an owner-only folder. The source is left as it was.
    public static func copy(from source: URL, to destination: URL) throws {
        try createFolder(at: destination.deletingLastPathComponent())
        try FileManager.default.copyItem(at: source, to: destination)
        try restrict(destination)
    }

    private static func restrict(_ url: URL) throws {
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}
