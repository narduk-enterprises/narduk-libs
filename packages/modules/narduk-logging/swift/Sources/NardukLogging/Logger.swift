import Foundation
import Logging
import Synchronization

public struct LogDiagnostics: Sendable {
    public var emitted = 0
    public var sinkFailures = 0
    public var dropped = 0
}

private enum SinkCallContext {
    @TaskLocal static var active: Set<UUID> = []
}

final class LoggerState: Sendable {
    struct Status: Sendable {
        var closed = false
        var diagnostics = LogDiagnostics()
    }
    let options: LoggerOptions
    let sinks: [any LogSink]
    let id = UUID()
    let status = Mutex(Status())

    init(options: LoggerOptions, sinks: [any LogSink]) {
        self.options = options
        self.sinks = sinks
    }

    func emit(
        level: LogLevel, message: String, fields: [String: LogValue],
        context: LogContext, scope: String?
    ) {
        guard options.level != .silent else { return }
        guard status.withLock({ !$0.closed }), !SinkCallContext.active.contains(id) else {
            status.withLock { $0.diagnostics.dropped += 1 }
            return
        }
        SinkCallContext.$active.withValue(SinkCallContext.active.union([id])) {
            var fields = LogSanitizer.fields(fields, redact: options.redact)
            let error = fields.removeValue(forKey: "error").map { LogSanitizer.errorFields($0) }
            let merged = context.data.merging(fields, uniquingKeysWith: { _, new in new })
            var record = LogRecord(
                schemaVersion: 1,
                timestamp: options.clock().formatted(
                    .iso8601.year().month().day().dateSeparator(.dash)
                        .time(includingFractionalSeconds: true).timeSeparator(.colon).timeZone(
                            separator: .omitted)),
                level: level, message: LogSanitizer.clean(message), service: options.service,
                environment: options.environment, runtime: options.runtime,
                release: options.release,
                scope: scope, requestId: context.requestId, operationId: context.operationId,
                traceId: context.traceId, spanId: context.spanId, method: context.method,
                path: context.path,
                source: context.source, data: merged.isEmpty ? nil : merged, error: error
            )
            do {
                if try record.encoded().count > LogSanitizer.maxRecordBytes {
                    record.data = ["truncated": true]
                    if let error {
                        record.error = [
                            "name": error["name"] ?? "Error",
                            "message": error["message"] ?? "Error",
                        ]
                    }
                }
                if try record.encoded().count > LogSanitizer.maxRecordBytes {
                    record.message = LogSanitizer.clean(record.message, limit: 512)
                    if record.error != nil {
                        record.error = ["name": "Error", "message": "[Truncated error]"]
                    }
                }
                status.withLock { $0.diagnostics.emitted += 1 }
                for sink in sinks {
                    do { try sink.write(record) } catch {
                        status.withLock { $0.diagnostics.sinkFailures += 1 }
                    }
                }
            } catch { status.withLock { $0.diagnostics.dropped += 1 } }
        }
    }
}

private struct FieldsBox: CustomStringConvertible, Sendable {
    let fields: [String: LogValue]
    var description: String { "[Structured fields]" }
}

/// Privacy attribute for callers using the swift-log compatibility logger directly.
public enum LogPrivacy: Int64, Logging.Logger.MetadataValueAttributes.Attribute {
    case `public` = 0
    case `private` = 1
}

private struct NardukLogHandler: LogHandler {
    let state: LoggerState
    let context: LogContext
    let scope: String?
    var logLevel: Logging.Logger.Level
    var metadata: Logging.Logger.Metadata = [:]
    var metadataProvider: Logging.Logger.MetadataProvider?

    subscript(metadataKey key: String) -> Logging.Logger.Metadata.Value? {
        get { metadata[key] }
        set { metadata[key] = newValue }
    }

    func log(event: LogEvent) {
        var fields: [String: LogValue] = [:]
        let values = metadata.merging(
            metadataProvider?.get() ?? [:], uniquingKeysWith: { _, new in new }
        )
        .merging(event.metadata ?? [:], uniquingKeysWith: { _, new in new })
        for (key, value) in values.prefix(50) {
            if key == "__narduk_fields", case .stringConvertible(let box) = value,
                let box = box as? FieldsBox
            {
                fields.merge(box.fields, uniquingKeysWith: { _, new in new })
            } else {
                fields[key] = convert(value)
            }
        }
        if let error = event.error { fields["error"] = .object(LogSanitizer.error(error)) }
        state.emit(
            level: event.level.nardukLevel, message: event.message.description,
            fields: fields, context: context, scope: scope)
    }

    private func convert(_ value: Logging.Logger.Metadata.Value, depth: Int = 0) -> LogValue {
        guard depth < 6 else { return "[Truncated]" }
        if value.attributes[LogPrivacy.self] == .private { return "[REDACTED]" }
        if value.attributes[LogPrivacy.self] == .public { return .string(value.description) }
        switch value {
        case .string(let string): return .string(string)
        case .stringConvertible(let value):
            // Opaque descriptions may reveal object internals. An attributed public string is explicit.
            if let string = value as? String { return .string(string) }
            return "[Unsupported object]"
        case .dictionary(let fields):
            return .object(
                Dictionary(
                    uniqueKeysWithValues: fields.prefix(50).map {
                        ($0.key, convert($0.value, depth: depth + 1))
                    }))
        case .array(let values):
            return .array(values.prefix(50).map { convert($0, depth: depth + 1) })
        }
    }
}

