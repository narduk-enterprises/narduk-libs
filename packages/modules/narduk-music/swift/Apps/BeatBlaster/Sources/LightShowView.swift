import SwiftUI

/// One visualizer edge to edge: swipe for the next one, tap to call `onTap`.
struct SwipeStage: View {
    let audio: BlasterAudio
    @Binding var index: Int
    let onTap: () -> Void
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let tiles = VisualTile.all
        let tile = tiles[(index % tiles.count + tiles.count) % tiles.count]
        LiveVisual(audio: audio, tile: tile, drawing: scenePhase == .active)
            .id(tile.id)
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

/// The visual's name, flashed big for a moment after each change.
struct TileNameBanner: View {
    let index: Int
    @State private var visible = false

    var body: some View {
        let tiles = VisualTile.all
        let name = tiles[(index % tiles.count + tiles.count) % tiles.count].name
        NeonPill(text: name, color: Neon.purple, size: 30)
            .opacity(visible ? 1 : 0)
            .scaleEffect(visible ? 1 : 0.6)
            .animation(.spring(response: 0.4, dampingFraction: 0.6), value: visible)
            .allowsHitTesting(false)
            .task(id: index) {
                visible = true
                try? await Task.sleep(for: .seconds(1.6))
                if !Task.isCancelled { visible = false }
            }
    }
}

/// Light Show: the visualizers full screen. Swipe between them; tap for the song picker, auto-play and back.
struct LightShowView: View {
    let audio: BlasterAudio
    let back: () -> Void
    @State private var index = 0
    @State private var overlay = true
    @State private var autoCycle = false
    @State private var overlayTick = 0

    var body: some View {
        ZStack {
            SwipeStage(audio: audio, index: $index) {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { overlay.toggle() }
                overlayTick += 1
            }
            TileNameBanner(index: index)
            if overlay {
                controls.transition(.opacity.combined(with: .scale(scale: 0.95)))
            }
        }
        .onAppear {
            audio.playIfIdle()
            if let id = UserDefaults.standard.string(forKey: "tile"),
                let found = VisualTile.all.firstIndex(where: { $0.id == id })
            {
                index = found
            }
        }
        .task(id: autoCycle) {
            while autoCycle, !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                guard autoCycle, !Task.isCancelled else { return }
                withAnimation(.easeInOut(duration: 0.6)) { index += 1 }
            }
        }
        .task(id: overlayTick) {
            // The controls tuck away after a while so the show fills the screen.
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { withAnimation { overlay = false } }
        }
    }

    private var controls: some View {
        VStack {
            HStack(spacing: 14) {
                BackButton(action: back)
                Spacer()
                Button {
                    Haptics.tap()
                    autoCycle.toggle()
                    overlayTick += 1
                } label: {
                    NeonPill(text: autoCycle ? "🔁 Auto: ON" : "🔁 Auto: OFF", color: autoCycle ? Neon.green : .gray, size: 20)
                }
                .buttonStyle(Squish())
                Button {
                    Haptics.success()
                    audio.newSong()
                    overlayTick += 1
                } label: {
                    NeonPill(text: "🎲", color: Neon.orange, size: 22)
                }
                .buttonStyle(Squish())
                .accessibilityLabel("New song")
            }
            Spacer()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(BlasterStyle.all) { style in
                        let selected = audio.song.style == style
                        Button {
                            Haptics.tap()
                            var song = audio.song
                            song.style = style
                            song.title = nil
                            song.reroll()
                            audio.play(song)
                            overlayTick += 1
                        } label: {
                            HStack(spacing: 6) {
                                Text(style.emoji).font(.system(size: 30))
                                Text(style.funName)
                                    .font(.system(size: 18, weight: .black, design: .rounded))
                                    .foregroundStyle(.white)
                            }
                            .padding(.horizontal, 16)
                            .frame(height: 64)
                            .background(style.color.opacity(selected ? 0.9 : 0.4), in: Capsule())
                            .overlay(Capsule().stroke(.white.opacity(selected ? 1 : 0.3), lineWidth: selected ? 3 : 1.5))
                            .shadow(color: selected ? style.color : .clear, radius: 12)
                        }
                        .buttonStyle(Squish())
                    }
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 10)
            }
            Text("👈 swipe for more lights 👉")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.8))
        }
        .padding(24)
        .background(Vignette())
    }
}

/// Mic Mode: the microphone drives the visualizers. Permission is asked only on entering this screen.
struct MicView: View {
    let audio: BlasterAudio
    let back: () -> Void
    @State private var index = 1

    var body: some View {
        ZStack {
            if let problem = audio.micProblem {
                micOff(problem)
            } else {
                SwipeStage(audio: audio, index: $index) {
                    Haptics.tap()
                    withAnimation(.easeInOut(duration: 0.35)) { index += 1 }
                }
                TileNameBanner(index: index)
                VStack {
                    HStack {
                        BackButton(action: leave)
                        Spacer()
                    }
                    Spacer()
                    MicPrompt(audio: audio)
                }
                .padding(24)
            }
        }
        .task { await audio.startMicrophone() }
    }

    private func leave() {
        audio.stop()
        back()
    }

    private func micOff(_ problem: String) -> some View {
        VStack(spacing: 24) {
            Text("🙉").font(.system(size: 120))
            Text(problem == "denied" ? "The microphone is off" : "No microphone found")
                .font(.system(size: 40, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            Text(
                problem == "denied"
                    ? "Ask a grown-up to turn on the microphone for Beat Blaster in Settings."
                    : "Try Light Show instead!"
            )
            .font(.system(size: 22, weight: .bold, design: .rounded))
            .foregroundStyle(.white.opacity(0.8))
            .multilineTextAlignment(.center)
            Button(action: leave) {
                NeonPill(text: "Back home", color: Neon.pink, size: 28)
            }
            .buttonStyle(Squish())
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
            Text(level > 0.55 ? "WHOA! LOUD! 🔥" : "🎤 Clap, sing, yell!")
                .font(.system(size: 34, weight: .black, design: .rounded))
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
