#if os(macOS)
    import Foundation
    import NardukAppKit
    import NardukUpdateKit

    /// What an app repository promises the release pipeline, read from the files the release ships. An app's whole test:
    ///
    ///     @Test func deliveryContractHolds() throws {
    ///         let contract = SparkleDeliveryContract(testFile: #filePath, slug: "myapp", feed: .myApp, identity: .current)
    ///         #expect(try contract.violations() == [])
    ///     }
    ///
    /// Each answer is a list of readable mismatches, empty when the contract holds. This library does not import
    /// Testing, so it is safe to link from any test target.
    public struct SparkleDeliveryContract {
        public let root: URL
        public let slug: String
        public let feed: UpdateFeed
        public let identity: AppIdentity
        public let channel: String

        /// - Parameters:
        ///   - testFile: Pass `#filePath`. The repository root is the nearest folder above it with a Package.swift.
        ///   - slug: The software-delivery slug, which is `distribution.sparkle.appId`.
        public init(
            testFile: String, slug: String, feed: UpdateFeed, identity: AppIdentity, channel: String = "stable"
        ) throws {
            root = try Self.repositoryRoot(above: testFile)
            self.slug = slug
            self.feed = feed
            self.identity = identity
            self.channel = channel
        }

        public func violations() throws -> [String] {
            try feedPinViolations() + publicKeyViolations() + identityViolations() + bundleViolations()
                + entitlementViolations()
        }

        /// The feed is pinned in code, in Info.plist and in Config/apple-app.json, and they must stay one string under
        /// `https://…/<slug>/<channel>/appcast.xml`.
        public func feedPinViolations() throws -> [String] {
            let pinned = feed.url.absoluteString
            let sparkle = try sparkleSection()
            var found: [String] = []
            if !pinned.hasSuffix("/\(slug)/\(channel)/appcast.xml") {
                found.append("feed \(pinned) is not the \(slug) \(channel) appcast")
            }
            let plistFeed = try plist("Config/Info.plist")["SUFeedURL"] as? String
            if plistFeed != pinned { found.append("Info.plist SUFeedURL \(plistFeed ?? "absent") is not \(pinned)") }
            let manifestFeed = sparkle["feedURL"] as? String
            if manifestFeed != pinned { found.append("manifest feedURL \(manifestFeed ?? "absent") is not \(pinned)") }
            if sparkle["appId"] as? String != slug { found.append("manifest appId is not \(slug)") }
            if sparkle["channel"] as? String != channel { found.append("manifest channel is not \(channel)") }
            return found
        }

        /// Info.plist carries the placeholder until a release build injects the real key, or a real key once pinned.
        /// The manifest pins a real key or names the placeholder.
        public func publicKeyViolations() throws -> [String] {
            var found: [String] = []
            let key = try plist("Config/Info.plist")["SUPublicEDKey"] as? String
            if key != UpdateFeed.keyPlaceholder, !UpdateFeed.isUsable(publicKey: key) {
                found.append("Info.plist SUPublicEDKey is neither the placeholder nor a real key")
            }
            let sparkle = try sparkleSection()
            if let pinned = sparkle["publicEDKey"] as? String {
                if !UpdateFeed.isUsable(publicKey: pinned) { found.append("manifest publicEDKey is not a real key") }
            } else if sparkle["publicEDKeyPlaceholder"] as? String != UpdateFeed.keyPlaceholder {
                found.append("manifest has neither a publicEDKey nor the placeholder")
            }
            return found
        }

        public func identityViolations() throws -> [String] {
            let target = try firstTarget()
            var found: [String] = []
            if target["productionBundleNamespace"] as? String != identity.productionBundleID {
                found.append("manifest productionBundleNamespace is not \(identity.productionBundleID)")
            }
            if target["developmentBundleNamespace"] as? String != identity.developmentBundleID {
                found.append("manifest developmentBundleNamespace is not \(identity.developmentBundleID)")
            }
            return found
        }

        /// The source Info.plist is the production app, with automatic checks on and a minimum system version.
        public func bundleViolations() throws -> [String] {
            let info = try plist("Config/Info.plist")
            var found: [String] = []
            if info["CFBundleIdentifier"] as? String != identity.productionBundleID {
                found.append("Info.plist CFBundleIdentifier is not \(identity.productionBundleID)")
            }
            if info["CFBundleName"] as? String != identity.productionName {
                found.append("Info.plist CFBundleName is not \(identity.productionName)")
            }
            if info["CFBundleExecutable"] as? String != identity.productionName {
                found.append("Info.plist CFBundleExecutable is not \(identity.productionName)")
            }
            if info["SUEnableAutomaticChecks"] as? Bool != true {
                found.append("Info.plist SUEnableAutomaticChecks is not true")
            }
            if (info["LSMinimumSystemVersion"] as? String)?.isEmpty != false {
                found.append("Info.plist has no LSMinimumSystemVersion")
            }
            return found
        }

        /// `Config/<name>.entitlements` and the manifest declare the same set (the release script seals the file's
        /// keys and asserts the sealed set equals them), and `get-task-allow` never ships.
        public func entitlementViolations() throws -> [String] {
            let entitlements = try plist("Config/\(identity.productionName).entitlements")
            guard let declared = try firstTarget()["entitlements"] as? [String] else {
                return ["manifest declares no entitlements list"]
            }
            var found: [String] = []
            if Set(declared) != Set(entitlements.keys) {
                found.append("manifest entitlements \(declared.sorted()) differ from the entitlements file")
            }
            if entitlements["com.apple.security.get-task-allow"] != nil {
                found.append("entitlements file carries get-task-allow")
            }
            return found
        }

        private static func repositoryRoot(above file: String) throws -> URL {
            var url = URL(fileURLWithPath: file)
            while url.path != "/" {
                url.deleteLastPathComponent()
                if FileManager.default.fileExists(atPath: url.appendingPathComponent("Package.swift").path) {
                    return url
                }
            }
            throw ContractError("no Package.swift above \(file)")
        }

        private func plist(_ path: String) throws -> [String: Any] {
            let data = try Data(contentsOf: root.appendingPathComponent(path))
            guard let value = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
            else { throw ContractError("\(path) is not a dictionary") }
            return value
        }

        private func manifest() throws -> [String: Any] {
            let data = try Data(contentsOf: root.appendingPathComponent("Config/apple-app.json"))
            guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw ContractError("Config/apple-app.json is not an object")
            }
            return value
        }

        private func sparkleSection() throws -> [String: Any] {
            guard let section = (try manifest()["distribution"] as? [String: Any])?["sparkle"] as? [String: Any] else {
                throw ContractError("Config/apple-app.json has no distribution.sparkle")
            }
            return section
        }

        private func firstTarget() throws -> [String: Any] {
            guard let target = (try manifest()["targets"] as? [[String: Any]])?.first else {
                throw ContractError("Config/apple-app.json has no targets")
            }
            return target
        }
    }

    struct ContractError: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }

    /// Whether Sparkle's install would go ahead once `beforeRelaunch` has run. An app's two update-persistence tests:
    /// a failed save answers false and a good one true.
    @MainActor
    public func updateInstalls(after beforeRelaunch: @escaping @MainActor () async -> Bool) async -> Bool {
        let hooks = UpdaterHooks()
        hooks.beforeRelaunch = beforeRelaunch
        var installed = false
        await hooks.prepareAndResumeInstallation { installed = true }
        return installed
    }
#endif
