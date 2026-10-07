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

/// An intense Metal light (`NardukSoundVisuals`) for Beat Blaster. Polls on its own `MTKView` loop like the tunnel;
/// Reduce Motion is the calm level (no flash, strobe or glitch).
struct BeatIntenseTile: View {
    let kind: IntenseKind
    let name: String
    let audio: BlasterAudio
    let framesPerSecond: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if IntenseView.isSupported {
            IntenseView(kind, state: audio.visualState, calm: reduceMotion) { audio.visualInput }
                .environment(\.soundFramesPerSecond, framesPerSecond)
                .accessibilityLabel(name)
        } else {
            Color.black
        }
    }
}
