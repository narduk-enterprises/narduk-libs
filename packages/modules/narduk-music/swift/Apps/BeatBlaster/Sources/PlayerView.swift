import NardukSoundAnalysis
import NardukSoundVisuals
import SwiftUI

/// The player: the song's lights full screen, the steering controls (Energy, band, Mash it up, DROP) and the
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
    @State private var tray = TrayState()
    @State private var keyDropping = false

    enum Panel { case music, lights }

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            let short = geometry.size.height < 500
            let landscape = geometry.size.width > geometry.size.height
            let dropSize: CGFloat = short ? 92 : (compact ? 112 : 150)
            let pageHeight = max(110, geometry.size.height * (landscape ? 0.62 : 0.5) - (short ? 100 : 110))
            ZStack {
                DropStage(audio: audio, drawing: scenePhase == .active).ignoresSafeArea()
                Vignette()
                VStack(spacing: short ? 6 : 10) {
                    topBar(compact: compact, short: short)
                    Spacer(minLength: 0)
                    if landscape {
                        HStack(alignment: .bottom, spacing: 12) {
                            // Logan's canvas decision: a full-width bottom tray with DROP pinned bottom right.
                            controlsTray(compact: compact, short: short, pageHeight: pageHeight)
                                .frame(maxWidth: .infinity)
                            dropColumn(size: dropSize)
                        }
                    } else {
                        HStack {
                            Spacer(minLength: 0)
                            dropColumn(size: dropSize)
                        }
                        controlsTray(compact: compact, short: short, pageHeight: pageHeight)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, short ? 12 : (compact ? 14 : 24))
                .padding(.vertical, short ? 8 : (compact ? 10 : 16))
                .frame(width: geometry.size.width, height: geometry.size.height)
                .opacity(show.hidden ? 0 : 1)
                .allowsHitTesting(!show.hidden)
                .accessibilityHidden(show.hidden)
                if show.hidden { showModeLayer(compact: compact) }
                BoomText(audio: audio, trigger: boomID).allowsHitTesting(false)
                if let panel { picker(panel, compact: compact) }
            }
        }
        // A container keeps its children's own ids; without `.contain` the root id overrides every control's (#1664).
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("player.root")
        .focusable()
        .focusEffectDisabled()
        // A keyboard (a Mac, or an iPad with one): space pauses, hold D to DROP and let go to land it.
        .onKeyPress(.space) {
            audio.togglePause()
            return .handled
        }
        .onKeyPress(characters: CharacterSet(charactersIn: "dD"), phases: [.down, .up]) { press in
            if press.phase == .down, !keyDropping, !audio.isPaused {
                keyDropping = true
                Hints.use("drop")
                audio.beginSurge()
            } else if press.phase == .up, keyDropping {
                keyDropping = false
                audio.endSurge()
                boomID += 1
            }
            return .handled
        }
        .animation(.easeInOut(duration: 0.35), value: show.hidden)
        .onAppear {
            audio.playIfIdle()
            audio.beginRecording()
            // Launch arguments for the UI tests and screenshot runs: `-page effects` (opens the tray there),
            // `-tray YES` (opens it), `-hide YES`.
            let defaults = UserDefaults.standard
            if defaults.string(forKey: "page") == "effects" {
                tray.page = .effects
                tray.open()
            }
            if defaults.bool(forKey: "tray") { tray.open() }
            if defaults.bool(forKey: "hide") { show.hide() }
        }
        .onDisappear { audio.endRecording() }
    }

    /// Home and the REC clock, nothing else: the lights own the screen.
    private func topBar(compact: Bool, short: Bool) -> some View {
        HStack(spacing: 12) {
            HomeButton(action: home).probe("player.home")
            if !compact {
                HStack(spacing: 10) {
                    VibeArt(style: audio.recipe.style, size: short ? 30 : 40)
                    Text(audio.recipe.name)
                        .blasterFont(size: short ? 20 : 28, weight: .black)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .shadow(color: audio.recipe.style.color, radius: 10)
                }
                .layoutPriority(1)
            }
            Spacer(minLength: 0)
            Button {
                Haptics.tap()
                audio.togglePause()
            } label: {
                Image(systemName: audio.isPaused ? "play.fill" : "pause.fill")
                    .font(.system(size: 22, weight: .black))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(.black.opacity(0.55), in: Circle())
                    .overlay(Circle().stroke(.white.opacity(0.5), lineWidth: 2))
            }
            .buttonStyle(Squish())
            .accessibilityLabel(audio.isPaused ? "Resume" : "Pause")
            .probe("player.pause")
            RecBadge(audio: audio, compact: compact).layoutPriority(1).probe("player.rec")
        }
    }

    /// DROP floats in a thumb-reachable corner and rides above the tray, so it never moves when the tray opens.
    private func dropColumn(size: CGFloat) -> some View {
        VStack(spacing: 4) {
            HintBubble(id: "drop", text: "Hold me!")
            DropButton(audio: audio, size: size) { boomID += 1 }.probe("player.drop")
        }
        .padding(12)  // room for the charge ring, which is drawn outside the button
    }

    private func controlsTray(compact: Bool, short: Bool, pageHeight: CGFloat) -> some View {
        ControlsTray(state: $tray, maxPageHeight: pageHeight, short: short) { page in
            switch page {
            case .play:
                PlayControls(audio: audio, compact: compact, short: short, newSong: newSong)
            case .effects:
                EffectsPanel(
                    audio: audio, compact: compact, short: short, onPad: { audio.fire($0) },
                    onStutter: { audio.setStutter($0) })
            case .more:
                VStack(spacing: 10) {
                    MusicLightsBar(
                        audio: audio, short: short,
                        changeMusic: { open(.music) },
                        changeLights: { open(.lights) })
                    Button {
                        Haptics.tap()
                        tray.close()
                        show.hide()
                    } label: {
                        Pill(icon: "👁", word: "Show only the lights", color: Neon.purple.opacity(0.7), size: 16)
                    }
                    .buttonStyle(Squish())
                    .accessibilityLabel("Hide the controls")
                }
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
                            .blasterFont(size: 13, weight: .heavy, design: .monospaced)
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
                    audio.swap(to: next)
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
                    .transition(.opacity)
                    .scaleEffect(1 + 0.08 * charge + 0.1 * flash)
                    .offset(x: sin(t * 61) * jitter, y: cos(t * 47) * jitter)
                    .hueRotation(.degrees(charge * 140))
                Color.white.opacity(0.85 * flash * flash)
                RadialGradient(
                    colors: [.clear, Neon.pink.opacity(0.6 * charge)], center: .center, startRadius: 100,
                    endRadius: 900)
            }
            .background(Neon.night)
            .animation(.easeInOut(duration: 0.8), value: tile.id)
        }
    }
}

