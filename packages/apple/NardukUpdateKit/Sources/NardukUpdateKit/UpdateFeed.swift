import Foundation

/// Where an app looks for updates, and whether it is allowed to.
public struct UpdateFeed: Equatable, Sendable {
    /// What a source Info.plist carries until a release build injects the real public key.
    public static let keyPlaceholder = "__NARDUK_SPARKLE_ED25519_PUBLIC_KEY__"

    /// Held equal to `SUFeedURL` in Info.plist and `distribution.sparkle.feedURL` in Config/apple-app.json by
    /// `SparkleDeliveryContract` in NardukUpdateKitTesting.
    public let url: URL

    public init(url: URL) { self.url = url }

    /// True only for a real Ed25519 public key: base64 that decodes to 32 bytes. The placeholder, an empty value and
    /// anything malformed all fail closed, so an updater that could not verify an update never starts.
    public static func isUsable(publicKey: String?) -> Bool {
        guard let publicKey, !publicKey.isEmpty, publicKey != keyPlaceholder,
            let raw = Data(base64Encoded: publicKey)
        else { return false }
        return raw.count == 32
    }

    public static var isConfigured: Bool {
        isUsable(publicKey: Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String)
    }
}
