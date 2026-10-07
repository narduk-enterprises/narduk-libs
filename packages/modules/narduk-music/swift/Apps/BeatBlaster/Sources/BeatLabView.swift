import SwiftUI

/// Beat Lab: a 16-step sequencer (Kick, Snare, Hat, Zap, Bass, Keys) with lights behind it.
struct BeatLabView: View {
    let audio: BlasterAudio
    let lab: BeatLab
    let home: () -> Void
    /// Plays a song built around this beat (the root keeps it in My Songs and opens the player).
    var makeSong: (SongRecipe) -> Void = { _ in }
    @Environment(\.scenePhase) private var scenePhase
    @State private var panel = false

    var body: some View {
        GeometryReader { geometry in
            // A narrow window, or a short one (a phone on its side, a small Mac window), gets the small controls so the
            // grid keeps a useful size.
            let compact = geometry.size.width < 500 || geometry.size.height < 700
            // A phone on its side: the grid on the left and the controls beside it, so nothing scrolls.
            let side = geometry.size.height < 500 && geometry.size.width > geometry.size.height * 1.3
            ZStack {
                LiveVisual(audio: audio, tile: VisualTile.with(id: audio.lightsID), drawing: scenePhase == .active)
                    .opacity(0.45)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                Vignette()
                // Everything fits on one screen: the controls take the height they need and the grid takes the rest.
                page(
                    compact: compact, side: side, portrait: geometry.size.width < 500 && geometry.size.height > 600,
                    width: geometry.size.width
                )
                .frame(maxHeight: .infinity, alignment: .top)
                .frame(width: geometry.size.width)
                if panel {
                    PickerPanel(title: "Pick the lights", badge: .lights, close: { withAnimation { panel = false } }) {
                        LightsGrid(audio: audio, selectedID: audio.lightsID) { audio.lightsID = $0 }
                    }
                    .transition(.move(edge: .bottom))
                }
            }
        }
        .onAppear { audio.startBeatLab(lab) }
        .onDisappear {
            audio.endRecording()
            lab.save()
        }
    }

    /// The whole Lab: the title and the one-line help, the grid in the height that is left, then the controls (wrapped
    /// onto as many rows as the width needs) and My beats.
    /// Pills are at least 52pt tall, so this keeps every control at 44pt or more.
    static let minTapScale: CGFloat = 0.85

