import NardukSoundAnalysis
import NardukSoundVisuals
import SwiftUI

/// The player: the song's lights full screen, the steering controls (Energy, band, Surprise me, DROP) and the
/// MUSIC / LIGHTS bar.
struct PlayerView: View {
    let audio: BlasterAudio
    let mySongs: MySongs
    let home: () -> Void
    let newSong: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var panel: Panel?
    @State private var boomID = 0

    enum Panel { case music, lights }

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            ZStack {
                DropStage(audio: audio, drawing: scenePhase == .active).ignoresSafeArea()
                Vignette()
                VStack(spacing: compact ? 8 : 14) {
                    topBar(compact: compact)
                    Spacer(minLength: 0)
                    SteeringPanel(audio: audio, compact: compact) { boomID += 1 }
                    MusicLightsBar(
                        audio: audio,
                        changeMusic: { open(.music) },
                        changeLights: { open(.lights) })
                }
                .padding(compact ? 12 : 24)
                BoomText(audio: audio, trigger: boomID).allowsHitTesting(false)
                if let panel { picker(panel, compact: compact) }
            }
        }
        .onAppear { audio.playIfIdle() }
    }

    private func topBar(compact: Bool) -> some View {
        HStack(spacing: 12) {
            HomeButton(action: home)
            VStack(alignment: .leading, spacing: 0) {
                Text("Now playing")
                    .font(.system(size: compact ? 12 : 15, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white.opacity(0.7))
                Text("\(audio.recipe.style.emoji) \(audio.recipe.name)")
                    .font(.system(size: compact ? 20 : 34, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .shadow(color: audio.recipe.style.color, radius: 10)
            }
            Spacer(minLength: 0)
            Button(action: newSong) {
                Pill(icon: "➕", word: compact ? "New" : "New song", color: Neon.pink.opacity(0.7), size: compact ? 16 : 20)
            }
            .buttonStyle(Squish())
        }
    }

    private func open(_ which: Panel) {
        Haptics.tap()
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { panel = which }
    }

    private func close() {
        withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { panel = nil }
    }

    @ViewBuilder private func picker(_ which: Panel, compact: Bool) -> some View {
        switch which {
        case .music:
            PickerPanel(title: "Pick the music", badge: .music, close: close) {
                MusicGrid(selectedID: audio.recipe.styleID, compact: compact) { style in
                    var next = audio.recipe
                    next.styleID = style.id
                    if style == .guitars { next.band.insert(.guitar) }
                    audio.play(next)
                    mySongs.save(next)
                }
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        case .lights:
            PickerPanel(title: "Pick the lights", badge: .lights, close: close) {
                LightsGrid(audio: audio, selectedID: audio.lightsID, compact: compact) { id in
                    audio.update { $0.lightsID = id }
                    mySongs.save(audio.recipe)
                }
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}

/// The song's light, shaking and tinting while DROP is held and flashing when the drop lands. One timeline polls one
/// frame per tick; every per-frame value is read here, never observed.
struct DropStage: View {
    let audio: BlasterAudio
    let drawing: Bool

    var body: some View {
        let tile = VisualTile.with(id: audio.lightsID)
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !drawing)) { timeline in
            let now = timeline.date
            let context = TileContext(
                audio: audio, frame: audio.poll(at: now), framesPerSecond: drawing ? SoundRenderBudget.normal : 0)
            let charge = audio.surgeStart.map { min(1, now.timeIntervalSince($0) / DropMachine.fullChargeSeconds) } ?? 0
            let sinceDrop = audio.lastDrop.map { now.timeIntervalSince($0) } ?? 99
            let flash = sinceDrop >= 0 ? max(0, 1 - sinceDrop / 0.7) : 0
            let jitter = 16 * charge + 30 * flash
            let t = now.timeIntervalSinceReferenceDate
            ZStack {
                tile.content(context)
                    .id(tile.id)
                    .scaleEffect(1 + 0.08 * charge + 0.1 * flash)
                    .offset(x: sin(t * 61) * jitter, y: cos(t * 47) * jitter)
                    .hueRotation(.degrees(charge * 140))
                Color.white.opacity(0.85 * flash * flash)
                RadialGradient(
                    colors: [.clear, Neon.pink.opacity(0.6 * charge)], center: .center, startRadius: 100,
                    endRadius: 900)
            }
            .background(Neon.night)
        }
    }
}

/// The live steering controls.
struct SteeringPanel: View {
    let audio: BlasterAudio
    let compact: Bool
    let onDrop: () -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: compact ? 10 : 20) {
            VStack(alignment: .leading, spacing: compact ? 8 : 12) {
                ZStack(alignment: .topLeading) {
                    EnergySlider(audio: audio, compact: compact)
                    HintBubble(id: "energy", text: "Slide for more energy!").offset(x: 120, y: compact ? -64 : -72)
                }
                HStack(spacing: 6) {
                    Text("Band:")
                        .font(.system(size: compact ? 14 : 18, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                    ForEach(BandPart.allCases) { part in
                        let on = audio.recipe.band.contains(part)
                        Button {
                            Haptics.tap()
                            audio.update { recipe in
                                if on { recipe.band.remove(part) } else { recipe.band.insert(part) }
                            }
                        } label: {
                            VStack(spacing: 0) {
                                Text(part.emoji).font(.system(size: compact ? 18 : 24)).grayscale(on ? 0 : 1)
                                Text(part.word)
                                    .font(.system(size: compact ? 10 : 13, weight: .black, design: .rounded))
                                    .lineLimit(1)
                                    .fixedSize()
                            }
                            .foregroundStyle(.white.opacity(on ? 1 : 0.55))
                            .frame(width: compact ? 50 : 72, height: compact ? 50 : 64)
                            .background(Neon.green.opacity(on ? 0.45 : 0.08), in: RoundedRectangle(cornerRadius: 14))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14).stroke(on ? Neon.green : .white.opacity(0.3), lineWidth: on ? 3 : 1.5))
                        }
                        .buttonStyle(Squish())
                        .accessibilityLabel("\(part.word) \(on ? "on" : "off")")
                    }
                }
                Button {
                    Haptics.success()
                    audio.surprise()
                } label: {
                    Pill(icon: "🎲", word: "Surprise me", color: Neon.orange.opacity(0.75), size: compact ? 16 : 22)
                }
                .buttonStyle(Squish())
            }
            Spacer(minLength: 0)
            VStack(spacing: 4) {
                HintBubble(id: "drop", text: "Hold me!")
                DropButton(audio: audio, size: compact ? 118 : 180, onDrop: onDrop)
                Text("Hold to build…\nlet go to DROP!")
                    .font(.system(size: compact ? 12 : 16, weight: .black, design: .rounded))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .shadow(color: .black, radius: 3)
            }
        }
        .padding(compact ? 10 : 16)
        .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

/// A big Chill 😌 ... HYPE 🔥 slider. The conductor hears it every quarter second.
struct EnergySlider: View {
    let audio: BlasterAudio
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("⚡️ Energy: \(label)")
                .font(.system(size: compact ? 15 : 20, weight: .black, design: .rounded))
                .foregroundStyle(.white)
            HStack(spacing: 8) {
                Text("😌 Chill")
                    .font(.system(size: compact ? 13 : 17, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .fixedSize()
                GeometryReader { geometry in
                    let width = geometry.size.width
                    let thumb: CGFloat = compact ? 40 : 52
                    let x = (width - thumb) * audio.energy
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(LinearGradient(colors: [Neon.cyan, Neon.yellow, Neon.orange, Neon.pink], startPoint: .leading, endPoint: .trailing))
                            .opacity(0.35)
                        Capsule()
                            .fill(LinearGradient(colors: [Neon.cyan, Neon.yellow, Neon.orange, Neon.pink], startPoint: .leading, endPoint: .trailing))
                            .frame(width: x + thumb)
                        Circle()
                            .fill(.white)
                            .frame(width: thumb, height: thumb)
                            .overlay(Text(audio.energy > 0.66 ? "🔥" : (audio.energy > 0.33 ? "😎" : "😌")).font(.system(size: thumb * 0.55)))
                            .shadow(color: Neon.pink, radius: 8)
                            .offset(x: x)
                    }
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0).onChanged { drag in
                            audio.energy = min(1, max(0, (drag.location.x - thumb / 2) / max(1, width - thumb)))
                            Hints.use("energy")
                        }
                    )
                }
                .frame(height: compact ? 40 : 52)
                Text("HYPE 🔥")
                    .font(.system(size: compact ? 13 : 17, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .fixedSize()
            }
        }
        .frame(maxWidth: compact ? .infinity : 560)
        .accessibilityElement()
        .accessibilityLabel("Energy")
        .accessibilityValue(label)
        .accessibilityAdjustableAction { direction in
            audio.energy = min(1, max(0, audio.energy + (direction == .increment ? 0.1 : -0.1)))
        }
    }

    private var label: String {
        switch audio.energy {
        case ..<0.25: "Chill"
        case ..<0.5: "Groovy"
        case ..<0.75: "Pumped"
        default: "HYPE!"
        }
    }
}

/// The giant DROP button. Touch-down starts the build that instant; lift-off lands the drop. A plain drag gesture
/// with no minimum distance (not a long press), so a quick tap still builds and drops, and nothing above it scrolls.
struct DropButton: View {
    let audio: BlasterAudio
    let size: CGFloat
    let onDrop: () -> Void
    @State private var pressing = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !pressing)) { timeline in
            let charge = audio.surgeStart.map { min(1, timeline.date.timeIntervalSince($0) / DropMachine.fullChargeSeconds) } ?? 0
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
                    Text("💣").font(.system(size: size * 0.22))
                    Text("DROP!")
                        .font(.system(size: size * 0.22, weight: .black, design: .rounded))
                    if pressing {
                        Text("\(Int(charge * 100))%")
                            .font(.system(size: size * 0.1, weight: .heavy, design: .rounded))
                    }
                }
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.4), radius: 3)
            }
            .frame(width: size, height: size)
            .scaleEffect(pressing ? 0.92 + 0.14 * charge : 1)
            .shadow(color: Neon.pink, radius: 20 + 30 * charge)
        }
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .local)
                .onChanged { _ in
                    guard !pressing else { return }
                    pressing = true
                    Hints.use("drop")
                    Haptics.tap()
                    audio.beginSurge()
                }
                .onEnded { _ in
                    guard pressing else { return }
                    pressing = false
                    Haptics.thump()
                    audio.endSurge()
                    onDrop()
                }
        )
        .animation(.spring(response: 0.25, dampingFraction: 0.45), value: pressing)
        .accessibilityElement()
        .accessibilityLabel("Drop")
        .accessibilityHint("Hold to build up, let go to drop")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction {
            audio.beginSurge()
            audio.endSurge()
            onDrop()
        }
    }
}

/// A big "BOOM!" that bursts out when the drop is heard.
struct BoomText: View {
    let audio: BlasterAudio
    let trigger: Int
    @State private var live = false

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !live)) { timeline in
            let since = audio.lastDrop.map { timeline.date.timeIntervalSince($0) } ?? 99
            if since >= 0, since < 1.2 {
                let p = since / 1.2
                Text("BOOM!")
                    .font(.system(size: 160, weight: .black, design: .rounded))
                    .italic()
                    .foregroundStyle(LinearGradient(colors: [Neon.yellow, Neon.pink], startPoint: .top, endPoint: .bottom))
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
            try? await Task.sleep(for: .seconds(1.8))
            if !Task.isCancelled { live = false }
        }
    }
}
