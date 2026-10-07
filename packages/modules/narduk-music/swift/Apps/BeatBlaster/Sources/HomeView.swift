import SwiftUI

/// Home: three doors (Play, My Songs, Beat Lab), a row of extras under them and a Now Playing bar. The lights behind
/// are the only thing that moves; the chrome holds still so a kid's eye lands on Play (design canvas, Home artboard).
struct HomeView: View {
    let audio: BlasterAudio
    let mySongs: MySongs
    let go: (Screen) -> Void
    let play: (SongRecipe) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var arrived = false
    @State private var recordingCount = 0
    @State private var showCredits = false

    private struct Extra: Identifiable {
        /// nil is Mash it up, which plays a song instead of opening a screen.
        let screen: Screen?
        let icon: String
        let title: String
        let color: Color
        var id: String { title }
    }

    private let extras = [
        Extra(screen: nil, icon: "icon-surprise", title: "Mash it up", color: Neon.purple),
        Extra(screen: .lights, icon: "icon-lights", title: "Light Show", color: Neon.cyan),
        Extra(screen: .mic, icon: "icon-mic", title: "Mic", color: Neon.green),
    ]

    var body: some View {
        GeometryReader { geometry in
            let compact = min(geometry.size.width, geometry.size.height) < 500
            // A wide window puts the doors in two columns so Home fits without scrolling.
            let wide = geometry.size.width > geometry.size.height * 1.15
            ZStack {
                LiveVisual(audio: audio, tile: VisualTile.with(id: "halo"), drawing: scenePhase == .active)
                    .opacity(0.4)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                Vignette()
                // Largest layout that fits first; the songs row goes, then everything tightens, and only a window
                // too small for that scrolls.
                ViewThatFits(in: .vertical) {
                    page(compact: compact, wide: wide, tight: false, again: !mySongs.songs.isEmpty)
                    page(compact: compact, wide: wide, tight: false, again: false)
                    page(compact: compact, wide: wide, tight: true, again: false)
                    ScrollView { page(compact: compact, wide: wide, tight: true, again: false) }
                        .scrollBounceBehavior(.basedOnSize)
                }
            }
        }
        .onAppear {
            if !audio.isRunning { audio.playIfIdle() }
            arrived = true
        }
        .task(id: audio.savedCount) { recordingCount = await audio.store.load().count }
    }

