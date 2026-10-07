import NardukSoundAnalysis
import NardukSoundVisuals
import SwiftUI

/// Make a Beat: song cards, a new-song die, jam controls and the giant DROP button over a live visualizer.
struct BeatView: View {
    let audio: BlasterAudio
    let back: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var tileIndex = 1
    @State private var boomID = 0

    private var tile: VisualTile { VisualTile.all[tileIndex % VisualTile.all.count] }

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            ZStack {
                stage.ignoresSafeArea()
                Vignette()
                VStack(spacing: compact ? 10 : 18) {
                    topBar(compact: compact)
                    Spacer(minLength: 0)
                    songCards(compact: compact)
                    HStack(alignment: .bottom, spacing: compact ? 10 : 20) {
                        jamControls(compact: compact)
                        Spacer(minLength: 0)
                        DropButton(audio: audio, size: compact ? 120 : 190) { boomID += 1 }
                    }
                }
                .padding(compact ? 14 : 28)
                BoomText(audio: audio, trigger: boomID).allowsHitTesting(false)
            }
        }
        .onAppear { audio.playIfIdle() }
    }

    /// The visualizer, shaking while DROP is held and flashing when it lands. One timeline polls one frame per tick.
    private var stage: some View {
        let drawing = scenePhase == .active
        return TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !drawing)) { timeline in
            let now = timeline.date
            let context = TileContext(
                audio: audio, frame: audio.poll(at: now), framesPerSecond: drawing ? SoundRenderBudget.normal : 0)
            let charge = audio.surgeStart.map { min(1, now.timeIntervalSince($0) / 3) } ?? 0
            let sinceDrop = audio.lastDrop.map { now.timeIntervalSince($0) } ?? 99
            let flash = max(0, 1 - sinceDrop / 0.7)
            let jitter = 18 * charge + 30 * flash
            let t = now.timeIntervalSinceReferenceDate
            ZStack {
                tile.content(context)
                    .scaleEffect(1 + 0.06 * charge + 0.1 * flash)
                    .offset(x: sin(t * 61) * jitter, y: cos(t * 47) * jitter)
                    .hueRotation(.degrees(charge * 140))
                Color.white.opacity(0.85 * flash * flash)
                RadialGradient(
                    colors: [.clear, Neon.pink.opacity(0.55 * charge)], center: .center, startRadius: 100,
                    endRadius: 900)
            }
            .background(Neon.night)
        }
    }

    private func topBar(compact: Bool) -> some View {
        HStack(spacing: 14) {
            BackButton(action: back)
            VStack(alignment: .leading, spacing: 0) {
                Text("\(audio.song.style.emoji) \(audio.song.displayTitle)")
                    .font(.system(size: compact ? 24 : 40, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .shadow(color: audio.song.style.color, radius: 10)
                Text(audio.song.style.genreName)
                    .font(.system(size: compact ? 14 : 18, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.75))
            }
            Spacer(minLength: 0)
            Button {
                Haptics.tap()
                tileIndex += 1
            } label: {
                roundIcon("sparkles", color: Neon.cyan, compact: compact)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Change the lights")
            Button {
                Haptics.success()
                audio.newSong()
            } label: {
                NeonPill(text: compact ? "🎲 New" : "🎲 New Song", color: Neon.orange, size: compact ? 18 : 24)
            }
            .buttonStyle(Squish())
        }
    }

    private func songCards(compact: Bool) -> some View {
        ScrollViewReader { reader in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: compact ? 10 : 16) {
                    ForEach(BlasterStyle.all) { style in
                        let selected = audio.song.style == style && audio.isRunning
                        Button {
                            Haptics.tap()
                            var song = audio.song
                            song.style = style
                            song.title = nil
                            song.reroll()
                            audio.play(song)
                            tileIndex += 1
                        } label: {
                            VStack(spacing: 4) {
                                Text(style.emoji).font(.system(size: compact ? 36 : 54))
                                Text(style.funName)
                                    .font(.system(size: compact ? 14 : 19, weight: .black, design: .rounded))
                                    .foregroundStyle(.white)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.6)
                            }
                            .frame(width: compact ? 104 : 150, height: compact ? 96 : 140)
                            .background(
                                style.color.opacity(selected ? 0.9 : 0.45),
                                in: RoundedRectangle(cornerRadius: 24, style: .continuous)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 24, style: .continuous)
                                    .stroke(.white.opacity(selected ? 1 : 0.35), lineWidth: selected ? 4 : 2)
                            )
                            .shadow(color: style.color.opacity(selected ? 1 : 0.4), radius: selected ? 18 : 6)
                            .scaleEffect(selected ? 1.06 : 1)
                            .animation(.spring(response: 0.3, dampingFraction: 0.55), value: selected)
                        }
                        .buttonStyle(Squish())
                        .id(style.id)
                    }
                }
                .padding(.vertical, 14)
                .padding(.horizontal, 6)
            }
            .onAppear { reader.scrollTo(audio.song.style.id, anchor: .center) }
        }
    }

    private func jamControls(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 8 : 12) {
            HStack(spacing: compact ? 6 : 10) {
                tempoButton("🐢", 0.8, label: "Slow", compact: compact)
                tempoButton("🚶", 1.0, label: "Normal speed", compact: compact)
                tempoButton("🐇", 1.2, label: "Fast", compact: compact)
            }
            Button {
                Haptics.thump()
                audio.toggleBass()
            } label: {
                Text(audio.bigBass ? "🔊 MEGA BASS" : "🔈 More Bass")
                    .font(.system(size: compact ? 16 : 24, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, compact ? 14 : 22)
                    .frame(height: compact ? 48 : 68)
                    .background(
                        (audio.bigBass ? Neon.green : Color.white.opacity(0.12)),
                        in: Capsule()
                    )
                    .overlay(Capsule().stroke(.white.opacity(0.5), lineWidth: 2))
                    .shadow(color: audio.bigBass ? Neon.green : .clear, radius: 14)
            }
            .buttonStyle(Squish())
        }
    }

    private func tempoButton(_ emoji: String, _ scale: Double, label: String, compact: Bool) -> some View {
        let selected = abs(audio.tempoScale - scale) < 0.01
        return Button {
            Haptics.tap()
            audio.setTempo(scale)
        } label: {
            Text(emoji)
                .font(.system(size: compact ? 26 : 40))
                .frame(width: compact ? 52 : 76, height: compact ? 52 : 76)
                .background(selected ? Neon.yellow.opacity(0.8) : .white.opacity(0.12), in: Circle())
                .overlay(Circle().stroke(.white.opacity(selected ? 1 : 0.4), lineWidth: selected ? 3 : 2))
                .shadow(color: selected ? Neon.yellow : .clear, radius: 12)
        }
        .buttonStyle(Squish())
        .accessibilityLabel(label)
    }

    private func roundIcon(_ symbol: String, color: Color, compact: Bool) -> some View {
        Image(systemName: symbol)
            .font(.system(size: compact ? 22 : 30, weight: .heavy))
            .foregroundStyle(.white)
            .frame(width: compact ? 52 : 68, height: compact ? 52 : 68)
            .background(color.opacity(0.7), in: Circle())
            .overlay(Circle().stroke(.white.opacity(0.6), lineWidth: 2))
            .shadow(color: color, radius: 12)
    }
}

