import SwiftUI

/// Prev / Next buttons with words, and the light's name between them.
struct LightStepper: View {
    @Binding var index: Int
    var compact = false

    var body: some View {
        let tiles = VisualTile.all
        let tile = tiles[(index % tiles.count + tiles.count) % tiles.count]
        HStack(spacing: 10) {
            Button {
                Haptics.tap()
                withAnimation(.easeInOut(duration: 0.35)) { index -= 1 }
            } label: {
                Pill(icon: "icon-back", word: "Prev", color: .black.opacity(0.5), size: compact ? 16 : 22)
            }
            .buttonStyle(Squish())
            HStack(spacing: 6) {
                KindBadge(kind: .lights, size: 12)
                Text(tile.name)
                    .blasterFont(size: compact ? 18 : 26, weight: .black)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(.black.opacity(0.5), in: Capsule())
            Button {
                Haptics.tap()
                withAnimation(.easeInOut(duration: 0.35)) { index += 1 }
            } label: {
                Pill(icon: "icon-next", word: "Next", color: .black.opacity(0.5), size: compact ? 16 : 22)
            }
            .buttonStyle(Squish())
        }
    }
}

/// One light edge to edge; swiping left or right is a bonus way to change it.
struct SwipeStage: View {
    let audio: BlasterAudio
    @Binding var index: Int
    let onTap: () -> Void
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let tiles = VisualTile.all
        let tile = tiles[(index % tiles.count + tiles.count) % tiles.count]
        LiveVisual(audio: audio, tile: tile, drawing: scenePhase == .active)
            .transition(.opacity)
            .ignoresSafeArea()
            .background(Neon.night)
            .contentShape(Rectangle())
            .onTapGesture(perform: onTap)
            .gesture(
                DragGesture(minimumDistance: 30).onEnded { drag in
                    guard abs(drag.translation.width) > abs(drag.translation.height) else { return }
                    Haptics.tap()
                    withAnimation(.easeInOut(duration: 0.35)) { index += drag.translation.width < 0 ? 1 : -1 }
                }
            )
    }
}

/// Light Show: the lights full screen. Controls show at first, tuck away after 8 s, and a "Show controls" button
/// brings them back.
struct LightShowView: View {
    let audio: BlasterAudio
    let home: () -> Void
    @State private var index = 0
    @State private var controlsShown = true
    @State private var autoCycle = false
    @State private var activity = 0
    @State private var musicPanel = false

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            ZStack {
                SwipeStage(audio: audio, index: $index) { wake() }
                if controlsShown {
                    controls(compact: compact).transition(.opacity)
                } else {
                    VStack {
                        HStack {
                            HomeButton(action: home)
                            Spacer()
                            Button(action: wake) {
                                Pill(
                                    icon: "🎛️", word: "Show controls", color: .black.opacity(0.55),
                                    size: compact ? 16 : 20)
                            }
                            .buttonStyle(Squish())
                        }
                        Spacer()
                    }
                    .padding(compact ? 12 : 24)
                    .transition(.opacity)
                }
                if musicPanel {
                    PickerPanel(title: "Pick the music", badge: .music, close: closeMusic) {
                        MusicGrid(selectedID: audio.recipe.styleID, compact: compact) { style in
                            var next = audio.recipe
                            next.styleID = style.id
                            audio.swap(to: next)
                            activity += 1
                        }
                    }
                    .transition(.move(edge: .bottom))
                }
            }
        }
        .onAppear {
            audio.playIfIdle()
            index = VisualTile.index(of: audio.lightsID)
        }
        .onChange(of: index) { _, new in
            let tiles = VisualTile.all
            audio.lightsID = tiles[(new % tiles.count + tiles.count) % tiles.count].id
        }
        .task(id: autoCycle) {
            while autoCycle, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard autoCycle, !Task.isCancelled else { return }
                withAnimation(.easeInOut(duration: 0.6)) { index += 1 }
            }
        }
        .task(id: activity) {
            try? await Task.sleep(for: .seconds(8))
            if !Task.isCancelled, !musicPanel { withAnimation { controlsShown = false } }
        }
    }

    private func wake() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { controlsShown = true }
        activity += 1
    }

    private func closeMusic() {
        withAnimation { musicPanel = false }
        activity += 1
    }

    private func controls(compact: Bool) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 12) {
                HomeButton(action: home)
                Text("Light Show")
                    .blasterFont(size: compact ? 22 : 36, weight: .black)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Spacer(minLength: 0)
                Button {
                    withAnimation { controlsShown = false }
                } label: {
                    Pill(icon: "🙈", word: "Hide", color: .black.opacity(0.5), size: compact ? 16 : 20)
                }
                .buttonStyle(Squish())
            }
            Spacer()
            LightStepper(index: $index, compact: compact).simultaneousGesture(TapGesture().onEnded { activity += 1 })
            Button {
                Haptics.tap()
                autoCycle.toggle()
                activity += 1
            } label: {
                Pill(
                    icon: "🔁", word: autoCycle ? "Auto change: ON" : "Auto change: OFF",
                    color: autoCycle ? Neon.green.opacity(0.7) : .black.opacity(0.5), size: compact ? 16 : 20,
                    selected: autoCycle)
            }
            .buttonStyle(Squish())
            MusicLightsBar(
                audio: audio,
                changeMusic: {
                    withAnimation { musicPanel = true }
                    activity += 1
                },
                changeLights: {
                    withAnimation { index += 1 }
                    activity += 1
                })
        }
        .padding(compact ? 12 : 24)
        .background(Vignette())
    }
}

