import Foundation
import Synchronization

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

public struct BufferStats: Sendable {
    public var buffered = 0
    public var bytes = 0
    public var delivered = 0
    public var dropped = 0
    public var deliveryFailures = 0
}

/// A single owned delivery task drains a synchronous bounded queue.
/// A custom sender must honor the supplied timeout and Swift task cancellation.
public final class BufferedSink: LogSink {
    public typealias Sender = @Sendable ([LogRecord], Duration) async throws -> Void
    private struct Item: Sendable {
        let record: LogRecord
        let bytes: Int
    }
    private struct State: Sendable {
        var queue: [Item] = []
        var stats = BufferStats()
        var closed = false
        var draining = false
    }
    private let state = Mutex(State())
    private let worker = Mutex<Task<Void, Never>?>(nil)
    private let send: Sender
    private let timeout: Duration
    private let shutdownTimeout: Duration
    private let onClose: @Sendable () -> Void

    public init(
        interval: Duration = .seconds(5), timeout: Duration = .seconds(2),
        shutdownTimeout: Duration = .seconds(3), automaticFlush: Bool = true,
        onClose: @escaping @Sendable () -> Void = {}, send: @escaping Sender
    ) throws {
        guard interval > .zero, timeout > .zero, shutdownTimeout > .zero else {
            throw LoggingConfigurationError.invalidLimit
        }
        self.send = send
        self.timeout = min(timeout, .seconds(10))
        self.shutdownTimeout = min(shutdownTimeout, .seconds(10))
        self.onClose = onClose
        if automaticFlush {
            let interval = min(interval, .seconds(60))
            worker.withLock { task in
                task = Task { [weak self] in
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: interval) } catch { return }
                        guard let self else { return }
                        await self.flush()
                    }
                }
            }
        }
    }

    deinit {
        worker.withLock { $0?.cancel() }
        onClose()
    }
    public var stats: BufferStats { state.withLock { $0.stats } }

    public func write(_ record: LogRecord) throws {
        let bytes = try record.encoded().count
        state.withLock { state in
            guard !state.closed, bytes <= LogSanitizer.maxRecordBytes,
                state.stats.buffered < 100, state.stats.bytes + bytes <= 1024 * 1024
            else {
                state.stats.dropped += 1
                return
            }
            state.queue.append(Item(record: record, bytes: bytes))
            state.stats.buffered += 1
            state.stats.bytes += bytes
        }
    }

    public func flush() async {
        let deadline = ContinuousClock.now + shutdownTimeout
        while !state.withLock({ state in
            guard !state.draining else { return false }
            state.draining = true
            return true
        }) {
            guard ContinuousClock.now < deadline, !Task.isCancelled else { return }
            do { try await Task.sleep(for: .milliseconds(10)) } catch { return }
        }
        defer { state.withLock { $0.draining = false } }
        var remaining = state.withLock { $0.queue.count }
        while remaining > 0, ContinuousClock.now < deadline, !Task.isCancelled {
            let batch: [Item] = state.withLock { state in
                var items: [Item] = []
                var bytes = 0
                while !state.queue.isEmpty, items.count < min(10, remaining) {
                    let next = state.queue[0]
                    guard bytes + next.bytes <= 63 * 1024 else { break }
                    bytes += next.bytes
                    items.append(state.queue.removeFirst())
                }
                return items
            }
            guard !batch.isEmpty else { break }
            remaining -= batch.count
            var delivered = false
            for attempt in 0..<3 {
                guard ContinuousClock.now < deadline, !Task.isCancelled else { break }
                do {
                    try await send(
                        batch.map(\.record),
                        min(timeout, ContinuousClock.now.duration(to: deadline)))
                    delivered = true
                    break
                } catch {
                    state.withLock { $0.stats.deliveryFailures += 1 }
                    if attempt < 2, !Task.isCancelled {
                        do {
                            try await Task.sleep(
                                for: min(
                                    .milliseconds(100 * (attempt + 1)),
                                    ContinuousClock.now.duration(to: deadline)))
                        } catch { break }
                    }
                }
            }
            state.withLock { state in
                state.stats.buffered -= batch.count
                state.stats.bytes -= batch.reduce(0) { $0 + $1.bytes }
                if delivered {
                    state.stats.delivered += batch.count
                } else {
                    state.stats.dropped += batch.count
                }
            }
        }
    }

    public func close() async {
        guard
            state.withLock({ state in
                if state.closed { return false }
                state.closed = true
                return true
            })
        else { return }
        worker.withLock {
            $0?.cancel()
            $0 = nil
        }
        await flush()
        state.withLock { state in
            state.stats.dropped += state.queue.count
            state.stats.buffered -= state.queue.count
            state.stats.bytes -= state.queue.reduce(0) { $0 + $1.bytes }
            state.queue.removeAll()
        }
        onClose()
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? { nil }
}

private struct ClientBatch: Encodable {
    let schemaVersion = 1
    let records: [LogRecord]
}
private enum ClientDeliveryError: Error { case rejected }

/// Call only after app-level diagnostics consent/enablement. The endpoint belongs to your app.
/// Authentication comes from the app's existing session; collector credentials never enter clients.
public func createClientDiagnosticsSink(
    endpoint: URL, headers: @escaping @Sendable () -> [String: String] = { [:] }
) throws -> BufferedSink {
    guard let components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false),
        let host = components.host, components.user == nil, components.password == nil,
        components.query == nil, components.fragment == nil,
        components.scheme == "https"
            || (components.scheme == "http"
                && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host))
    else { throw LoggingConfigurationError.invalidEndpoint }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpMaximumConnectionsPerHost = 1
    configuration.timeoutIntervalForResource = 2
    configuration.timeoutIntervalForRequest = 2
    let session = URLSession(
        configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    return try BufferedSink(
        onClose: { session.invalidateAndCancel() },
        send: { records, timeout in
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.allHTTPHeaderFields = headers()
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let duration = timeout.components
            request.timeoutInterval = max(
                0.01, Double(duration.seconds) + Double(duration.attoseconds) / 1e18)
            request.httpBody = try JSONEncoder().encode(ClientBatch(records: records))
            let (_, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse,
                (200..<300).contains(response.statusCode)
            else {
                throw ClientDeliveryError.rejected
            }
        })
}
