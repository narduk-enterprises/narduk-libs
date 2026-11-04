import Foundation
import Testing

@testable import NardukAppKit

private let identity = AppIdentity(
    productionBundleID: "com.example.fixture", productionName: "Fixture", developmentName: "Fixture Dev",
    environmentPrefix: "FIXTURE", productionFolderName: "FixtureData", legacyBundleNames: ["Old Fixture"])

struct AppIdentityTests {
    @Test func theDevelopmentBundleFollowsTheProductionOne() {
        #expect(identity.developmentBundleID == "com.example.fixture.dev")
        #expect(identity.testDataDirectoryKey == "FIXTURE_TEST_DATA_DIRECTORY")
    }

    @Test func theInstalledAppKeepsItsFolderThroughARename() {
        #expect(identity.dataFolderName(bundleID: identity.productionBundleID, bundleName: "Fixture") == "FixtureData")
        #expect(
            identity.dataFolderName(bundleID: identity.productionBundleID, bundleName: "Old Fixture") == "FixtureData")
    }

    @Test func everyOtherBuildGetsItsOwnFolder() {
        #expect(identity.dataFolderName(bundleID: identity.developmentBundleID, bundleName: "Fixture") == "Fixture Dev")
        #expect(identity.dataFolderName(bundleID: identity.productionBundleID, bundleName: nil) == "Fixture Dev")
        #expect(identity.dataFolderName(bundleID: identity.productionBundleID, bundleName: "Other") == "Fixture Dev")
        #expect(identity.dataFolderName(bundleID: "com.apple.dt.xctest.tool", bundleName: "xctest") == "Fixture Dev")
    }

    @Test func aTestRunIsNeverTheProductionApp() {
        #expect(!identity.isProduction)
        #expect(identity.bundleID == identity.developmentBundleID)
        #expect(identity.dataFolder.lastPathComponent == "Fixture Dev")
    }

    @Test func theProductionFolderDefaultsToTheProductName() {
        let plain = AppIdentity(
            productionBundleID: "com.example.plain", productionName: "Plain", developmentName: "Plain Dev",
            environmentPrefix: "PLAIN")
        #expect(plain.dataFolderName(bundleID: "com.example.plain", bundleName: "Plain") == "Plain")
    }
}

struct PrivateFileTests {
    private func permissions(_ url: URL) throws -> Int {
        try #require(FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int)
    }

    @Test func writesOwnerOnlyAndReplacesTheFile() throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let file = folder.appending(path: "data.json")
        try PrivateFile.write(Data("one".utf8), to: file)
        try PrivateFile.write(Data("two".utf8), to: file)
        #expect(try Data(contentsOf: file) == Data("two".utf8))
        #expect(try permissions(file) == 0o600)
        #expect(try permissions(folder) == 0o700)
    }

    @Test func aFileWhereTheFolderShouldBeFailsAndKeepsTheFile() throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let blocked = folder.appending(path: "blocked")
        try Data("existing".utf8).write(to: blocked)
        #expect(throws: (any Error).self) { try PrivateFile.write(Data(), to: blocked.appending(path: "data.json")) }
        #expect(try Data(contentsOf: blocked) == Data("existing".utf8))
    }

    @Test func copiesIntoAPrivateFolderAndLeavesTheSource() throws {
        let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let source = folder.appending(path: "old/data.json")
        try FileManager.default.createDirectory(
            at: source.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("kept".utf8).write(to: source)
        let destination = folder.appending(path: "new/data.json")
        try PrivateFile.copy(from: source, to: destination)
        #expect(try Data(contentsOf: source) == Data("kept".utf8))
        #expect(try Data(contentsOf: destination) == Data("kept".utf8))
        #expect(try permissions(destination) == 0o600)
    }
}

private struct Settings: Codable, Equatable {
    var size = 1
    var name = "a"
}

@MainActor
struct PreferencesStoreTests {
    private func defaults() throws -> (UserDefaults, () -> Void) {
        let suite = "preferences-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        return (defaults, { defaults.removePersistentDomain(forName: suite) })
    }