extension Logging.Logger.Level {
    var nardukLevel: LogLevel {
        switch self {
        case .trace: .trace
        case .debug: .debug
        case .info, .notice: .info
        case .warning: .warn
        case .error: .error
        case .critical: .fatal
        }
    }
}

extension LogLevel {
    var swiftLevel: Logging.Logger.Level {
        switch self {
        case .trace: .trace
        case .debug: .debug
        case .info: .info
        case .warn: .warning
        case .error: .error
        case .fatal, .silent: .critical
        }
    }
}

public struct NardukLogger: Sendable {
    private let state: LoggerState
    private let context: LogContext
    private let scope: String?
    private let engine: Logging.Logger

    fileprivate init(state: LoggerState, context: LogContext = .init(), scope: String? = nil) {
        self.state = state
        self.context = context
        self.scope = scope
        engine = Logging.Logger(label: state.options.service) { _ in
            NardukLogHandler(
                state: state, context: context, scope: scope,
                logLevel: state.options.level.swiftLevel)
        }
    }

    public var diagnostics: LogDiagnostics { state.status.withLock { $0.diagnostics } }
    public func asSwiftLog() -> Logging.Logger { engine }
    public func trace(_ message: String, _ data: [String: LogValue] = [:]) {
        log(.trace, message, data)
    }
    public func debug(_ message: String, _ data: [String: LogValue] = [:]) {
        log(.debug, message, data)
    }
    public func info(_ message: String, _ data: [String: LogValue] = [:]) {
        log(.info, message, data)
    }
    public func warn(_ message: String, _ data: [String: LogValue] = [:]) {
        log(.warn, message, data)
    }
    public func error(_ message: String, _ data: [String: LogValue] = [:]) {
        log(.error, message, data)
    }
    public func fatal(_ message: String, _ data: [String: LogValue] = [:]) {
        log(.fatal, message, data)
    }

    private func log(_ level: LogLevel, _ message: String, _ data: [String: LogValue]) {
        guard level.priority >= state.options.level.priority else { return }
        engine.log(
            level: level.swiftLevel, .init(stringLiteral: message),
            metadata: ["__narduk_fields": .stringConvertible(FieldsBox(fields: data))])
    }

    public func withContext(_ next: LogContext) -> NardukLogger {
        let next = LogSanitizer.context(next, redact: state.options.redact)
        let merged = LogContext(
            requestId: next.requestId ?? context.requestId,
            operationId: next.operationId ?? context.operationId,
            traceId: next.traceId ?? context.traceId, spanId: next.spanId ?? context.spanId,
            method: next.method ?? context.method, path: next.path ?? context.path,
            source: next.source ?? context.source,
            data: context.data.merging(next.data, uniquingKeysWith: { _, new in new })
        )
        return NardukLogger(state: state, context: merged, scope: scope)
    }

    public func child(_ scope: String, context: LogContext = .init()) -> NardukLogger {
        NardukLogger(
            state: state, context: withContext(context).context,
            scope: LogSanitizer.clean(self.scope.map { "\($0).\(scope)" } ?? scope, limit: 256))
    }

    public func operation<T>(
        _ name: String, data: [String: LogValue] = [:],
        work: (NardukLogger) throws -> T
    ) rethrows -> T {
        let child = withContext(.init(operationId: UUID().uuidString.lowercased()))
        let start = ContinuousClock.now
        do {
            let result = try work(child)
            child.summary(name, start: start, data: data, error: nil)
            return result
        } catch {
            child.summary(name, start: start, data: data, error: error)
            throw error
        }
    }

    public func operation<T>(
        _ name: String, data: [String: LogValue] = [:],
        work: (NardukLogger) async throws -> T
    ) async rethrows -> T {
        let child = withContext(.init(operationId: UUID().uuidString.lowercased()))
        let start = ContinuousClock.now
        do {
            let result = try await work(child)
            child.summary(name, start: start, data: data, error: nil)
            return result
        } catch {
            child.summary(name, start: start, data: data, error: error)
            throw error
        }
    }

    private func summary(
        _ name: String, start: ContinuousClock.Instant,
        data: [String: LogValue], error: (any Error)?
    ) {
        let duration = start.duration(to: .now).components
        var fields = data.merging(
            [
                "operation": .string(name),
                "outcome": .string(error == nil ? "success" : "failure"),
                "durationMs": .number(
                    Double(duration.seconds) * 1000 + Double(duration.attoseconds) / 1e15),
            ], uniquingKeysWith: { _, new in new })
        if let error {
            fields["error"] = .object(LogSanitizer.error(error))
            self.error("Operation failed", fields)
        } else {
            info("Operation completed", fields)
        }
    }

    public func flush() async {
        for sink in state.sinks {
            do { try await sink.flush() } catch {
                state.status.withLock { $0.diagnostics.sinkFailures += 1 }
            }
        }
    }

    public func close() async {
        guard
            state.status.withLock({ status in
                if status.closed { return false }
                status.closed = true
                return true
            })
        else { return }
        for sink in state.sinks {
            do { try await sink.close() } catch {
                state.status.withLock { $0.diagnostics.sinkFailures += 1 }
            }
        }
    }
}

/// Creates an isolated swift-log instance. Never calls LoggingSystem.bootstrap.
public func createLogger(_ options: LoggerOptions, sinks: [any LogSink]? = nil) -> NardukLogger {
    NardukLogger(
        state: LoggerState(
            options: options,
            sinks: sinks ?? [StreamSink(pretty: options.environment == "development")]))
}
