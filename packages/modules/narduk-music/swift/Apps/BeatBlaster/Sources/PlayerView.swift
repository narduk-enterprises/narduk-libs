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
    @State private var show = ShowMode()
    @State private var page: Page = .play

    enum Page { case play, effects }

    enum Panel { case music, lights }

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            let short = geometry.size.height < 500
            ZStack {
                DropStage(audio: audio, drawing: scenePhase == .active).ignoresSafeArea()
                Vignette()
                VStack(spacing: short ? 6 : (compact ? 8 : 14)) {
                    topBar(compact: compact, short: short)
                    Spacer(minLength: 0)
                    pageSwitch(short: short)
                    if page == .play {
                        SteeringPanel(audio: audio, compact: compact, short: short, newSong: newSong) { boomID += 1 }
                    } else {
                        EffectsPanel(audio: audio, compact: compact, short: short) { audio.fire($0) }
                            .padding(short ? 8 : 12)
                            .background(
                                .black.opacity(0.35), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                    }
                    MusicLightsBar(
                        audio: audio, short: short,
                        changeMusic: { open(.music) },
                        changeLights: { open(.lights) })
                }
                .padding(short ? 8 : (compact ? 12 : 24))
                .frame(width: geometry.size.width, height: geometry.size.height)
                .opacity(show.hidden ? 0 : 1)
                .allowsHitTesting(!show.hidden)
                .accessibilityHidden(show.hidden)
                if show.hidden { showModeLayer(compact: compact) }
                BoomText(audio: audio, trigger: boomID).allowsHitTesting(false)
                if let panel { picker(panel, compact: compact) }
            }
        }
        .animation(.easeInOut(duration: 0.35), value: show.hidden)
        .onAppear {
            audio.playIfIdle()
            audio.beginRecording()
            // Launch arguments for the screenshot runs: `-page effects`, `-hide YES`.
            if UserDefaults.standard.string(forKey: "page") == "effects" { page = .effects }
            if UserDefaults.standard.bool(forKey: "hide") { show.hide() }
        }
        .onDisappear { audio.endRecording() }
    }

    /// Home and the song's name; New song joins them when there is room (a phone held upright puts it beside DROP).
    private func topBar(compact: Bool, short: Bool) -> some View {
        HStack(spacing: 12) {
            HomeButton(action: home)
            VStack(alignment: .leading, spacing: 0) {
                if !short {
                    RecBadge(audio: audio, compact: compact)
                }
                Text("\(audio.recipe.style.emoji) \(audio.recipe.name)")
                    .font(.system(size: compact ? 20 : (short ? 22 : 34), weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .shadow(color: audio.recipe.style.color, radius: 10)
            }
            .layoutPriority(1)
            Spacer(minLength: 0)
            if short { RecBadge(audio: audio, compact: true) }
            if !compact || short {
                Button(action: newSong) {
                    Pill(
                        icon: "➕", word: short ? "New" : "New song", color: Neon.pink.opacity(0.7),
                        size: short ? 16 : 20)
                }
                .buttonStyle(Squish())
            }
            Button {
                Haptics.tap()
                show.hide()
            } label: {
                Pill(icon: "👁", word: "Hide", color: Neon.purple.opacity(0.7), size: short ? 16 : (compact ? 17 : 20))
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Hide the controls")
        }
    }

    /// Play (Energy, band, DROP) and Effects (sliders and sound pads).
    private func pageSwitch(short: Bool) -> some View {
        HStack(spacing: 8) {
            ForEach([Page.play, .effects], id: \.self) { which in
                Button {
                    Haptics.tap()
                    withAnimation(.easeInOut(duration: 0.2)) { page = which }
                } label: {
                    Pill(
                        icon: which == .play ? "🎮" : "🎛", word: which == .play ? "Play" : "Effects",
                        color: (which == .play ? Neon.pink : Neon.cyan).opacity(page == which ? 0.9 : 0.35),
                        size: short ? 14 : 16, selected: page == which)
                }
                .buttonStyle(Squish())
            }
        }
    }

    /// Show mode: every control faded out, the lights edge to edge, a faint REC dot and clock in one corner. A tap
    /// anywhere brings everything back; a double tap fires a short DROP.
    private func showModeLayer(compact: Bool) -> some View {
        ZStack(alignment: .topTrailing) {
            Color.clear.contentShape(Rectangle())
                .onTapGesture(count: 2) {
                    Haptics.success()
                    boomID += 1
                    audio.beginSurge()
                    Task {
                        try? await Task.sleep(for: .seconds(1.6))
                        audio.endSurge()
                    }
                }
                .onTapGesture { show.reveal() }
            if audio.isRecording {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    HStack(spacing: 5) {
                        Circle().fill(.red).frame(width: 8, height: 8)
                        Text(clockText(audio.recordingElapsed(at: context.date)))
                            .font(.system(size: 13, weight: .heavy, design: .monospaced))
                    }
                    .foregroundStyle(.white)
                    .padding(8)
                    .opacity(0.45)
                }
                .allowsHitTesting(false)
            }
        }
        .accessibilityLabel("Tap to show the controls")
        .accessibilityAddTraits(.isButton)
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

/// The live steering controls. A phone held upright stacks them (Energy, the band, then DROP in a row of its own with
/// Surprise me and New song either side); anything wider keeps Energy and the band beside DROP.
struct SteeringPanel: View {
    let audio: BlasterAudio
    let compact: Bool
    var short = false
    var newSong: () -> Void = {}
    let onDrop: () -> Void

    var body: some View {
        Group {
            if compact && !short { stacked } else { sideBySide }
        }
        .padding(short ? 8 : (compact ? 10 : 16))
        .background(.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }

    private var stacked: some View {
        VStack(spacing: 8) {
            ZStack(alignment: .topLeading) {
                EnergySlider(audio: audio, compact: true)
                HintBubble(id: "energy", text: "Slide for more energy!").offset(x: 90, y: -56)
            }
            bandRow(compact: true, flexible: true)
            HStack(alignment: .center, spacing: 8) {
                sideButton(icon: "🎲", word: "Surprise me", color: Neon.orange) {
                    Haptics.success()
                    audio.surprise()
                }
                dropColumn(size: 120, caption: true)
                sideButton(icon: "➕", word: "New song", color: Neon.pink, action: newSong)
            }
        }
    }

    private var sideBySide: some View {
        HStack(alignment: .bottom, spacing: compact ? 10 : 20) {
            VStack(alignment: .leading, spacing: short ? 6 : (compact ? 8 : 12)) {
                ZStack(alignment: .topLeading) {
                    EnergySlider(audio: audio, compact: compact)
                    HintBubble(id: "energy", text: "Slide for more energy!").offset(x: 120, y: compact ? -64 : -72)
                }
                bandRow(compact: compact, flexible: false)
                if !short {
                    Button {
                        Haptics.success()
                        audio.surprise()
                    } label: {
                        Pill(icon: "🎲", word: "Surprise me", color: Neon.orange.opacity(0.75), size: compact ? 16 : 22)
                    }
                    .buttonStyle(Squish())
                }
            }
            Spacer(minLength: 0)
            if short {
                Button {
                    Haptics.success()
                    audio.surprise()
                } label: {
                    VStack(spacing: 2) {
                        Text("🎲").font(.system(size: 26))
                        Text("Surprise").font(.system(size: 12, weight: .black, design: .rounded))
                    }
                    .foregroundStyle(.white)
                    .frame(width: 70, height: 56)
                    .background(Neon.orange.opacity(0.75), in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(Squish())
                .accessibilityLabel("Surprise me")
            }
            dropColumn(size: short ? 96 : (compact ? 118 : 180), caption: !short)
        }
    }

    private func bandRow(compact: Bool, flexible: Bool) -> some View {
        HStack(spacing: flexible ? 4 : 6) {
            if !flexible {
                Text("Band:")
                    .font(.system(size: compact ? 14 : 18, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
            }
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
                            .minimumScaleFactor(0.7)
                    }
                    .foregroundStyle(.white.opacity(on ? 1 : 0.55))
                    .frame(maxWidth: flexible ? .infinity : nil)
                    .frame(width: flexible ? nil : (compact ? 50 : 72), height: compact ? 50 : 64)
                    .background(Neon.green.opacity(on ? 0.45 : 0.08), in: RoundedRectangle(cornerRadius: 14))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14).stroke(
                            on ? Neon.green : .white.opacity(0.3), lineWidth: on ? 3 : 1.5))
                }
                .buttonStyle(Squish())
                .accessibilityLabel("\(part.word) \(on ? "on" : "off")")
            }
        }
    }

    private func dropColumn(size: CGFloat, caption: Bool) -> some View {
        VStack(spacing: 4) {
            HintBubble(id: "drop", text: "Hold me!")
            DropButton(audio: audio, size: size, onDrop: onDrop)
            if caption {
                Text("Hold to build…\nlet go to DROP!")
                    .font(.system(size: compact ? 12 : 16, weight: .black, design: .rounded))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .shadow(color: .black, radius: 3)
            }
        }
        .padding(12)  // room for the charge ring, which is drawn outside the button
    }

    /// A tall pill that sits beside DROP: an icon over a word.
    private func sideButton(icon: String, word: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Text(icon).font(.system(size: 30))
                Text(word)
                    .font(.system(size: 14, weight: .black, design: .rounded))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 72)
            .padding(.vertical, 6)
            .background(color.opacity(0.75), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(Squish())
        .accessibilityLabel(word)
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
                            .fill(
                                LinearGradient(
                                    colors: [Neon.cyan, Neon.yellow, Neon.orange, Neon.pink], startPoint: .leading,
                                    endPoint: .trailing)
                            )
                            .opacity(0.35)
                        Capsule()
                            .fill(
                                LinearGradient(
                                    colors: [Neon.cyan, Neon.yellow, Neon.orange, Neon.pink], startPoint: .leading,
                                    endPoint: .trailing)
                            )
                            .frame(width: x + thumb)
                        Circle()
                            .fill(.white)
                            .frame(width: thumb, height: thumb)
                            .overlay(
                                Text(audio.energy > 0.66 ? "🔥" : (audio.energy > 0.33 ? "😎" : "😌")).font(
                                    .system(size: thumb * 0.55))
                            )
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
            let charge =
                audio.surgeStart.map { min(1, timeline.date.timeIntervalSince($0) / DropMachine.fullChargeSeconds) }
                ?? 0
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
            try? await Task.sleep(for: .seconds(1.8))
            if !Task.isCancelled { live = false }
        }
    }
}

/// Whether the player's controls are hidden so the lights fill the screen. Music and recording never depend on it.
struct ShowMode: Equatable {
    private(set) var hidden = false
    mutating func hide() { hidden = true }
    mutating func reveal() { hidden = false }
}

/// "● REC 01:23": the take's running clock. Tapping it stops and saves the take (or starts another).
struct RecBadge: View {
    let audio: BlasterAudio
    let compact: Bool

    var body: some View {
        Button {
            Haptics.tap()
            if audio.isRecording { audio.endRecording() } else { audio.beginRecording() }
        } label: {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                HStack(spacing: 6) {
                    Circle().fill(audio.isRecording ? Color.red : .gray).frame(width: 10, height: 10)
                    Text(
                        audio.isRecording
                            ? "REC \(clockText(audio.recordingElapsed(at: context.date)))" : "Saved ✓ · tap to record"
                    )
                    .font(.system(size: compact ? 13 : 16, weight: .heavy, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                }
                .frame(minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(audio.isRecording ? "Recording. Tap to stop and save" : "Start recording")
    }
}
