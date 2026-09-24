// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "NardukLogging",
    platforms: [.macOS(.v15), .iOS(.v18), .tvOS(.v18), .watchOS(.v11), .visionOS(.v2)],
    products: [.library(name: "NardukLogging", targets: ["NardukLogging"])],
    dependencies: [.package(url: "https://github.com/apple/swift-log.git", from: "1.15.1")],
    targets: [
        .executableTarget(
            name: "NardukLoggingExample", dependencies: ["NardukLogging"],
            path: "packages/modules/narduk-logging/examples/swift"
        ),
        .target(
            name: "NardukLogging",
            dependencies: [.product(name: "Logging", package: "swift-log")],
            path: "packages/modules/narduk-logging/swift/Sources/NardukLogging"
        ),
        .testTarget(
            name: "NardukLoggingTests", dependencies: ["NardukLogging"],
            path: "packages/modules/narduk-logging/swift/Tests/NardukLoggingTests"
        ),
    ],
    swiftLanguageModes: [.v6]
)

// NardukAuthKit is the Apple client half of narduk-auth's native PKCE flow
// (docs/architecture/narduk-logging.md). It needs Security and CryptoKit, so
// it exists only where the manifest is evaluated on an Apple host; the Linux
// logging gate keeps building NardukLogging alone.
#if canImport(Darwin)
    package.products.append(.library(name: "NardukAuthKit", targets: ["NardukAuthKit"]))
    package.targets += [
        .target(
            name: "NardukAuthKit",
            path: "packages/modules/narduk-auth/swift/Sources/NardukAuthKit"
        ),
        .testTarget(
            name: "NardukAuthKitTests", dependencies: ["NardukAuthKit"],
            path: "packages/modules/narduk-auth/swift/Tests/NardukAuthKitTests"
        ),
    ]
#endif
