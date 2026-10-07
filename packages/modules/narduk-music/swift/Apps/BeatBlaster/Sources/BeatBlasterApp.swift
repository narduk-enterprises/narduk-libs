import SwiftUI
import UIKit

@main
struct BeatBlasterApp: App {
    @State private var audio = BlasterAudio()

    var body: some Scene {
        WindowGroup {
            RootView(audio: audio)
        }
    }
}

enum Screen: String {
    case home, beat, lights, mic, dream
}

/// One screen at a time, swapped with a springy zoom. Launch arguments for smoke runs and screenshots:
/// `-screen home|beat|lights|mic|dream`, `-song <style id>` (genre-dubstep, guitars, demo ...), `-tile <visual id>`.
struct RootView: View {
    let audio: BlasterAudio
    @Environment(\.scenePhase) private var scenePhase
    @State private var screen: Screen = .home

    var body: some View {
        ZStack {
            Neon.night.ignoresSafeArea()
            Group {
                switch screen {
                case .home: HomeView(audio: audio, go: go)
                case .beat: BeatView(audio: audio, back: goHome)
                case .lights: LightShowView(audio: audio, back: goHome)
                case .mic: MicView(audio: audio, back: goHome)
                case .dream: DreamView(audio: audio, back: goHome, play: { go(.beat) })
                }
            }
            .transition(.asymmetric(insertion: .scale(scale: 0.85).combined(with: .opacity), removal: .opacity))
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .task {
            let defaults = UserDefaults.standard
            if let id = defaults.string(forKey: "song"), let style = BlasterStyle.all.first(where: { $0.id == id }) {
                audio.song.style = style
            }
            if let raw = defaults.string(forKey: "screen"), let target = Screen(rawValue: raw) { screen = target }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: audio.pauseForBackground()
            case .active: audio.resumeFromBackground()
            default: break
            }
        }
    }

    private func go(_ target: Screen) {
        Haptics.tap()
        withAnimation(.spring(response: 0.45, dampingFraction: 0.75)) { screen = target }
    }

    private func goHome() { go(.home) }
}

/// Taps and thumps on iPhone; iPads have no haptic engine, so these do nothing there.
@MainActor enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func thump() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred(intensity: 1) }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}

// MARK: Shared pieces

/// A big round back button.
struct BackButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.backward")
                .font(.system(size: 28, weight: .heavy))
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().stroke(.white.opacity(0.35), lineWidth: 2))
        }
        .buttonStyle(Squish())
        .accessibilityLabel("Back")
    }
}

/// Buttons shrink and spring back when pressed.
struct Squish: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.5), value: configuration.isPressed)
    }
}

/// A bold rounded pill with a neon glow.
struct NeonPill: View {
    let text: String
    let color: Color
    var size: CGFloat = 24

    var body: some View {
        Text(text)
            .font(.system(size: size, weight: .black, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, size * 0.9)
            .padding(.vertical, size * 0.5)
            .background(color.opacity(0.85), in: Capsule())
            .overlay(Capsule().stroke(.white.opacity(0.6), lineWidth: 2))
            .shadow(color: color, radius: 14)
    }
}

/// A screen-wide dark wash so text reads over a bright visualizer.
struct Vignette: View {
    var body: some View {
        LinearGradient(
            colors: [.black.opacity(0.55), .clear, .clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom
        )
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
