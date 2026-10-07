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
        name: "NardukMusicDSP", dependencies: ["NardukMusicCore", "NardukSoundAnalysis"],
        path: "packages/modules/narduk-music/swift/Sources/NardukMusicDSP",
        resources: [.copy("Resources")]
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

// NardukSound (narduk-libs#1567): three more products of the same package, empty until their phases land.
// NardukSoundAnalysis turns any audio into a SoundFrame, NardukSonify turns a sample stream into MusicSignals and
// NardukSoundVisuals draws a SoundFrame. The contract is packages/modules/narduk-music/swift/docs/sound-contract.md.
// All three compile on the Linux gate; platform-only code goes behind #if canImport inside the target.
package.products += [
    .library(name: "NardukSoundAnalysis", targets: ["NardukSoundAnalysis"]),
    .library(name: "NardukSonify", targets: ["NardukSonify"]),
    .library(name: "NardukSoundVisuals", targets: ["NardukSoundVisuals"]),
]
package.targets += [
    .target(
        name: "NardukSoundAnalysis",
        path: "packages/modules/narduk-music/swift/Sources/NardukSoundAnalysis"
    ),
    .target(
        name: "NardukSonify", dependencies: ["NardukMusicCore"],
        path: "packages/modules/narduk-music/swift/Sources/NardukSonify"
    ),
    .target(
        name: "NardukSoundVisuals", dependencies: ["NardukSoundAnalysis", "NardukMusicCore"],
        path: "packages/modules/narduk-music/swift/Sources/NardukSoundVisuals"
    ),
    .testTarget(
        name: "NardukSoundAnalysisTests", dependencies: ["NardukSoundAnalysis"],
        path: "packages/modules/narduk-music/swift/Tests/NardukSoundAnalysisTests"
    ),
    .testTarget(
        name: "NardukSonifyTests", dependencies: ["NardukSonify", "NardukMusicCore"],
        path: "packages/modules/narduk-music/swift/Tests/NardukSonifyTests"
    ),
    .testTarget(
        name: "NardukSoundVisualsTests",
        dependencies: ["NardukSoundVisuals", "NardukSoundAnalysis", "NardukMusicCore"],
        path: "packages/modules/narduk-music/swift/Tests/NardukSoundVisualsTests"
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
            name: "NardukMusicEngine",
            dependencies: ["NardukMusicCore", "NardukMusicDSP", "NardukSoundAnalysis"],
            path: "packages/modules/narduk-music/swift/Sources/NardukMusicEngine"
        ),
        .testTarget(
            name: "NardukMusicEngineTests", dependencies: ["NardukMusicEngine"],
            path: "packages/modules/narduk-music/swift/Tests/NardukMusicEngineTests"
        ),
    ]
#endif
