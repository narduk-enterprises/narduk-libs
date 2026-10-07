import SwiftUI
import UIKit

@main
struct BeatBlasterApp: App {
    @State private var audio = BlasterAudio()
    @State private var mySongs = MySongs()
    @State private var lab = BeatLab()

    init() {
        // Clear the one-time hints before any view asks whether it has been seen.
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: "firstRun") {
            for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("hint.") {
                defaults.removeObject(forKey: key)
            }
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView(audio: audio, mySongs: mySongs, lab: lab)
        }
    }
}

enum Screen: String {
    case home, maker, player, lab, lights, mic, recordings
}

/// One screen at a time, swapped with a springy zoom. Launch arguments for smoke runs and screenshots:
/// `-orientation landscape|portrait`, `-silent YES` (speakers muted; meters, visuals and recording stay live), `-firstRun YES` (clears the one-time hints).
struct RootView: View {
    let audio: BlasterAudio
    let mySongs: MySongs
    let lab: BeatLab
    @Environment(\.scenePhase) private var scenePhase
    @State private var screen: Screen = .home

    var body: some View {
        ZStack {
            Neon.night.ignoresSafeArea()
            Group {
                switch screen {
                case .home: HomeView(audio: audio, mySongs: mySongs, go: go, play: play)
                case .maker: SongMakerView(audio: audio, home: goHome, done: play)
                case .player: PlayerView(audio: audio, mySongs: mySongs, home: goHome, newSong: { go(.maker) })
                case .lab: BeatLabView(audio: audio, lab: lab, home: goHome)
                case .lights: LightShowView(audio: audio, home: goHome)
                case .mic: MicView(audio: audio, home: goHome)
                case .recordings: RecordingsView(audio: audio, home: goHome)
                }
            }
            .transition(.asymmetric(insertion: .scale(scale: 0.9).combined(with: .opacity), removal: .opacity))
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .task {
            let defaults = UserDefaults.standard
            if let id = defaults.string(forKey: "song"), let style = BlasterStyle.with(id: id) {
                var recipe = SongRecipe(style: style)
                if let lights = defaults.string(forKey: "lights") { recipe.lightsID = lights }
                audio.play(recipe)
            }
            if let raw = defaults.string(forKey: "screen"), let target = Screen(rawValue: raw) { screen = target }
            if let raw = defaults.string(forKey: "orientation") { Self.rotate(to: raw) }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background: audio.pauseForBackground()
            case .active: audio.resumeFromBackground()
            default: break
            }
        }
    }

    /// `-orientation landscape|portrait` turns the window at launch (the screenshot runs have no way to rotate a
    /// simulator that is not on screen).
    private static func rotate(to name: String) {
        let mask: UIInterfaceOrientationMask = name == "landscape" ? .landscapeRight : .portrait
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask))
        }
    }

    private func go(_ target: Screen) {
        Haptics.tap()
        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { screen = target }
    }

    private func goHome() {
        if screen == .mic || screen == .lab { audio.stop() }
        go(.home)
    }

    /// Plays a song in the player and keeps it in My Songs.
    private func play(_ recipe: SongRecipe) {
        audio.play(recipe)
        mySongs.save(recipe)
        go(.player)
    }
}

/// Taps and thumps on iPhone; iPads have no haptic engine, so these do nothing there.
@MainActor enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func thump() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred(intensity: 1) }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}

// MARK: Shared pieces

/// Buttons shrink and spring back when pressed.
struct Squish: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.5), value: configuration.isPressed)
    }
}

/// A rounded button face: an icon and a word, always both.
struct Pill: View {
    let icon: String
    let word: String
    var color: Color = .white.opacity(0.15)
    var size: CGFloat = 22
    var selected = false

    var body: some View {
        HStack(spacing: size * 0.35) {
            Glyph(icon, size: size * 1.15)
            Text(word)
                .blasterFont(size: size, weight: .black)
                .lineLimit(1)
                .fixedSize()
        }
        .foregroundStyle(.white)
        .padding(.horizontal, size * 0.8)
        .frame(minHeight: max(52, size * 2.3))
        .background(color, in: Capsule())
        .overlay(Capsule().stroke(.white.opacity(selected ? 1 : 0.5), lineWidth: selected ? 4 : 2))
        .shadow(color: selected ? color : color.opacity(0.4), radius: selected ? 14 : 6)
    }
}

/// The "🏠 Home" button, top-left on every screen.
struct HomeButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Pill(icon: "🏠", word: "Home", color: Color.black.opacity(0.55), size: 22)
        }
        .buttonStyle(Squish())
        .accessibilityLabel("Home")
    }
}

/// A small badge: MUSIC or LIGHTS, with its kit icon.
struct KindBadge: View {
    enum Kind { case music, lights }
    let kind: Kind
    var size: CGFloat = 14

    var body: some View {
        HStack(spacing: size * 0.3) {
            Glyph(kind == .music ? "icon-music" : "icon-lights", size: size)
            Text(kind == .music ? "MUSIC" : "LIGHTS")
                .blasterFont(size: size, weight: .black)
        }
        .foregroundStyle(.black)
        .padding(.horizontal, size * 0.6)
        .padding(.vertical, size * 0.25)
        .background(kind == .music ? Neon.yellow : Neon.cyan, in: Capsule())
    }
}

/// A one-time speech-bubble hint that bobs next to a control until the child first uses it.
struct HintBubble: View {
    let id: String
    let text: String
    var pointsDown = true
    @State private var visible: Bool
    @State private var bob = false

    init(id: String, text: String, pointsDown: Bool = true) {
        self.id = id
        self.text = text
        self.pointsDown = pointsDown
        _visible = State(initialValue: !Hints.seen(id))
    }

    var body: some View {
        ZStack {
            Color.clear.frame(width: 1, height: 1)
            if visible {
                VStack(spacing: 0) {
                    if !pointsDown { triangle.rotationEffect(.degrees(180)) }
                    Text(text)
                        .blasterFont(size: 20, weight: .black)
                        .foregroundStyle(.black)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 16))
                        .fixedSize()
                    if pointsDown { triangle }
                }
                .shadow(color: Neon.yellow, radius: 10)
                .offset(y: bob ? -6 : 6)
                .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: bob)
                .transition(.scale.combined(with: .opacity))
                .onAppear { bob = true }
            }
        }
        .allowsHitTesting(false)
        .onAppear { if visible { Hints.noteShown(id) } }
        .onReceive(NotificationCenter.default.publisher(for: Hints.used)) { note in
            if note.object as? String == id { withAnimation { visible = false } }
        }
    }

    private var triangle: some View {
        Path { p in
            p.move(to: .zero)
            p.addLine(to: CGPoint(x: 20, y: 0))
            p.addLine(to: CGPoint(x: 10, y: 12))
            p.closeSubpath()
        }
        .fill(Color.white)
        .frame(width: 20, height: 12)
    }
}

extension Hints {
    static let used = Notification.Name("BeatBlasterHintUsed")

    /// Marks a hint as done forever and hides it wherever it shows.
    static func use(_ id: String) {
        guard !seen(id) else { return }
        markSeen(id)
        NotificationCenter.default.post(name: used, object: id)
    }
}

/// A screen-wide dark wash so text reads over a bright light.
struct Vignette: View {
    var body: some View {
        LinearGradient(
            colors: [.black.opacity(0.55), .clear, .clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom
        )
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
