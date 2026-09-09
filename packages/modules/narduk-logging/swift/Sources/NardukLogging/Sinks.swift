import Foundation
import Synchronization

#if canImport(OSLog)
    import OSLog
#endif

/// write receives only sanitized value snapshots. Remote sinks enqueue synchronously.
public protocol LogSink: Sendable {
    func write(_ record: LogRecord) throws
    func flush() async throws
    func close() async throws
}

extension LogSink {
    public func flush() async throws {}
    public func close() async throws { try await flush() }
}

public final class MemorySink: LogSink {
    private let storage = Mutex<[LogRecord]>([])
    private let limit: Int
    public init(limit: Int = 1000) { self.limit = max(1, limit) }
    public var records: [LogRecord] { storage.withLock { $0 } }
    public func clear() { storage.withLock { $0.removeAll() } }
    public func write(_ record: LogRecord) {
        storage.withLock { records in
            if records.count == limit { records.removeFirst() }
            records.append(record)
        }
    }
}

public final class StreamSink: LogSink {
    private let stream: Mutex<FileHandle>
    private let pretty: Bool
    public init(stream: FileHandle = .standardError, pretty: Bool = false) {
        self.stream = Mutex(stream)
        self.pretty = pretty
    }
    public func write(_ record: LogRecord) throws {
        var data = try record.encoded()
        if pretty {
            let prefix =
                "\(record.timestamp) \(record.level.rawValue.uppercased()) \(record.service) \(record.message) "
            data = Data(prefix.utf8) + data
        }
        data.append(10)
        try stream.withLock { try $0.write(contentsOf: data) }
    }
    // FileHandle writes directly. The caller owns the handle; close never closes stderr or a file.
}

#if canImport(OSLog)
    public struct OSLogSink: LogSink {
        private let logger: Logger
        public init(subsystem: String, category: String = "narduk") {
            logger = Logger(subsystem: subsystem, category: category)
        }
        public func write(_ record: LogRecord) throws {
            let line = String(decoding: try record.encoded(), as: UTF8.self)
            let level: OSLogType
            switch record.level {
            case .trace, .debug: level = .debug
            case .info: level = .info
            case .warn: level = .default
            case .error: level = .error
            case .fatal: level = .fault
            case .silent: return
            }
            // Private metadata was removed before reaching this sink, including in debug builds.
            logger.log(level: level, "\(line, privacy: .public)")
        }
    }
#endif
