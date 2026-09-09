import Foundation
import Logging
import NardukLogging
import Synchronization
import Testing

private func logger(_ sink: any LogSink, level: LogLevel? = nil) throws -> NardukLogger {
    createLogger(
        try LoggerOptions(
            service: "fixture", environment: "production", level: level,
            clock: { Date(timeIntervalSince1970: 1_788_912_000) }), sinks: [sink])
}

private struct Fixture: Decodable {
    let name: String
    let input: [String: LogValue]
    let expected: [String: LogValue]
}

@Test func sharedPrivacyFixtures() throws {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<4 { root.deleteLastPathComponent() }
    let fixtures = try JSONDecoder().decode(
        [Fixture].self, from: Data(contentsOf: root.appending(path: "schema/fixtures.json")))
    for fixture in fixtures {
        #expect(
            LogSanitizer.fields(fixture.input) == fixture.expected, Comment(rawValue: fixture.name))
    }
}

@Test func levelsAndRepeatedMessages() throws {
    let sink = MemorySink()
    let log = try logger(sink, level: .warn)
    log.trace("Hidden")
    log.debug("Hidden")
    log.info("Hidden")
    log.warn("Visible")
    log.error("Visible")
    log.fatal("Visible")
    #expect(sink.records.map(\.level) == [.warn, .error, .fatal])
    try logger(sink, level: .silent).fatal("Hidden")
    #expect(sink.records.count == 3)
    let repeated = try logger(sink)
    for _ in 0..<12 { repeated.info("Repeated") }
    #expect(sink.records.count == 15)
    #expect(sink.records[0].schemaVersion == 1)
    #expect(sink.records[0].timestamp.hasSuffix("Z"))
}

@Test func concurrentContextsRemainIndependent() async throws {
    let sink = MemorySink()
    let log = try logger(sink)
    await withTaskGroup(of: Void.self) { group in
        for index in 0..<100 {
            let child = log.withContext(
                .init(requestId: String(index), data: ["index": .integer(Int64(index))]))
            group.addTask { child.info("Concurrent") }
        }
    }
    #expect(sink.records.count == 100)
    #expect(Set(sink.records.compactMap(\.requestId)).count == 100)
    log.info("Root")
    #expect(sink.records.last?.requestId == nil)
}

@Test func boundValuesAndPrivateMetadata() throws {
    let sink = MemorySink()
    let log = try logger(sink)
    var data: [String: LogValue] = ["count": 1]
    let child = log.child("cache", context: .init(data: data))
    data["count"] = 2
    child.info("Read", ["secret": "synthetic", "user": .private("synthetic")])
    #expect(sink.records[0].scope == "cache")
    #expect(sink.records[0].data == ["count": 1, "secret": "[REDACTED]", "user": "[REDACTED]"])
    let bridge = log.asSwiftLog()
    bridge.info(
        "Existing event",
        metadata: [
            "identifier": .attributed("synthetic", attributes: [LogPrivacy.private]),
            "status": .attributed("ready", attributes: [LogPrivacy.public]),
        ])
    #expect(sink.records[1].data == ["identifier": "[REDACTED]", "status": "ready"])
}

private final class Marker: Sendable {}
private struct SyntheticFailure: Error, Equatable {}

@Test func operationPreservesReturnAndFailure() throws {
    let sink = MemorySink()
    let log = try logger(sink)
    let marker = Marker()
    let returned = log.operation("load") { _ in marker }
    #expect(returned === marker)
    #expect(throws: SyntheticFailure.self) {
        try log.operation("load") { _ in throw SyntheticFailure() }
    }
    #expect(sink.records.count == 2)
    #expect(sink.records[0].data?["outcome"] == "success")
    #expect(sink.records[1].data?["outcome"] == "failure")
    #expect(sink.records[1].error?["message"] != nil)
    #expect(sink.records[0].operationId != sink.records[1].operationId)
}

@Test func asyncOperationsAndCauses() async throws {
    let sink = MemorySink()
    let log = try logger(sink)
    let result = await log.operation("async") { child in
        await Task.yield()
        child.info("Step")
        return 42
    }
    #expect(result == 42)
    let inner = NSError(
        domain: "Inner", code: 2, userInfo: [NSLocalizedDescriptionKey: "Synthetic inner"])
    let outer = NSError(
        domain: "Outer", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Synthetic outer", NSUnderlyingErrorKey: inner])
    log.error("Failed", ["error": .object(LogSanitizer.error(outer))])
    #expect(
        sink.records.last?.error?["cause"]
            == .object(["name": "Inner", "message": "Synthetic inner", "code": "2"]))
}

private struct FailingSink: LogSink {
    func write(_ record: LogRecord) throws {
        #expect(record.data?["password"] == "[REDACTED]")
        throw SyntheticFailure()
    }
}

@Test func sinkFailuresAndLargeRecordsAreContained() throws {
    let sink = MemorySink()
    let log = createLogger(
        try LoggerOptions(service: "fixture", environment: "production"),
        sinks: [FailingSink(), sink])
    log.info("Safe", ["password": "synthetic"])
    #expect(log.diagnostics.sinkFailures == 1)
    #expect(sink.records.count == 1)
    let large = try logger(sink)
    large.info(
        String(repeating: "😀", count: 5000),
        Dictionary(
            uniqueKeysWithValues: (0..<100).map {
                (String($0), .string(String(repeating: "😀", count: 3000)))
            }))
    #expect(try sink.records[1].encoded().count <= 16384)
    #expect(sink.records[1].data?["truncated"] == true)
    let safe = LogSanitizer.fields(["big": .integer(Int64.max), "number": .number(.infinity)])
    #expect(safe["big"] == .string(String(Int64.max)))
}

@Test func bufferCountBytesAndSuccessfulDrain() async throws {
    let batches = Mutex<[[LogRecord]]>([])
    let sink = try BufferedSink(automaticFlush: false) { records, _ in
        batches.withLock { $0.append(records) }
    }
    let log = try logger(sink)
    for _ in 0..<200 { log.info("Ready") }
    #expect(sink.stats.buffered == 100)
    #expect(sink.stats.dropped == 100)
    await log.close()
    #expect(sink.stats.delivered == 100)
    #expect(sink.stats.buffered == 0)
    #expect(batches.withLock { $0.allSatisfy { $0.count <= 10 } })
}

@Test func bufferOutageHasBoundedAttempts() async throws {
    let sink = try BufferedSink(shutdownTimeout: .milliseconds(50), automaticFlush: false) { _, _ in
        throw SyntheticFailure()
    }
    let log = try logger(sink)
    log.info("Ready")
    let start = ContinuousClock.now
    await log.close()
    #expect(start.duration(to: .now) < .seconds(1))
    #expect(sink.stats.deliveryFailures <= 3)
    #expect(sink.stats.dropped == 1)
}

@Test func malformedIdentitiesAndRemoteEndpointsAreRejected() throws {
    #expect(throws: LoggingConfigurationError.self) {
        try LoggerOptions(service: "", environment: "production")
    }
    let url = try #require(URL(string: "http://example.invalid/api/_narduk/logs"))
    #expect(throws: LoggingConfigurationError.self) {
        try createClientDiagnosticsSink(endpoint: url)
    }
}