    private func page(compact: Bool, wide: Bool, tight: Bool, again: Bool) -> some View {
        let spacing: CGFloat = tight ? 10 : compact ? 16 : 26
        return Group {
            if wide {
                HStack(alignment: .top, spacing: spacing) {
                    VStack(spacing: spacing) {
                        header(compact: compact, tight: tight)
                        playDoor(compact: compact, tight: tight)
                        extrasRow(compact: compact, tight: tight)
                    }
                    VStack(spacing: spacing) {
                        HStack(spacing: compact ? 12 : 20) {
                            mySongsDoor(compact: compact, tight: tight)
                            labDoor(compact: compact, tight: tight)
                        }
                        if again { playAgainRow(compact: compact) }
                        nowPlaying(compact: compact)
                    }
                }
                .frame(maxWidth: 1200)
            } else {
                VStack(spacing: spacing) {
                    header(compact: compact, tight: tight)
                    playDoor(compact: compact, tight: tight)
                    HStack(spacing: compact ? 12 : 20) {
                        mySongsDoor(compact: compact, tight: tight)
                        labDoor(compact: compact, tight: tight)
                    }
                    extrasRow(compact: compact, tight: tight)
                    if again { playAgainRow(compact: compact) }
                    nowPlaying(compact: compact)
                }
                .frame(maxWidth: 900)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(compact ? 16 : 36)
    }

    private func header(compact: Bool, tight: Bool) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: compact ? 2 : 6) {
                HomeTitle(size: tight ? 34 : compact ? 44 : 72)
                Text("The music's on. Pick a door.")
                    .blasterFont(size: tight ? 15 : compact ? 17 : 24, weight: .bold)
                    .foregroundStyle(.white.opacity(0.9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .probe("home.title")
            Spacer(minLength: 0)
            creditsButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The one big GO: a still yellow door with dark words that pulses once on arrival, then rests.
    private func playDoor(compact: Bool, tight: Bool) -> some View {
        VStack(spacing: 4) {
            HintBubble(id: "start", text: "Tap Play to start!")
            Button {
                Hints.use("start")
                go(.maker)
            } label: {
                HStack(spacing: compact ? 16 : 26) {
                    Glyph("icon-play", size: compact || tight ? 44 : 64)
                        .frame(width: tight ? 76 : compact ? 88 : 124, height: tight ? 76 : compact ? 88 : 124)
                        .background(Neon.night, in: Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Play")
                            .blasterFont(size: compact ? 40 : 60, weight: .black)
                            .lineLimit(1)
                        Text("Pick a vibe and hear it right away")
                            .blasterFont(size: compact ? 16 : 22, weight: .bold)
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .foregroundStyle(Neon.night)
                .padding(.horizontal, compact ? 20 : 34)
                .frame(maxWidth: .infinity)
                .frame(height: tight ? 120 : compact ? 156 : 210)
                .background(Neon.yellow, in: RoundedRectangle(cornerRadius: 36, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 36, style: .continuous).stroke(.white, lineWidth: 4))
                .background(
                    RoundedRectangle(cornerRadius: 36, style: .continuous).fill(Neon.pink).offset(y: 10)
                )
                .shadow(color: Neon.yellow.opacity(0.35), radius: 24, y: 14)
                .scaleEffect(arrived ? 1 : 1.04)
                .animation(.spring(response: 0.5, dampingFraction: 0.55), value: arrived)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Play: pick a vibe and hear it right away")
            .probe("home.makeSong")
        }
    }

    private func mySongsDoor(compact: Bool, tight: Bool) -> some View {
        let subtitle =
            switch recordingCount {
            case 0: "Nothing yet"
            case 1: "1 saved"
            default: "\(recordingCount) saved"
            }
        return Button {
            go(.recordings)
        } label: {
            door(
                icon: "icon-music", title: "My Songs", subtitle: subtitle, color: Neon.cyan, compact: compact,
                tight: tight)
        }
        .buttonStyle(Squish())
        .accessibilityLabel("My Songs, \(subtitle)")
        .probe("home.mySongs")
    }

    private func labDoor(compact: Bool, tight: Bool) -> some View {
        // Beat Lab keeps a beat between launches; once there is one, the door says so.
        let subtitle =
            UserDefaults.standard.data(forKey: BeatLab.savedKey) == nil ? "Build your own" : "Your beat is waiting"
        return Button {
            go(.lab)
        } label: {
            door(
                icon: "icon-beat-lab", title: "Beat Lab", subtitle: subtitle, color: Neon.orange, compact: compact,
                tight: tight)
        }
        .buttonStyle(Squish())
        .accessibilityLabel("Beat Lab: \(subtitle.lowercased())")
        .probe("home.mode.lab")
    }

    /// A smaller door: a picture top left, the word and what it does underneath, white on a dark tint.
    private func door(icon: String, title: String, subtitle: String, color: Color, compact: Bool, tight: Bool)
        -> some View
    {
        VStack(alignment: .leading, spacing: 2) {
            Glyph(icon, size: tight ? 32 : compact ? 40 : 56)
            Spacer(minLength: 6)
            Text(title)
                .blasterFont(size: compact ? 24 : 34, weight: .black)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(subtitle)
                .blasterFont(size: compact ? 15 : 20, weight: .bold)
                .opacity(0.9)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .foregroundStyle(.white)
        .padding(compact ? 16 : 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: tight ? 112 : compact ? 150 : 190)
        .background(
            LinearGradient(
                colors: [color.opacity(0.5), Neon.night.opacity(0.85)], startPoint: .top, endPoint: .bottom),
            in: RoundedRectangle(cornerRadius: 28, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(color, lineWidth: 3))
    }

    /// Mash it up, Light Show and Mic: one row of picture-and-word buttons, smaller than the doors.
    private func extrasRow(compact: Bool, tight: Bool) -> some View {
        HStack(spacing: compact ? 8 : 16) {
            ForEach(extras) { extra in
                Button {
                    if let screen = extra.screen {
                        go(screen)
                    } else {
                        Haptics.success()
                        play(SongRecipe.mashUp(lightIDs: VisualTile.all.map(\.id)))
                    }
                } label: {
                    VStack(spacing: 4) {
                        Glyph(extra.icon, size: compact ? 30 : 40)
                        Text(extra.title)
                            .blasterFont(size: compact ? 15 : 20, weight: .black)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: tight ? 64 : compact ? 76 : 96)
                    .background(Neon.night.opacity(0.7), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(extra.color, lineWidth: 2))
                }
                .buttonStyle(Squish())
                .accessibilityLabel(extra.title)
                .probe("home.mode.\(extra.screen?.rawValue ?? "mashUp")")
            }
        }
    }

    /// Songs made in the maker, replayed with one tap.
    private func playAgainRow(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Play again")
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
                                    Text(song.style.funName)
                                        .blasterFont(size: 15, weight: .bold)
                                        .opacity(0.85)
                                }
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .frame(height: 76)
                            .background(Neon.night.opacity(0.7), in: RoundedRectangle(cornerRadius: 20))
                            .overlay(RoundedRectangle(cornerRadius: 20).stroke(song.style.color, lineWidth: 2))
                        }
                        .buttonStyle(Squish())
                        .accessibilityLabel("Play \(song.name)")
                    }
                }
                .padding(.vertical, 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var creditsButton: some View {
        Button {
            showCredits = true
        } label: {
            Text("Credits")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.75))
                .frame(minWidth: 88, minHeight: 44)
        }
        .accessibilityIdentifier("home.credits")
        .sheet(isPresented: $showCredits) { CreditsView() }
    }

    /// What is playing now, with Open to jump back into the Player.
    private func nowPlaying(compact: Bool) -> some View {
        Button {
            go(.player)
        } label: {
            HStack(spacing: 14) {
                VibeArt(style: audio.recipe.style, size: compact ? 56 : 68)
                VStack(alignment: .leading, spacing: 2) {
                    Text("NOW PLAYING")
                        .blasterFont(size: 15, weight: .black)
                        .foregroundStyle(Neon.cyan)
                    Text(audio.recipe.name)
                        .blasterFont(size: compact ? 20 : 24, weight: .black)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text("Open")
                    .blasterFont(size: 18, weight: .black)
                    .foregroundStyle(Neon.night)
                    .padding(.horizontal, 18)
                    .frame(height: 48)
                    .background(Neon.yellow, in: Capsule())
            }
            .padding(.leading, 10)
            .padding(.trailing, 14)
            .frame(minHeight: compact ? 80 : 92)
            .background(.black.opacity(0.6), in: Capsule())
            .overlay(Capsule().stroke(.white.opacity(0.35), lineWidth: 2))
        }
        .buttonStyle(Squish())
        .accessibilityLabel("Now playing \(audio.recipe.name). Open the player")
        .probe("home.nowPlaying")
    }
}

/// "BEAT BLASTER", still: yellow with a pink drop, left aligned over the doors.
struct HomeTitle: View {
    let size: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: -size * 0.12) {
            word("BEAT")
            word("BLASTER")
        }
        .accessibilityElement()
        .accessibilityLabel("Beat Blaster")
        .accessibilityAddTraits(.isHeader)
    }

    private func word(_ text: String) -> some View {
        Text(text)
            .blasterFont(size: size, weight: .black)
            .foregroundStyle(Neon.yellow)
            .shadow(color: Neon.pink, radius: 0, x: 0, y: size * 0.09)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}