/// Mic Mode: the microphone drives the lights. Permission is asked only on entering this screen.
struct MicView: View {
    let audio: BlasterAudio
    let home: () -> Void
    @State private var index = 7

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            ZStack {
                if let problem = audio.micProblem {
                    micOff(problem)
                } else {
                    SwipeStage(audio: audio, index: $index) {}
                    VStack(spacing: 14) {
                        HStack {
                            HomeButton(action: home)
                            Text("Mic Mode")
                                .blasterFont(size: compact ? 22 : 36, weight: .black)
                                .foregroundStyle(.white)
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                            Spacer()
                        }
                        Spacer()
                        MicPrompt(audio: audio)
                        LightStepper(index: $index, compact: compact)
                    }
                    .padding(compact ? 12 : 24)
                    .background(Vignette())
                }
            }
        }
        .task { await audio.startMicrophone() }
    }

    private func micOff(_ problem: String) -> some View {
        VStack(spacing: 24) {
            HStack {
                HomeButton(action: home)
                Spacer()
            }
            Spacer()
            Glyph("icon-mic", size: 110)
            Text(problem == "denied" ? "The microphone is off" : "No microphone found")
                .blasterFont(size: 40, weight: .black)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            Text(
                problem == "denied"
                    ? "Ask a grown-up to turn on the microphone for Beat Blaster in Settings."
                    : "Try the Light Show instead!"
            )
            .blasterFont(size: 22, weight: .bold)
            .foregroundStyle(.white.opacity(0.8))
            .multilineTextAlignment(.center)
            Spacer()
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Neon.night)
    }
}

/// "Clap, sing, yell!" that grows with how loud the room is.
struct MicPrompt: View {
    let audio: BlasterAudio

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { _ in
            let level = audio.level
            Text(level > 0.55 ? "WHOA! LOUD!" : "Clap, sing, yell!")
                .blasterFont(size: 34, weight: .black)
                .foregroundStyle(.white)
                .padding(.horizontal, 28)
                .padding(.vertical, 14)
                .background(Neon.green.opacity(0.35 + 0.5 * level), in: Capsule())
                .overlay(Capsule().stroke(.white.opacity(0.7), lineWidth: 2))
                .shadow(color: Neon.green, radius: 10 + 30 * level)
                .scaleEffect(1 + 0.25 * level)
        }
        .allowsHitTesting(false)
    }
}
