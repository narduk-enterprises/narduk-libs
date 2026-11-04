#if os(macOS)
    import Foundation
    import NardukAppKit
    import NardukUpdateKitTesting
    import Testing

    @testable import NardukUpdateKit

    private let identity = AppIdentity(
        productionBundleID: "com.example.fixture", productionName: "Fixture", developmentName: "Fixture Dev",
        environmentPrefix: "FIXTURE")
    private let stable = "https://updates.example.com/fixture/stable/appcast.xml"
    private let feed = UpdateFeed(url: URL(string: stable)!)

    struct UpdateFeedTests {
        @Test func theUpdaterFailsClosedUnlessTheKeyIsReal() {
            #expect(UpdateFeed.isUsable(publicKey: Data(repeating: 7, count: 32).base64EncodedString()))
            #expect(!UpdateFeed.isUsable(publicKey: nil))
            #expect(!UpdateFeed.isUsable(publicKey: ""))
            #expect(!UpdateFeed.isUsable(publicKey: UpdateFeed.keyPlaceholder))
            #expect(!UpdateFeed.isUsable(publicKey: "not base64 !"))
            #expect(!UpdateFeed.isUsable(publicKey: Data(repeating: 7, count: 31).base64EncodedString()))
            #expect(!UpdateFeed.isUsable(publicKey: Data(repeating: 7, count: 64).base64EncodedString()))
        }

        @Test func aTestProcessHasNoKey() {
            #expect(!UpdateFeed.isConfigured)
        }
    }

    @MainActor
    struct AppUpdaterTests {
        @Test func aDevelopmentBuildNeverStartsTheUpdater() {
            let updater = AppUpdater(identity: identity, appName: "Fixture", notificationIdentifier: "fixture-update")
            #expect(!updater.isEnabled)
            #expect(!updater.canCheck)
            updater.check()
        }

        @Test func aFoundVersionStaysUntilItSettles() {
            let status = UpdateStatus()
            #expect(status.available == nil)
            status.found("1.2")
            #expect(status.available == "1.2")
            status.settled()
            #expect(status.available == nil)
        }

        @Test func anUpdateWaitsForTheSave() async {
            #expect(await updateInstalls { true })
            #expect(await !updateInstalls { false })
        }

        @Test func theSaveRunsBeforeTheInstall() async {
            var saved = false
            let hooks = UpdaterHooks()
            hooks.beforeRelaunch = {
                saved = true
                return true
            }
            var savedWhenInstalled = false
            await hooks.prepareAndResumeInstallation { savedWhenInstalled = saved }
            #expect(savedWhenInstalled)
        }
    }

    @MainActor
    struct UpdateSmokeTests {
        @Test func anUnpackagedProcessChecksSparkleOnly() throws {
            let checks = SmokeCheck.updates(feed: feed, identity: identity)
            let gate = SmokeGate(identity: identity)
            #expect(try gate.run(checks) == ["sparkle"])
        }

        private func bundle(feed: String) throws -> (Bundle, URL) {
            let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let app = root.appending(path: "Fixture.app")
            let contents = app.appending(path: "Contents")
            try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
            let plist: [String: Any] = ["CFBundleIdentifier": "com.example.other", "SUFeedURL": feed]
            let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            try data.write(to: contents.appending(path: "Info.plist"))
            return (try #require(Bundle(url: app)), root)
        }

        @Test func aBundleWithTheWrongFeedFails() throws {
            let (bundle, root) = try bundle(feed: "https://example.com/other/appcast.xml")
            defer { try? FileManager.default.removeItem(at: root) }
            let gate = SmokeGate(identity: identity)
            #expect(throws: SmokeGate.Failure.self) {
                try gate.run(SmokeCheck.updates(feed: feed, identity: identity, bundle: bundle))
            }
        }

        @Test func aPackagedBundleWithoutSparkleFailsItsBundleCheck() throws {
            let (bundle, root) = try bundle(feed: stable)
            defer { try? FileManager.default.removeItem(at: root) }
            let checks = SmokeCheck.updates(feed: feed, identity: identity, bundle: bundle)
            #expect(checks.map(\.name) == ["sparkle", "bundle"])
            #expect(throws: SmokeGate.Failure.self) { try SmokeGate(identity: identity).run(checks) }
        }
    }

    struct SparkleDeliveryContractTests {
        /// A repository holding the files the contract reads, with a test file inside it.
        private func repository(
            feedURL: String = stable, plistFeed: String? = nil, key: String = UpdateFeed.keyPlaceholder,
            entitlements: [String] = ["com.apple.security.cs.disable-library-validation"]
        ) throws -> (test: String, root: URL) {
            let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
            let config = root.appending(path: "Config")
            let tests = root.appending(path: "Tests/AppTests")
            try FileManager.default.createDirectory(at: config, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: tests, withIntermediateDirectories: true)
            try Data().write(to: root.appending(path: "Package.swift"))
            let info: [String: Any] = [
                "CFBundleIdentifier": identity.productionBundleID, "CFBundleName": "Fixture",
                "CFBundleExecutable": "Fixture", "SUEnableAutomaticChecks": true, "LSMinimumSystemVersion": "15.0",
                "SUFeedURL": plistFeed ?? feedURL, "SUPublicEDKey": key,
            ]
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
                .write(to: config.appending(path: "Info.plist"))
            let sealed = Dictionary(uniqueKeysWithValues: entitlements.map { ($0, true) })
            try PropertyListSerialization.data(fromPropertyList: sealed, format: .xml, options: 0)
                .write(to: config.appending(path: "Fixture.entitlements"))
            let manifest: [String: Any] = [
                "targets": [
                    [
                        "productionBundleNamespace": identity.productionBundleID,
                        "developmentBundleNamespace": identity.developmentBundleID,
                        "entitlements": ["com.apple.security.cs.disable-library-validation"],
                    ]
                ],
                "distribution": [
                    "sparkle": [
                        "feedURL": feedURL, "appId": "fixture", "channel": "stable",
                        "publicEDKeyPlaceholder": UpdateFeed.keyPlaceholder,
                    ]
                ],
            ]
            try JSONSerialization.data(withJSONObject: manifest).write(to: config.appending(path: "apple-app.json"))
            return (tests.appending(path: "DeliveryTests.swift").path, root)
        }

        private func contract(_ test: String) throws -> SparkleDeliveryContract {
            try SparkleDeliveryContract(testFile: test, slug: "fixture", feed: feed, identity: identity)
        }

        @Test func aMatchingRepositoryHasNoViolations() throws {
            let (test, root) = try repository()
            defer { try? FileManager.default.removeItem(at: root) }
            #expect(try contract(test).violations() == [])
        }

        @Test func aDriftedPlistFeedIsNamed() throws {
            let (test, root) = try repository(plistFeed: "https://updates.example.com/other/stable/appcast.xml")
            defer { try? FileManager.default.removeItem(at: root) }
            let found = try contract(test).violations()
            #expect(found.count == 1)
            #expect(found.first?.contains("SUFeedURL") == true)
        }

        @Test func aFeedForAnotherSlugIsNamed() throws {
            let (test, root) = try repository(feedURL: "https://updates.example.com/other/stable/appcast.xml")
            defer { try? FileManager.default.removeItem(at: root) }
            #expect(try contract(test).feedPinViolations().count >= 2)
        }

        @Test func aBrokenKeyAndDriftedEntitlementsAreNamed() throws {
            let (test, root) = try repository(
                key: "not a key", entitlements: ["com.apple.security.get-task-allow"])
            defer { try? FileManager.default.removeItem(at: root) }
            #expect(try contract(test).publicKeyViolations().count == 1)
            #expect(try contract(test).entitlementViolations().count == 2)
        }

        @Test func noPackageManifestAboveTheTestIsAnError() {
            #expect(throws: (any Error).self) {
                try SparkleDeliveryContract(
                    testFile: "/nowhere/Tests.swift", slug: "fixture", feed: feed, identity: identity)
            }
        }
    }
#endif
