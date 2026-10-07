import SwiftUI

/// Home: one giant "Make a Song" button, the other modes as labelled buttons under it, and My Songs.
struct HomeView: View {
    let audio: BlasterAudio
    let mySongs: MySongs
    let go: (Screen) -> Void
    let play: (SongRecipe) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var appeared = false
    @State private var recordingCount = 0

    private struct Mode: Identifiable {
        let screen: Screen
        let emoji: String
        let title: String
        let subtitle: String
        let color: Color
        var id: Screen { screen }
    }

    private let modes = [
        Mode(
            screen: .lab, emoji: "icon-beat-lab", title: "Beat Lab", subtitle: "Build a beat yourself",
            color: Neon.orange),
        Mode(screen: .lights, emoji: "💡", title: "Light Show", subtitle: "Watch the lights dance", color: Neon.cyan),
        Mode(screen: .mic, emoji: "🎤", title: "Mic Mode", subtitle: "Clap, sing, yell!", color: Neon.green),
        Mode(screen: .dream, emoji: "✨", title: "Dream a Song", subtitle: "Type an idea", color: Neon.purple),
    ]

    var body: some View {
        GeometryReader { geometry in
            let wide = geometry.size.width > geometry.size.height
            let compact = geometry.size.width < 500
            ZStack {
                LiveVisual(audio: audio, tile: VisualTile.with(id: "halo"), drawing: scenePhase == .active)
                    .opacity(0.4)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                Vignette()
                ScrollView {
                    VStack(spacing: compact ? 18 : 30) {
                        PulsingTitle(audio: audio, size: compact ? 48 : 92)
                            .padding(.top, compact ? 10 : 30)
                        startButton(compact: compact)
                        LazyVGrid(
                            columns: Array(
                                repeating: GridItem(.flexible(), spacing: compact ? 12 : 18), count: wide ? 4 : 2),
                            spacing: compact ? 12 : 18
                        ) {
                            ForEach(Array(modes.enumerated()), id: \.element.id) { index, mode in
                                Button {
                                    go(mode.screen)
                                } label: {
                                    modeCard(mode, compact: compact)
                                }
                                .buttonStyle(Squish())
                                .scaleEffect(appeared ? 1 : 0.3)
                                .opacity(appeared ? 1 : 0)
                                .animation(
                                    .spring(response: 0.55, dampingFraction: 0.65).delay(0.1 + 0.07 * Double(index)),
                                    value: appeared)
                            }
                        }
                        recordingsButton(compact: compact)
                        if !mySongs.songs.isEmpty { mySongsRow(compact: compact) }
                    }
                    .frame(maxWidth: 1100)
                    .frame(maxWidth: .infinity)
                    .padding(compact ? 16 : 36)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .onAppear {
            if !audio.isRunning { audio.playIfIdle() }
            appeared = true
            recordingCount = audio.store.list().count
        }
        .onChange(of: audio.savedCount) { recordingCount = audio.store.list().count }
    }

    private func startButton(compact: Bool) -> some View {
        VStack(spacing: 4) {
            HintBubble(id: "start", text: "👇 Tap here to start!")
            Button {
                Hints.use("start")
                go(.maker)
            } label: {
                StartButtonFace(compact: compact)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Make a Song")
            .accessibilityIdentifier("home.makeSong")
        }
    }

    private func modeCard(_ mode: Mode, compact: Bool) -> some View {
        VStack(spacing: compact ? 4 : 8) {
            Glyph(mode.emoji, size: compact ? 36 : 54)
            Text(mode.title)
                .blasterFont(size: compact ? 18 : 26, weight: .black)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(mode.subtitle)
                .blasterFont(size: compact ? 12 : 16, weight: .bold)
                .opacity(0.85)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .frame(height: compact ? 120 : 170)
        .background(mode.color.opacity(0.45), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(.white.opacity(0.55), lineWidth: 2))
        .shadow(color: mode.color.opacity(0.6), radius: 12)
    }

    /// 🎙 My Songs: the recordings the player made (shown once there is at least one).
    @ViewBuilder private func recordingsButton(compact: Bool) -> some View {
        if recordingCount > 0 {
            Button {
                go(.recordings)
            } label: {
                Pill(
                    icon: "🎙", word: "My Songs · \(recordingCount) recorded", color: Neon.green.opacity(0.7),
                    size: compact ? 20 : 26)
            }
            .buttonStyle(Squish())
            .accessibilityIdentifier("home.mySongs")
        }
    }

    private func mySongsRow(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("⭐️ My Songs  ·  tap one to play it")
                .blasterFont(size: compact ? 20 : 26, weight: .black)
                .foregroundStyle(.white)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(mySongs.songs) { song in
                        Button {
                            play(song)
                        } label: {
                            HStack(spacing: 10) {
                                VibeArt(style: song.style, size: 44)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(song.name)
                                        .blasterFont(size: 18, weight: .black)
                                        .lineLimit(1)
                                    Text("▶︎ Play  ·  \(song.style.funName)")
                                        .blasterFont(size: 13, weight: .bold)
                                        .opacity(0.8)
                                }
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .frame(height: 76)
                            .background(song.style.color.opacity(0.45), in: RoundedRectangle(cornerRadius: 20))
                            .overlay(RoundedRectangle(cornerRadius: 20).stroke(.white.opacity(0.5), lineWidth: 2))
                        }
                        .buttonStyle(Squish())
                    }
                }
                .padding(.vertical, 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The giant primary button; it breathes so it reads as "press me".
struct StartButtonFace: View {
    let compact: Bool
    @State private var breathe = false

    var body: some View {
        HStack(spacing: compact ? 12 : 20) {
            Glyph("🎵", size: compact ? 44 : 76)
            VStack(alignment: .leading, spacing: 2) {
                Text("Make a Song")
                    .blasterFont(size: compact ? 34 : 60, weight: .black)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text("Pick a vibe, a band and lights")
                    .blasterFont(size: compact ? 14 : 22, weight: .bold)
                    .opacity(0.9)
            }
            Glyph("icon-play", size: compact ? 34 : 56)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, compact ? 20 : 44)
        .padding(.vertical, compact ? 18 : 30)
        .frame(maxWidth: 900)
        .background(
            LinearGradient(colors: [Neon.pink, Neon.purple], startPoint: .leading, endPoint: .trailing),
            in: RoundedRectangle(cornerRadius: 40, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 40, style: .continuous).stroke(.white, lineWidth: 4))
        .shadow(color: Neon.pink, radius: breathe ? 34 : 14)
        .scaleEffect(breathe ? 1.03 : 1)
        .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: breathe)
        .onAppear { breathe = true }
    }
}

/// "BEAT BLASTER" in a moving rainbow that swells with the music. It reads the latest frame on its own clock (the
/// background light polls), so it never polls the analyzer a second time.
struct PulsingTitle: View {
    let audio: BlasterAudio
    let size: CGFloat

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let pump = audio.isRunning ? audio.level : (0.5 + 0.5 * sin(t * 2.4)) * 0.3
            let shift = t.truncatingRemainder(dividingBy: 6) / 6
            VStack(spacing: -size * 0.22) {
                word("BEAT", shift: shift)
                word("BLASTER", shift: shift + 0.3)
            }
            .scaleEffect(1 + 0.1 * pump)
            .rotationEffect(.degrees(sin(t * 1.3) * 2))
            .shadow(color: Neon.pink.opacity(0.4 + 0.6 * pump), radius: 10 + 30 * pump)
        }
        .accessibilityElement()
        .accessibilityLabel("Beat Blaster")
        .accessibilityAddTraits(.isHeader)
    }

    private func word(_ text: String, shift: Double) -> some View {
        let colors = (0..<7).map { Neon.cycle[($0 + Int(shift * 6)) % Neon.cycle.count] }
        return Text(text)
            .blasterFont(size: size, weight: .black)
            .foregroundStyle(LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing))
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}
