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

// NardukMusic is the signal-driven music engine (narduk-libs#1520): signals in, music out. Core (the conductor),
// DSP (the synth) and Render (offline PCM, WAV) need only Foundation and Synchronization, so they build and test on
// the Linux gate; the real-time AVAudioEngine player is Darwin-only below.
package.products += [
    .library(name: "NardukMusicCore", targets: ["NardukMusicCore"]),
    .library(name: "NardukMusicDSP", targets: ["NardukMusicDSP"]),
    .library(name: "NardukMusicRender", targets: ["NardukMusicRender"]),
    .executable(name: "narduk-music", targets: ["narduk-music"]),
]
package.targets += [
    .target(
        name: "NardukMusicCore", path: "packages/modules/narduk-music/swift/Sources/NardukMusicCore"
    ),
    .target(
        name: "NardukMusicDSP", dependencies: ["NardukMusicCore"],
        path: "packages/modules/narduk-music/swift/Sources/NardukMusicDSP"
    ),
    .target(
        name: "NardukMusicRender", dependencies: ["NardukMusicCore", "NardukMusicDSP"],
        path: "packages/modules/narduk-music/swift/Sources/NardukMusicRender"
    ),
    .executableTarget(
        name: "narduk-music", dependencies: ["NardukMusicRender"],
        path: "packages/modules/narduk-music/swift/Sources/narduk-music"
    ),
    .testTarget(
        name: "NardukMusicCoreTests", dependencies: ["NardukMusicCore", "NardukMusicDSP"],
        path: "packages/modules/narduk-music/swift/Tests/NardukMusicCoreTests"
    ),
    .testTarget(
        name: "NardukMusicDSPTests", dependencies: ["NardukMusicCore", "NardukMusicDSP"],
        path: "packages/modules/narduk-music/swift/Tests/NardukMusicDSPTests"
    ),
    .testTarget(
        name: "NardukMusicRenderTests",
        dependencies: ["NardukMusicCore", "NardukMusicDSP", "NardukMusicRender"],
        path: "packages/modules/narduk-music/swift/Tests/NardukMusicRenderTests"
    ),
]

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

    // The real-time player: AVAudioEngine, an AVAudioSourceNode and an AAC recorder.
    package.products.append(.library(name: "NardukMusicEngine", targets: ["NardukMusicEngine"]))
    package.targets += [
        .target(
            name: "NardukMusicEngine", dependencies: ["NardukMusicCore", "NardukMusicDSP"],
            path: "packages/modules/narduk-music/swift/Sources/NardukMusicEngine"
        ),
        .testTarget(
            name: "NardukMusicEngineTests", dependencies: ["NardukMusicEngine"],
            path: "packages/modules/narduk-music/swift/Tests/NardukMusicEngineTests"
        ),
    ]
#endif
