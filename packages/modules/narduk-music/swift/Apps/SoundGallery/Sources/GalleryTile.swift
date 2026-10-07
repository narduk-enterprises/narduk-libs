import NardukSoundAnalysis
import SwiftUI

/// What a tile draws from on one tick: the gallery's model (for a view that polls on its own clock), the frame the
/// gallery's single timeline just polled, and the render budget (0 means hold still).
struct TileContext {
    let model: GalleryModel
    let frame: SoundFrame
    let framesPerSecond: Int
}

/// One visualizer the gallery can show in the grid or alone, full screen. A Canvas tile draws from `context.frame`; a
/// Metal tile takes its rate from `context.framesPerSecond`. Adding a visualizer to the gallery is adding a tile here.
struct GalleryTile: Identifiable {
    let id: String
    let content: @MainActor (TileContext) -> AnyView

    static var all: [GalleryTile] {
        [tunnel]
            + Visualizer.all.map { visualizer in
                GalleryTile(id: visualizer.id) { context in
                    AnyView(
                        Canvas { canvas, size in visualizer.draw(&canvas, size, context.frame) }
                            .accessibilityLabel(visualizer.id))
                }
            }
    }
}
