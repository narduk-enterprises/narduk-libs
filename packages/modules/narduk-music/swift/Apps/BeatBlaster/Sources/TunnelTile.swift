import NardukSoundAnalysis
import NardukSoundVisuals
import SwiftUI

/// The Metal wobble tunnel (from the SoundGallery). It polls on its own `MTKView` loop: `audio.latestFrame` is the frame
/// the screen's one timeline last polled, so the analyzer still runs once per tick.
struct TunnelTile: View {
    let audio: BlasterAudio
    let framesPerSecond: Int

    var body: some View {
        if WobbleTunnelView.isSupported {
            WobbleTunnelView(state: audio.visualState) { audio.visualInput }
                .environment(\.soundFramesPerSecond, framesPerSecond)
                .accessibilityLabel("Wormhole")
        } else {
            Color.black
        }
    }
}
