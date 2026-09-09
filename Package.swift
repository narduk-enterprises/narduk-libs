// swift-tools-version: 6.3
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
