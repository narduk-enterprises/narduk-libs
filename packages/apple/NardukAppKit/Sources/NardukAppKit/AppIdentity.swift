import Foundation

/// Which build this is. The installed app and every development build keep separate defaults, data and permission
/// grants, so a build from the repository never touches the installed app's data.
///
/// An app declares one value and keeps it in an extension of its own: `extension AppIdentity { static let current = … }`.
public struct AppIdentity: Equatable, Sendable {
    /// The shipped app's bundle id, and the only one that owns the installed app's data.
    public let productionBundleID: String
    public let developmentBundleID: String
    /// `CFBundleName` of the shipped app.
    public let productionName: String
    /// The data folder of everything that is not the shipped app (`swift run`, `swift test`, a Debug bundle).
    public let developmentName: String
    /// The shipped app's data folder name. It outlives a display-name change.
    public let productionFolderName: String
    /// Earlier `CFBundleName` values that still own the production data folder.
    public let legacyBundleNames: Set<String>
    /// Prefix of this app's environment switches, such as `MYAPP` for `MYAPP_SMOKE`.
    public let environmentPrefix: String

    public init(
        productionBundleID: String, productionName: String, developmentName: String, environmentPrefix: String,
        productionFolderName: String? = nil, legacyBundleNames: Set<String> = []
    ) {
        self.productionBundleID = productionBundleID
        developmentBundleID = productionBundleID + ".dev"
        self.productionName = productionName
        self.developmentName = developmentName
        self.productionFolderName = productionFolderName ?? productionName
        self.legacyBundleNames = legacyBundleNames
        self.environmentPrefix = environmentPrefix
    }

    /// What `Bundle.main` says. `swift run` and `swift test` have no Info.plist of the app's, so they come out as the
    /// development identity, never the production one.
    public var bundleID: String {
        guard let id = Bundle.main.bundleIdentifier, id == productionBundleID || id == developmentBundleID else {
            return developmentBundleID
        }
        return id
    }

    public var isProduction: Bool { bundleID == productionBundleID }

    /// `<PREFIX>_TEST_DATA_DIRECTORY`: in a Debug build that is not production, the data folder comes from here.
    public var testDataDirectoryKey: String { "\(environmentPrefix)_TEST_DATA_DIRECTORY" }

    /// The production folder needs the production bundle id and a known bundle name; anything else is development.
    public func dataFolderName(bundleID: String, bundleName: String?) -> String {
        guard bundleID == productionBundleID, let bundleName,
            bundleName == productionName || legacyBundleNames.contains(bundleName)
        else {
            return developmentName
        }
        return productionFolderName
    }

    public var dataFolder: URL {
        #if DEBUG
            if !isProduction, let path = ProcessInfo.processInfo.environment[testDataDirectoryKey] {
                return URL(fileURLWithPath: path, isDirectory: true)
            }
        #endif
        let name = dataFolderName(
            bundleID: bundleID, bundleName: Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(name, isDirectory: true)
    }
}
