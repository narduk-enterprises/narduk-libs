import Foundation

/// One named thing a packaged app proves about itself at launch.
public struct SmokeCheck: Sendable {
    public let name: String
    let body: @MainActor @Sendable () throws -> Void

    public init(_ name: String, body: @escaping @MainActor @Sendable () throws -> Void) {
        self.name = name
        self.body = body
    }
}

/// `<PREFIX>_SMOKE=1` launches the app, runs its checks and exits 0 with a success line. A release script runs it on
/// the packaged bundle before anything is published: a bundle can pass every static check and still die at launch (a
/// missing framework, resource or font).
///
/// Checks must touch nothing outside the process: no network, no real data folder, no defaults.
public struct SmokeGate: Sendable {
    public struct Failure: Error, CustomStringConvertible {
        public var description: String
        public init(_ description: String) { self.description = description }
    }

    /// Lower-case app name at the start of both output lines.
    public let name: String
    public let environmentKey: String

    public init(name: String, environmentPrefix: String) {
        self.name = name
        environmentKey = "\(environmentPrefix)_SMOKE"
    }

    public init(identity: AppIdentity) {
        self.init(name: identity.environmentPrefix.lowercased(), environmentPrefix: identity.environmentPrefix)
    }

    /// The line a release script looks for.
    public var successLine: String { "\(name) smoke ok" }

    public var requested: Bool { ProcessInfo.processInfo.environment[environmentKey] == "1" }

    /// Call first thing at launch. The checks are built only when the smoke run was requested.
    @MainActor
    public func exitIfRequested(_ checks: @MainActor () -> [SmokeCheck]) {
        guard requested else { return }
        do {
            let passed = try run(checks())
            print("\(successLine): \(passed.joined(separator: ", "))")
            exit(0)
        } catch {
            FileHandle.standardError.write(Data("\(name) smoke FAILED: \(error)\n".utf8))
            exit(1)
        }
    }

    /// Runs the checks in order, stops at the first failure and returns the names that passed.
    @MainActor
    public func run(_ checks: [SmokeCheck]) throws -> [String] {
        for check in checks { try check.body() }
        return checks.map(\.name)
    }
}
