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

/// One light (visualizer) with a kid-facing name. Canvas lights draw from the frame the screen's timeline polled; the
/// Metal and self-timed lights poll `audio.visualInput` on their own clocks at `framesPerSecond`.
struct VisualTile: Identifiable {
    let id: String
    let name: String
    let emoji: String
    let content: @MainActor (TileContext) -> AnyView

    @MainActor static let all: [VisualTile] = [
        VisualTile(id: "tunnel", name: "Wormhole", emoji: "🌀") { context in
            AnyView(TunnelTile(audio: context.audio, framesPerSecond: context.framesPerSecond))
        },
        VisualTile(id: "particles", name: "Star Burst", emoji: "🎆") { context in
            AnyView(
                ParticleFieldView(state: context.audio.visualState) { context.audio.visualInput }
                    .environment(\.soundFramesPerSecond, context.framesPerSecond))
        },
        VisualTile(id: "kaleidoscope", name: "Kaleidoscope", emoji: "🔮") { context in
            AnyView(
                BeatKaleidoscopeView(state: context.audio.visualState) { context.audio.visualInput }
                    .environment(\.soundFramesPerSecond, context.framesPerSecond))
        },
        shader(.plasma, "Lava Lamp", "🫧"),
        shader(.starfield, "Hyperspace", "🚀"),
        shader(.warpGrid, "Warp Grid", "🕸️"),
        shader(.feedback, "Echo Trails", "💫"),
        kind(.halo, "Sun Burst", "☀️"),
        kind(.mirror, "Neon City", "🌃"),
        kind(.phosphor, "Laser Loops", "➰"),
        kind(.spectrum, "Rainbow Bars", "🌈"),
        kind(.pads, "Light Pads", "🟪"),
        canvas("Radial", "Star Flower", "🌸"),
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

    private static func kind(_ kind: SoundVisualizerKind, _ name: String, _ emoji: String) -> VisualTile {
        VisualTile(id: kind.rawValue, name: name, emoji: emoji) { context in
            AnyView(
                Canvas { canvas, size in
                    _ = context.frame  // redraw every tick; the state is a reference
                    SoundVisualizers.draw(kind, &canvas, size, context.audio.visualState)
                }
                .background(Color.black)
                .accessibilityLabel(name))
        }
    }

    private static func canvas(_ id: String, _ name: String, _ emoji: String) -> VisualTile {
        let visualizer = Visualizer.all.first { $0.id == id }!
        return VisualTile(id: id, name: name, emoji: emoji) { context in
            AnyView(
                Canvas { canvas, size in visualizer.draw(&canvas, size, context.frame) }
                    .background(Color.black)
                    .accessibilityLabel(name))
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