/// The tray's Play page: Energy, the band's instrument toggles, Mash it up and New song. (DROP floats outside the tray.)
struct PlayControls: View {
    let audio: BlasterAudio
    let compact: Bool
    var short = false
    var newSong: () -> Void = {}

    var body: some View {
        VStack(spacing: short ? 6 : 10) {
            EnergySlider(audio: audio, compact: compact)
            bandRow
            HStack(spacing: 8) {
                action(icon: "🎲", word: "Mash it up", color: Neon.orange) {
                    Haptics.success()
                    audio.mashUp()
                }
                .accessibilityIdentifier("player.mashUp")
                action(icon: "➕", word: "New song", color: Neon.pink, action: newSong)
                    .accessibilityIdentifier("player.newSong")
            }
        }
    }

    private var bandRow: some View {
        HStack(spacing: 4) {
            ForEach(BandPart.allCases) { part in
                let on = audio.recipe.band.contains(part)
                Button {
                    Haptics.tap()
                    audio.update { recipe in
                        if on { recipe.band.remove(part) } else { recipe.band.insert(part) }
                    }
                } label: {
                    VStack(spacing: 0) {
                        Glyph(part.emoji, size: compact ? 18 : 24).grayscale(on ? 0 : 1)
                        Text(part.word)
                            .blasterFont(size: compact ? 10 : 13, weight: .black)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .foregroundStyle(.white.opacity(on ? 1 : 0.55))
                    .frame(maxWidth: .infinity, minHeight: 50)
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

    private func action(icon: String, word: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Glyph(icon, size: 22)
                Text(word)
                    .blasterFont(size: compact ? 14 : 17, weight: .black)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(color.opacity(0.75), in: Capsule())
        }
        .buttonStyle(Squish())
        .accessibilityLabel(word)
    }
}

/// A big Chill 😌 ... HYPE 🔥 slider. The conductor hears it every quarter second.
struct EnergySlider: View {
    let audio: BlasterAudio
    let compact: Bool
    @State private var showHint = !Hints.seen("energy")

    var body: some View {
        content
            .onAppear { if showHint { Hints.noteShown("energy") } }
            .onReceive(NotificationCenter.default.publisher(for: Hints.used)) { note in
                if note.object as? String == "energy" { showHint = false }
            }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 4) {
            // The hint lives in the label (it used to float over the page tabs) and goes away for good on first use.
            Text("⚡️ Energy: \(label)" + (showHint ? "  👈 slide me!" : ""))
                .blasterFont(size: compact ? 15 : 20, weight: .black)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            HStack(spacing: 8) {
                Text("😌 Chill")
                    .blasterFont(size: compact ? 13 : 17, weight: .black)
                    .foregroundStyle(.white)
                    .fixedSize()
                GeometryReader { geometry in
                    let width = geometry.size.width
                    let thumb: CGFloat = compact ? 44 : 52
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
                .frame(height: compact ? 44 : 52)
                Text("HYPE 🔥")
                    .blasterFont(size: compact ? 13 : 17, weight: .black)
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
                    Glyph("💣", size: size * 0.22)
                    Text("DROP!")
                        .blasterFont(size: size * 0.22, weight: .black)
                    if pressing {
                        Text("\(Int(charge * 100))%")
                            .blasterFont(size: size * 0.1, weight: .heavy)
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
                    .blasterFont(size: 160, weight: .black)
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
            guard !audio.isPaused else { return }
            if audio.isRecording { audio.endRecording() } else { audio.beginRecording() }
        } label: {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                // The longest wording that fits: big Dynamic Type sizes fall back to shorter words, never to a clipped badge.
                ViewThatFits(in: .horizontal) {
                    ForEach(wordings(at: context.date), id: \.self) { wording in
                        HStack(spacing: 6) {
                            Circle().fill(audio.isRecording ? Color.red : .gray).frame(width: 10, height: 10)
                            Text(wording)
                                .blasterFont(size: compact ? 13 : 16, weight: .heavy, design: .monospaced)
                                .foregroundStyle(.white.opacity(0.9))
                                .lineLimit(1)
                                .fixedSize()
                        }
                    }
                }
                .frame(minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(audio.isRecording ? "Recording. Tap to stop and save" : "Start recording")
    }

    /// The badge's words, longest first.
    private func wordings(at date: Date) -> [String] {
        if audio.isPaused { return ["⏸ Paused", "⏸"] }
        if audio.isRecording { return ["REC \(clockText(audio.recordingElapsed(at: date)))", "REC"] }
        return ["Saved ✓ · tap to record", "Tap to record", "REC"]
    }
}
