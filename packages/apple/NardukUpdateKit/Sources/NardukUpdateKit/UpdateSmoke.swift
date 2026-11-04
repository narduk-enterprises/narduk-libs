#if os(macOS)
    import Foundation
    import NardukAppKit
    import Sparkle

    extension SmokeCheck {
        /// `sparkle`: the framework loads and the bundle's `SUFeedURL`, when it has one, is the pinned feed. In a
        /// packaged app, also `bundle`: Sparkle's tools resolve through the framework and the bundle id is the app's.
        public static func updates(
            feed: UpdateFeed, identity: AppIdentity, bundle: Bundle = .main
        ) -> [SmokeCheck] {
            var checks = [
                SmokeCheck("sparkle") {
                    let bundledFeed = bundle.object(forInfoDictionaryKey: "SUFeedURL") as? String
                    guard bundledFeed == nil || bundledFeed == feed.url.absoluteString else {
                        throw SmokeGate.Failure("SUFeedURL in the bundle is not the pinned feed")
                    }
                    guard Bundle(for: SPUUpdater.self).bundleIdentifier == "org.sparkle-project.Sparkle" else {
                        throw SmokeGate.Failure("Sparkle.framework did not load")
                    }
                }
            ]
            if bundle.bundleURL.pathExtension == "app" {
                checks.append(
                    SmokeCheck("bundle") {
                        // Sparkle's installer launcher resolves its tools through CFBundle at the framework root.
                        let framework = bundle.bundleURL.appendingPathComponent("Contents/Frameworks/Sparkle.framework")
                        guard let tools = Bundle(url: framework), tools.url(forAuxiliaryExecutable: "Autoupdate") != nil
                        else {
                            throw SmokeGate.Failure(
                                "Sparkle's Autoupdate does not resolve through the framework bundle")
                        }
                        guard bundle.bundleIdentifier == identity.bundleID else {
                            throw SmokeGate.Failure("bundle id mismatch")
                        }
                    })
            }
            return checks
        }
    }
#endif