    @Test func aChangeIsStoredUnderThePrefixedKeyAndReopens() throws {
        let (defaults, clean) = try defaults()
        defer { clean() }
        let store = PreferencesStore(defaults: defaults, keyPrefix: "Fixture", initialValue: Settings())
        #expect(store.key == "Fixture.preferences.v1")
        store.value.size = 3
        #expect(defaults.data(forKey: "Fixture.preferences.v1") != nil)
        let reopened = PreferencesStore(defaults: defaults, keyPrefix: "Fixture", initialValue: Settings())
        #expect(reopened.value.size == 3)
    }

    @Test func aDamagedValueFallsBackInsteadOfStoppingTheApp() throws {
        let (defaults, clean) = try defaults()
        defer { clean() }
        defaults.set(Data("not json".utf8), forKey: "Fixture.preferences.v1")
        let store = PreferencesStore(defaults: defaults, keyPrefix: "Fixture", initialValue: Settings())
        #expect(store.value == Settings())
    }

    @Test func undoAndRedoWalkTheChangesAndNameTheStep() throws {
        let (defaults, clean) = try defaults()
        defer { clean() }
        let store = PreferencesStore(
            defaults: defaults, keyPrefix: "Fixture", undoName: "Options", initialValue: Settings())
        store.value.size = 2
        #expect(store.history.canUndo)
        #expect(store.history.undoTitle == "Options")
        store.history.undo()
        #expect(store.value.size == 1)
        #expect(store.history.canRedo)
        store.history.redo()
        #expect(store.value.size == 2)
    }

    @Test func aRepairAtLoadIsWrittenBackAndIsNotUndoable() throws {
        let (defaults, clean) = try defaults()
        defer { clean() }
        defaults.set(try JSONEncoder().encode(Settings(size: 99)), forKey: "Fixture.preferences.v1")
        let store = PreferencesStore(
            defaults: defaults, keyPrefix: "Fixture", initialValue: Settings(),
            normalize: { $0.size = min($0.size, 10) })
        #expect(store.value.size == 10)
        #expect(!store.history.canUndo)
        let stored = try #require(defaults.data(forKey: "Fixture.preferences.v1"))
        #expect(try JSONDecoder().decode(Settings.self, from: stored).size == 10)
    }

    @Test func restoreAndSmallUpdatesLeaveNoUndoStep() throws {
        let (defaults, clean) = try defaults()
        defer { clean() }
        let store = PreferencesStore(defaults: defaults, keyPrefix: "Fixture", initialValue: Settings())
        store.restore(Settings(size: 4))
        store.update { $0.name = "b" }
        #expect(store.value == Settings(size: 4, name: "b"))
        #expect(!store.history.canUndo)
    }

    @Test func onChangeSeesEveryRealChangeIncludingUndo() throws {
        let (defaults, clean) = try defaults()
        defer { clean() }
        var seen: [Int] = []
        let store = PreferencesStore(
            defaults: defaults, keyPrefix: "Fixture", initialValue: Settings(),
            onChange: { _, new in seen.append(new.size) })
        store.value.size = 2
        store.value.size = 2
        store.history.undo()
        #expect(seen == [2, 1])
    }
}

@MainActor
struct UndoHistoryTests {
    @Test func undoOfAnUndoIsARedo() {
        var state = 1
        let history = UndoHistory()
        history.record("Step", undo: { state = 1 }, redo: { state = 2 })
        state = 2
        history.undo()
        #expect(state == 1)
        history.redo()
        #expect(state == 2)
        history.undo()
        #expect(state == 1)
    }
}

@MainActor
struct SmokeGateTests {
    @Test func namesComeFromTheIdentity() {
        let gate = SmokeGate(identity: identity)
        #expect(gate.environmentKey == "FIXTURE_SMOKE")
        #expect(gate.successLine == "fixture smoke ok")
        #expect(!gate.requested)
    }

    @Test func checksRunInOrderAndTheFirstFailureStopsThem() throws {
        let gate = SmokeGate(name: "fixture", environmentPrefix: "FIXTURE")
        #expect(try gate.run([SmokeCheck("one") {}, SmokeCheck("two") {}]) == ["one", "two"])
        #expect(throws: SmokeGate.Failure.self) {
            try gate.run([SmokeCheck("one") { throw SmokeGate.Failure("broken") }, SmokeCheck("two") {}])
        }
    }
}
