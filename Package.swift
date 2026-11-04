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
    // The Apple kits are what every Narduk Mac app shares (updates, identity, persistence, activity).
    // Sparkle is a range, so each app's own exact pin decides the version, and a Linux manifest
    // evaluation never sees it. Only NardukUpdateKit links it, and only on macOS.
    package.dependencies.append(
        .package(url: "https://github.com/sparkle-project/Sparkle", .upToNextMajor(from: "2.9.4")))
    package.products += [
        .library(name: "NardukAppKit", targets: ["NardukAppKit"]),
        .library(name: "NardukUpdateKit", targets: ["NardukUpdateKit"]),
        .library(name: "NardukUpdateKitTesting", targets: ["NardukUpdateKitTesting"]),
        .library(name: "NardukActivityKit", targets: ["NardukActivityKit"]),
    ]
    package.targets += [
        .target(name: "NardukAppKit", path: "packages/apple/NardukAppKit/Sources/NardukAppKit"),
        .testTarget(
            name: "NardukAppKitTests", dependencies: ["NardukAppKit"],
            path: "packages/apple/NardukAppKit/Tests/NardukAppKitTests"
        ),
        .target(
            name: "NardukUpdateKit",
            dependencies: [
                "NardukAppKit",
                .product(
                    name: "Sparkle", package: "Sparkle", condition: .when(platforms: [.macOS])),
            ],
            path: "packages/apple/NardukUpdateKit/Sources/NardukUpdateKit"
        ),
        .target(
            name: "NardukUpdateKitTesting", dependencies: ["NardukAppKit", "NardukUpdateKit"],
            path: "packages/apple/NardukUpdateKit/Sources/NardukUpdateKitTesting"
        ),
        .testTarget(
            name: "NardukUpdateKitTests",
            dependencies: ["NardukAppKit", "NardukUpdateKit", "NardukUpdateKitTesting"],
            path: "packages/apple/NardukUpdateKit/Tests/NardukUpdateKitTests"
        ),
        .target(
            name: "NardukActivityKit",
            path: "packages/apple/NardukActivityKit/Sources/NardukActivityKit"
        ),
        .testTarget(
            name: "NardukActivityKitTests", dependencies: ["NardukActivityKit"],
            path: "packages/apple/NardukActivityKit/Tests/NardukActivityKitTests"
        ),
    ]
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
