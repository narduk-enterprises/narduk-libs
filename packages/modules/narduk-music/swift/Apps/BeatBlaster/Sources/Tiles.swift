import NardukSoundAnalysis
import NardukSoundVisuals
import SwiftUI

/// The neon colours every screen uses.
enum Neon {
    static let night = Color(red: 0.03, green: 0.016, blue: 0.086)
    static let pink = Color(red: 1, green: 0.24, blue: 0.67)
    static let orange = Color(red: 1, green: 0.5, blue: 0.16)
    static let yellow = Color(red: 1, green: 0.88, blue: 0.16)
    static let green = Color(red: 0.24, green: 1, blue: 0.55)
    static let cyan = Color(red: 0.16, green: 0.88, blue: 1)
    static let purple = Color(red: 0.62, green: 0.38, blue: 1)
    static let cycle: [Color] = [pink, orange, yellow, green, cyan, purple]
}

/// What a light draws from on one tick.
struct TileContext {
    let audio: BlasterAudio
    let frame: SoundFrame
    let framesPerSecond: Int
}

/// One light (visualizer) with a kid-facing name. Every light is Metal and polls `audio.visualInput` on their own clocks at `framesPerSecond`.
struct VisualTile: Identifiable {
    let id: String
    let name: String
    let emoji: String
    let content: @MainActor (TileContext) -> AnyView

    @MainActor static let all: [VisualTile] = [
        VisualTile(id: "tunnel", name: "Wormhole", emoji: "🌀") { context in
            AnyView(TunnelTile(audio: context.audio, framesPerSecond: context.framesPerSecond))
        },
        intense(.particleField, id: "particles", "Star Burst", "🎆"),
        intense(.kaleidoscope, id: "kaleidoscope", "Kaleidoscope", "🔮"),
        shader(.plasma, "Lava Lamp", "🫧"),
        shader(.starfield, "Hyperspace", "🚀"),
        shader(.warpGrid, "Warp Grid", "🕸️"),
        shader(.feedback, "Echo Trails", "💫"),
        intense(.halo, "Sun Burst", "☀️"),
        intense(.mirror, "Neon City", "🌃"),
        intense(.phosphor, "Laser Loops", "➰"),
        intense(.spectrum, "Rainbow Bars", "🌈"),
        intense(.pads, "Light Pads", "🟪"),
        intense(.vortex, id: "Radial", "Star Flower", "🌸"),
        intense(.liquidSplash, "Paint Splash", "🎨"),
        intense(.fractalDive, "Fractal Dive", "🐚"),
        intense(.synthwaveFlyover, "Retro Road", "🛣️"),
        shader(.fireworks, "Fireworks", "🎇"),
        shader(.aurora, "Northern Lights", "🌌"),
        shader(.oceanWaves, "Big Waves", "🌊"),
        shader(.bassBlobs, "Goo Blobs", "🟢"),
        shader(.solarFlare, "Solar Flare", "🌞"),
        intense(.jellyfish, "Jellyfish", "🪼"),
        intense(.flower, "Glass Flowers", "🌺"),
        intense(.flameSun, "Fire Sun", "🔥"),
        intense(.bioluminescentSea, "Glow Sea", "🦑"),
        intense(.blackHole, "Black Hole", "🕳️"),
        intense(.geometricChaos, "Shape Storm", "🔷"),
        intense(.amberHelix, "Gold Spiral", "🧬"),
        intense(.astraUnbound, "Robot Brain", "🤖"),
        intense(.mercuryLoom, "Liquid Metal", "🪩"),
        intense(.pocketAutomaton, "Pixel Life", "👾"),
        intense(.synapticGate, "Brain Zap", "🧠"),
        intense(.tidalObservatory, "Moon Tide", "🌙"),
        intense(.vaultedEngine, "Engine Room", "⚙️"),
    ]

    @MainActor static func with(id: String) -> VisualTile { all.first { $0.id == id } ?? all[0] }

    @MainActor static func index(of id: String) -> Int { all.firstIndex { $0.id == id } ?? 0 }

    private static func shader(_ kind: ShaderPackKind, _ name: String, _ emoji: String) -> VisualTile {
        VisualTile(id: "shader-\(kind.rawValue)", name: name, emoji: emoji) { context in
            if ShaderPackView.isSupported {
                AnyView(
                    ShaderPackView(kind, state: context.audio.visualState) { context.audio.visualInput }
                        .environment(\.soundFramesPerSecond, context.framesPerSecond))
            } else {
                AnyView(Color.black)
            }
        }
    }

    private static func intense(
        _ kind: IntenseKind, id: String? = nil, _ name: String, _ emoji: String
    ) -> VisualTile {
        VisualTile(id: id ?? kind.id, name: name, emoji: emoji) { context in
            AnyView(
                BeatIntenseTile(kind: kind, name: name, audio: context.audio, framesPerSecond: context.framesPerSecond))
        }
    }
}

/// One light filling its frame, on a timeline that polls the audio (idempotent per frame, so several can share it).
struct LiveVisual: View {
    let audio: BlasterAudio
    let tile: VisualTile
    var drawing = true
    var framesPerSecond = SoundRenderBudget.normal

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / Double(framesPerSecond), paused: !drawing)) { timeline in
            tile.content(
                TileContext(
                    audio: audio, frame: audio.poll(at: timeline.date),
                    framesPerSecond: drawing ? framesPerSecond : 0))
        }
        .id(tile.id)
    }
}
