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

/// What a tile draws from on one tick: the audio (for a view that polls on its own clock), the frame the screen's
/// single timeline just polled, and the render budget (0 means hold still).
struct TileContext {
    let audio: BlasterAudio
    let frame: SoundFrame
    let framesPerSecond: Int
}

/// One visualizer, with a kid-facing name (adapted from the SoundGallery's `GalleryTile`).
struct VisualTile: Identifiable {
    let id: String
    let name: String
    let content: @MainActor (TileContext) -> AnyView

    @MainActor static let all: [VisualTile] = [
        VisualTile(id: "tunnel", name: "Wormhole") { context in
            AnyView(TunnelTile(audio: context.audio, framesPerSecond: context.framesPerSecond))
        },
        kind(.halo, "Sun Burst"),
        kind(.mirror, "Neon City"),
        kind(.phosphor, "Laser Loops"),
        kind(.spectrum, "Rainbow Bars"),
        kind(.pads, "Light Pads"),
        canvas("Radial", "Star Flower"),
        kind(.wobbleMeter, "Wobble Dial"),
        kind(.scope, "Squiggle"),
    ]

    private static func kind(_ kind: SoundVisualizerKind, _ name: String) -> VisualTile {
        VisualTile(id: kind.rawValue, name: name) { context in
            AnyView(
                Canvas { canvas, size in
                    _ = context.frame  // redraw every tick; the state is a reference
                    SoundVisualizers.draw(kind, &canvas, size, context.audio.visualState)
                }
                .accessibilityLabel(name))
        }
    }

    private static func canvas(_ id: String, _ name: String) -> VisualTile {
        let visualizer = Visualizer.all.first { $0.id == id }!
        return VisualTile(id: id, name: name) { context in
            AnyView(
                Canvas { canvas, size in visualizer.draw(&canvas, size, context.frame) }
                    .accessibilityLabel(name))
        }
    }
}

/// One visualizer filling its frame, polled on its own timeline at 60 fps while `drawing`.
struct LiveVisual: View {
    let audio: BlasterAudio
    let tile: VisualTile
    var drawing = true

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !drawing)) { timeline in
            tile.content(
                TileContext(
                    audio: audio, frame: audio.poll(at: timeline.date),
                    framesPerSecond: drawing ? SoundRenderBudget.normal : 0))
        }
    }
}