    @ViewBuilder private func page(compact: Bool, side: Bool, portrait: Bool, width: CGFloat) -> some View {
        if side {
            HStack(alignment: .top, spacing: 12) {
                VStack(spacing: 8) {
                    header(compact: compact)
                    grid(compact: compact)
                }
                // The column shrinks to the window's height, never below a size a finger can hit.
                ScaleToFit(minScale: Self.minTapScale) {
                    VStack(spacing: 8) {
                        controls(compact: compact)
                        if !lab.kept.isEmpty { myBeats(compact: compact) }
                    }
                }
                .frame(width: min(440, width * 0.48))
            }
            .padding(12)
        } else {
            VStack(spacing: compact ? 8 : 12) {
                header(compact: compact)
                if portrait {
                    // A phone held upright: the grid is as wide as it can be (its height follows the width) and the
                    // controls shrink into the rest.
                    grid(compact: compact).frame(maxHeight: 160)
                    ScaleToFit(minScale: Self.minTapScale) {
                        VStack(spacing: 8) {
                            controls(compact: compact)
                            if !lab.kept.isEmpty { myBeats(compact: compact) }
                        }
                    }
                } else {
                    grid(compact: compact)
                    // The controls keep their full height; only the grid gives way in a short window.
                    Group {
                        controls(compact: compact)
                        if !lab.kept.isEmpty { myBeats(compact: compact) }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(compact ? 12 : 20)
        }
    }

    private func grid(compact: Bool) -> some View {
        BeatGrid(audio: audio, lab: lab, compact: compact).frame(minHeight: compact ? 100 : 120)
    }

    private func header(compact: Bool) -> some View {
        HStack(spacing: 12) {
            HomeButton(action: home)
            VStack(alignment: .leading, spacing: 2) {
                Text("Beat Lab")
                    .blasterFont(size: compact ? 26 : 40, weight: .black)
                    .foregroundStyle(.white)
                Text("Tap squares to make a beat. Tap a row's name to change its sound.")
                    .blasterFont(size: compact ? 12 : 16, weight: .bold)
                    .foregroundStyle(.white.opacity(0.75))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
        }
    }

    /// Grouped and labelled so the row reads left to right: Play, Speed, Key, Change it, Save, Lights.
    private func controls(compact: Bool) -> some View {
        let size: CGFloat = compact ? 16 : 22
        return ChipLayout(spacing: compact ? 8 : 12) {
            ControlGroup(title: "Play", compact: compact) {
                transport(size)
                record(size)
            }
            ControlGroup(title: "Speed", compact: compact) { speed(size) }
            ControlGroup(title: "Key", compact: compact) { keyPicker(size) }
            ControlGroup(title: "Change it", compact: compact) { edit(size) }
            ControlGroup(title: "Save", compact: compact) { keepAndSong(size) }
            ControlGroup(title: "Lights", compact: compact) {
                Text(VisualTile.with(id: audio.lightsID).name)
                    .blasterFont(size: size * 0.85, weight: .black)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .fixedSize()
                Button {
                    Haptics.tap()
                    withAnimation { panel = true }
                } label: {
                    Pill(icon: "🔄", word: "Change", color: Neon.cyan.opacity(0.5), size: size * 0.8)
                }
                .buttonStyle(Squish())
                .accessibilityLabel("Change the lights")
            }
        }
    }

    /// Keep this beat in My beats, or build a whole song on it (straight to the player: the beat picks the genre).
    private func keepAndSong(_ size: CGFloat) -> some View {
        HStack(spacing: 10) {
            Button {
                Haptics.success()
                lab.keep()
            } label: {
                let isKept = lab.kept.contains { $0.beat == lab.saved }
                Pill(
                    icon: "icon-check", word: isKept ? "Kept" : "Keep beat",
                    color: isKept ? Neon.green.opacity(0.45) : .white.opacity(0.15), size: size)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Keep this beat in My beats")
            .probe("lab.keep")
            Button {
                Haptics.success()
                let beat = lab.keep()
                var recipe = SongRecipe.around(beat.beat, name: beat.name)
                recipe.lightsID = audio.lightsID
                audio.endRecording()
                lab.save()
                makeSong(recipe)
            } label: {
                Pill(icon: "icon-new-song", word: "Make a song", color: Neon.pink.opacity(0.75), size: size)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Make a song from my beat")
            .probe("lab.makeSong")
        }
    }

    /// The beats the child kept: tap one to put it back on the grid; hold it to let it go.
    private func myBeats(compact: Bool) -> some View {
        let size: CGFloat = compact ? 14 : 18
        return VStack(alignment: .leading, spacing: compact ? 4 : 6) {
            GroupCaption(title: "My beats", compact: compact)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(lab.kept) { beat in
                        Button {
                            Haptics.tap()
                            lab.load(beat)
                            audio.setLabTempo(lab.bpm)
                        } label: {
                            Pill(
                                icon: "icon-beat-lab", word: beat.name,
                                color: beat.beat == lab.saved ? Neon.cyan.opacity(0.55) : .white.opacity(0.12),
                                size: size, selected: beat.beat == lab.saved)
                        }
                        .buttonStyle(Squish())
                        .contextMenu {
                            Button(role: .destructive) {
                                lab.forget(beat)
                            } label: {
                                Label("Let it go", systemImage: "trash")
                            }
                        }
                        .accessibilityLabel("Load \(beat.name)")
                    }
                }
                // Room inside the row for the picked beat's glow, so it is not cut off square.
                .padding(8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .blasterCard(compact: compact)
    }

    /// The key of the Bass and Keys rows: ◀︎ F ▶︎.
    private func keyPicker(_ size: CGFloat) -> some View {
        HStack(spacing: 6) {
            Button {
                Haptics.tap()
                lab.key = (lab.key + 11) % 12
            } label: {
                Pill(icon: "icon-key-down", word: "", color: .white.opacity(0.12), size: size * 0.8)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Key down")
            Text(MusicKey.names[lab.key])
                .blasterFont(size: size * 0.85, weight: .black)
                .foregroundStyle(.white)
                .lineLimit(1)
                .fixedSize()
                .accessibilityLabel("Key \(MusicKey.names[lab.key])")
            Button {
                Haptics.tap()
                lab.key = (lab.key + 1) % 12
            } label: {
                Pill(icon: "icon-key-up", word: "", color: .white.opacity(0.12), size: size * 0.8)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Key up")
        }
    }

    private func transport(_ size: CGFloat) -> some View {
        Button {
            Haptics.tap()
            if audio.isRunning, audio.input == .beatLab {
                audio.endRecording()
                audio.stop()
            } else {
                audio.startBeatLab(lab)
            }
        } label: {
            let playing = audio.isRunning && audio.input == .beatLab
            Pill(
                icon: playing ? "icon-stop" : "icon-play", word: playing ? "Stop" : "Play",
                color: playing ? Neon.pink.opacity(0.75) : Neon.green.opacity(0.8), size: size)
        }
        .buttonStyle(Squish())
    }

    /// Record my beat: plays the beat if it is stopped and records it into My Songs (as "My beat") until tapped again,
    /// Stop is pressed or the child leaves Beat Lab. The clock is read in a TimelineView, never observed.
    private func record(_ size: CGFloat) -> some View {
        Button {
            Haptics.tap()
            if audio.isRecording {
                audio.endRecording()
            } else {
                if !(audio.isRunning && audio.input == .beatLab) { audio.startBeatLab(lab) }
                audio.beginRecording()
            }
        } label: {
            if audio.isRecording {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Pill(
                        icon: "icon-stop", word: "Save · \(clockText(audio.recordingElapsed(at: context.date)))",
                        color: Neon.pink.opacity(0.85), size: size)
                }
            } else {
                Pill(icon: "icon-record", word: "Record", color: .white.opacity(0.15), size: size)
            }
        }
        .buttonStyle(Squish())
        .accessibilityLabel(audio.isRecording ? "Stop recording and save to My Songs" : "Record my beat")
        .probe("lab.record")
    }

    private func speed(_ size: CGFloat) -> some View {
        HStack(spacing: 6) {
            ForEach(Speed.allCases) { speed in
                Button {
                    Haptics.tap()
                    lab.speed = speed
                    audio.setLabTempo(lab.bpm)
                } label: {
                    Pill(
                        icon: speed.emoji, word: speed.word,
                        color: lab.speed == speed ? Neon.yellow : .white.opacity(0.12), size: size * 0.8,
                        selected: lab.speed == speed, dark: lab.speed == speed)
                }
                .buttonStyle(Squish())
            }
        }
    }

    private func edit(_ size: CGFloat) -> some View {
        HStack(spacing: 10) {
            Button {
                Haptics.success()
                lab.randomize()
            } label: {
                Pill(icon: "🎲", word: "Random", color: Neon.orange.opacity(0.75), size: size)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Random beat")
            Button {
                Haptics.tap()
                lab.clear()
            } label: {
                Pill(icon: "🧽", word: "Clear", color: .white.opacity(0.15), size: size)
            }
            .buttonStyle(Squish())
            if lab.undoGrid != nil {
                Button {
                    Haptics.tap()
                    lab.undo()
                } label: {
                    Pill(icon: "icon-back", word: "Undo", color: Neon.cyan.opacity(0.45), size: size)
                }
                .buttonStyle(Squish())
                .accessibilityLabel("Undo: bring back my beat")
                .probe("lab.undo")
            }
        }
    }
}

/// A labelled group of Beat Lab controls: a small caption over its buttons, on a faint card.
struct ControlGroup<Content: View>: View {
    let title: String
    var compact = false
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 4 : 6) {
            GroupCaption(title: title, compact: compact)
            HStack(spacing: 8) { content }
        }
        .blasterCard(compact: compact)
    }
}

/// The small uppercase caption over a group of controls.
struct GroupCaption: View {
    let title: String
    var compact = false

    var body: some View {
        Text(title.uppercased())
            .blasterFont(size: compact ? 10 : 12, weight: .black)
            .foregroundStyle(.white.opacity(0.6))
            .padding(.leading, 6)
            .accessibilityHidden(true)
    }
}

extension View {
    /// The one container look on Beat Lab: a dark rounded card with a faint edge.
    func blasterCard(compact: Bool = false) -> some View {
        let shape = RoundedRectangle(cornerRadius: compact ? 16 : 22, style: .continuous)
        return padding(compact ? 6 : 10)
            .background(.black.opacity(0.45), in: shape)
            .overlay(shape.stroke(.white.opacity(0.14), lineWidth: 1))
    }
}

/// The grid: a row label and 16 cells per row, beats grouped in fours, with a moving playhead.
struct BeatGrid: View {
    let audio: BlasterAudio
    let lab: BeatLab
    let compact: Bool

    var body: some View {
        GeometryReader { geometry in
            let spacing: CGFloat = compact ? 3 : 6
            let rowSpacing: CGFloat = compact ? 4 : 8
            let pad: CGFloat = compact ? 6 : 10
            let labelWidth: CGFloat = compact ? 70 : 150
            // Square cells as big as both the width and the height allow.
            let byWidth = (geometry.size.width - 2 * pad - labelWidth - spacing * 16) / 16
            let byHeight = (geometry.size.height - 2 * pad - rowSpacing * 5) / 6
            let side = max(12, min(byWidth, byHeight, compact ? 44 : 72))
            grid(side: side, labelWidth: labelWidth, spacing: spacing, rowSpacing: rowSpacing)
                .padding(pad)
                .background(
                    .black.opacity(0.45), in: RoundedRectangle(cornerRadius: compact ? 16 : 22, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: compact ? 16 : 22, style: .continuous)
                        .stroke(.white.opacity(0.14), lineWidth: 1)
                )
                .frame(width: geometry.size.width, height: geometry.size.height)
        }
    }

    private func grid(side: CGFloat, labelWidth: CGFloat, spacing: CGFloat, rowSpacing: CGFloat) -> some View {
        VStack(spacing: rowSpacing) {
            ForEach(LabRow.allCases) { row in
                HStack(spacing: spacing) {
                    Button {
                        Haptics.tap()
                        lab.nextSound(row)
                    } label: {
                        HStack(spacing: 4) {
                            Glyph(row.emoji, size: min(compact ? 14 : 24, side * 0.6))
                            VStack(alignment: .leading, spacing: 0) {
                                Text(row.word)
                                    .blasterFont(size: compact ? 12 : 20, weight: .black)
                                    .foregroundStyle(.white)
                                Text(lab.soundName(row))
                                    .blasterFont(size: compact ? 9 : 14, weight: .heavy)
                                    .foregroundStyle(Neon.cyan)
                            }
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, compact ? 3 : 8)
                        .frame(width: labelWidth, height: side, alignment: .leading)
                        .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Neon.cyan.opacity(0.5), lineWidth: 1.5))
                    }
                    .buttonStyle(Squish())
                    .accessibilityLabel("\(row.word) sound: \(lab.soundName(row)). Tap to change.")
                    ForEach(0..<BeatLab.steps, id: \.self) { step in
                        cell(row, step).frame(width: side, height: side)
                    }
                }
            }
        }
        .overlay(alignment: .topLeading) {
            Playhead(audio: audio, column: side, spacing: spacing)
                .padding(.leading, labelWidth + spacing)
                .allowsHitTesting(false)
        }
    }

    private func cell(_ row: LabRow, _ step: Int) -> some View {
        let value = lab.grid[row.rawValue][step]
        let color = Neon.cycle[row.rawValue % Neon.cycle.count]
        return Button {
            lab.tap(row, step)
            Haptics.tap()
        } label: {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(
                    value > 0
                        ? color.opacity(0.55 + 0.15 * Double(value)) : .white.opacity(step / 4 % 2 == 0 ? 0.12 : 0.06)
                )
                .overlay(
                    Group {
                        if value > 0, row.noteCount > 1 {
                            Text("\(value)").blasterFont(size: 14, weight: .black).foregroundStyle(.black)
                                .minimumScaleFactor(0.5)
                        }
                    }
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8).stroke(.white.opacity(value > 0 ? 0.8 : 0.15), lineWidth: 1.5)
                )
                .shadow(color: value > 0 ? color : .clear, radius: 6)
                .aspectRatio(1, contentMode: .fit)
        }
        .buttonStyle(Squish())
        .accessibilityLabel("\(row.word) step \(step + 1) \(value > 0 ? "on" : "off")")
    }
}

/// The column now playing, read on its own clock (the engine's step is never observed by the grid).
struct Playhead: View {
    let audio: BlasterAudio
    /// One cell's width.
    let column: CGFloat
    let spacing: CGFloat

    var body: some View {
        GeometryReader { geometry in
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !(audio.isRunning && audio.input == .beatLab))) {
                _ in
                let step = audio.isRunning && audio.input == .beatLab ? audio.currentStep % BeatLab.steps : -1
                if step >= 0 {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Neon.yellow, lineWidth: 3)
                        .frame(width: column, height: geometry.size.height)
                        .shadow(color: Neon.yellow, radius: 8)
                        .offset(x: CGFloat(step) * (column + spacing))
                }
            }
        }
    }
}

/// A simple centred wrapping layout.
struct ChipLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX + (bounds.width - row.width) / 2
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let added =
                rows[rows.count - 1].items.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if added > width, !rows[rows.count - 1].items.isEmpty {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width = row.items.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.items.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}