/// The giant DROP button: hold to charge (a ring fills, the screen shakes), let go to land the drop.
struct DropButton: View {
    let audio: BlasterAudio
    let size: CGFloat
    let onDrop: () -> Void
    @State private var pressing = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !pressing)) { timeline in
            let charge = audio.surgeStart.map { min(1, timeline.date.timeIntervalSince($0) / 3) } ?? 0
            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Neon.yellow, Neon.orange, Neon.pink], center: .center, startRadius: 0,
                            endRadius: size * 0.6))
                Circle().stroke(.white.opacity(0.85), lineWidth: 5)
                Circle()
                    .trim(from: 0, to: charge)
                    .stroke(Neon.cyan, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .padding(-12)
                VStack(spacing: 0) {
                    Text("DROP!")
                        .font(.system(size: size * 0.24, weight: .black, design: .rounded))
                    Text(pressing ? "let go!" : "hold me")
                        .font(.system(size: size * 0.1, weight: .heavy, design: .rounded))
                        .opacity(0.85)
                }
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.4), radius: 3)
            }
            .frame(width: size, height: size)
            .scaleEffect(pressing ? 0.92 + 0.12 * charge : 1)
            .shadow(color: Neon.pink, radius: 20 + 30 * charge)
        }
        .contentShape(Circle())
        .onLongPressGesture(
            minimumDuration: 600, maximumDistance: 400, perform: {},
            onPressingChanged: { isPressing in
                pressing = isPressing
                if isPressing {
                    Haptics.tap()
                    audio.beginSurge()
                } else {
                    Haptics.thump()
                    audio.endSurge()
                    onDrop()
                }
            }
        )
        .animation(.spring(response: 0.25, dampingFraction: 0.45), value: pressing)
        .accessibilityElement()
        .accessibilityLabel("Drop")
        .accessibilityHint("Hold to build up, let go to drop")
        .accessibilityAddTraits(.isButton)
    }
}

/// A big "BOOM!" that bursts out when a drop lands.
struct BoomText: View {
    let audio: BlasterAudio
    let trigger: Int
    @State private var live = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !live)) { timeline in
            let since = audio.lastDrop.map { timeline.date.timeIntervalSince($0) } ?? 99
            if since < 1.2 {
                let p = since / 1.2
                Text("BOOM!")
                    .font(.system(size: 160, weight: .black, design: .rounded))
                    .italic()
                    .foregroundStyle(
                        LinearGradient(colors: [Neon.yellow, Neon.pink], startPoint: .top, endPoint: .bottom)
                    )
                    .shadow(color: Neon.pink, radius: 30)
                    .scaleEffect(0.5 + 1.2 * p)
                    .opacity(1 - p * p)
                    .rotationEffect(.degrees(-8))
                    .minimumScaleFactor(0.3)
            }
        }
        .task(id: trigger) {
            guard trigger > 0 else { return }
            live = true
            try? await Task.sleep(for: .seconds(1.3))
            if !Task.isCancelled { live = false }
        }
    }
}
