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
    @State private var vibePanel = false

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            ZStack {
                LiveVisual(audio: audio, tile: VisualTile.with(id: audio.lightsID), drawing: scenePhase == .active)
                    .opacity(0.45)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                Vignette()
                // Scrolls, so a short landscape window can still reach the controls and the lights bar.
                ScrollView {
                    VStack(spacing: compact ? 10 : 16) {
                        HStack(spacing: 12) {
                            HomeButton(action: home)
                            Text("Beat Lab")
                                .blasterFont(size: compact ? 26 : 44, weight: .black)
                                .foregroundStyle(.white)
                            Spacer(minLength: 0)
                        }
                        Text(
                            "Tap the squares to make a beat. Tap a row's name to change its sound. Bass and Keys squares change note each tap."
                        )
                        .blasterFont(size: compact ? 14 : 20, weight: .bold)
                        .foregroundStyle(.white.opacity(0.85))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        BeatGrid(audio: audio, lab: lab, compact: compact)
                        controls(compact: compact)
                        if !lab.kept.isEmpty { myBeats(compact: compact) }
                        MusicLightsBar(
                            audio: audio, musicTitle: "My beat", musicEmoji: "🥁", showMusicChange: false,
                            changeMusic: {}, changeLights: { withAnimation { panel = true } })
                    }
                    .padding(compact ? 12 : 24)
                    .frame(width: geometry.size.width)
                }
                .scrollBounceBehavior(.basedOnSize)
                if panel {
                    PickerPanel(title: "Pick the lights", badge: .lights, close: { withAnimation { panel = false } }) {
                        LightsGrid(audio: audio, selectedID: audio.lightsID, compact: compact) { audio.lightsID = $0 }
                    }
                    .transition(.move(edge: .bottom))
                }
                if vibePanel {
                    PickerPanel(
                        title: "Build a song on my beat", badge: .music, close: { withAnimation { vibePanel = false } }
                    ) {
                        MusicGrid(selectedID: nil, compact: compact) { style in
                            let beat = lab.keep()
                            var recipe = SongRecipe.around(beat.beat, style: style, name: beat.name)
                            recipe.lightsID = audio.lightsID
                            audio.endRecording()
                            lab.save()
                            vibePanel = false
                            makeSong(recipe)
                        }
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

    /// The controls wrap onto as many rows as the width needs (they used to be wider than a phone and stretched the
    /// whole screen past its edge).
    private func controls(compact: Bool) -> some View {
        let size: CGFloat = compact ? 16 : 22
        return ChipLayout(spacing: 10) {
            transport(size)
            record(size)
            speed(size)
            keyPicker(size)
            edit(size)
            keepAndSong(size)
        }
    }

    /// Keep this beat in My beats, or build a whole song on it.
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
                Haptics.tap()
                withAnimation { vibePanel = true }
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
        return VStack(alignment: .leading, spacing: 8) {
            Text("My beats")
                .blasterFont(size: size * 1.2, weight: .black)
                .foregroundStyle(.white)
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
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
            Text("Key: \(MusicKey.names[lab.key])")
                .blasterFont(size: size * 0.85, weight: .black)
                .foregroundStyle(.white)
                .lineLimit(1)
                .fixedSize()
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
                Pill(icon: "icon-record", word: "Record my beat", color: .white.opacity(0.15), size: size)
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
                        color: lab.speed == speed ? Neon.yellow.opacity(0.7) : .white.opacity(0.12), size: size * 0.8,
                        selected: lab.speed == speed)
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
                Pill(icon: "🎲", word: "Random beat", color: Neon.orange.opacity(0.75), size: size)
            }
            .buttonStyle(Squish())
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

/// The grid: a row label and 16 cells per row, beats grouped in fours, with a moving playhead.
struct BeatGrid: View {
    let audio: BlasterAudio
    let lab: BeatLab
    let compact: Bool

    var body: some View {
        let labelWidth: CGFloat = compact ? 70 : 150
        VStack(spacing: compact ? 4 : 8) {
            ForEach(LabRow.allCases) { row in
                HStack(spacing: compact ? 3 : 6) {
                    Button {
                        Haptics.tap()
                        lab.nextSound(row)
                    } label: {
                        HStack(spacing: 4) {
                            Glyph(row.emoji, size: compact ? 14 : 24)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(row.word)
                                    .blasterFont(size: compact ? 12 : 20, weight: .black)
                                    .foregroundStyle(.white)
                                Text(lab.soundName(row))
                                    .blasterFont(size: compact ? 9 : 14, weight: .heavy)
                                    .foregroundStyle(Neon.cyan)
                            }
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, compact ? 3 : 8)
                        .padding(.vertical, 2)
                        .frame(width: labelWidth, alignment: .leading)
                        .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Neon.cyan.opacity(0.5), lineWidth: 1.5))
                    }
                    .buttonStyle(Squish())
                    .accessibilityLabel("\(row.word) sound: \(lab.soundName(row)). Tap to change.")
                    ForEach(0..<BeatLab.steps, id: \.self) { step in
                        cell(row, step)
                    }
                }
            }
        }
        .overlay(alignment: .topLeading) {
            Playhead(audio: audio, labelWidth: labelWidth, spacing: compact ? 3 : 6)
                .padding(.leading, labelWidth + (compact ? 3 : 6))
                .allowsHitTesting(false)
        }
        .padding(compact ? 8 : 14)
        .background(.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
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
                            Text("\(value)").blasterFont(size: 14, weight: .black).foregroundStyle(
                                .black)
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
    let labelWidth: CGFloat
    let spacing: CGFloat

    var body: some View {
        GeometryReader { geometry in
            TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !(audio.isRunning && audio.input == .beatLab))) {
                _ in
                let column = (geometry.size.width - spacing * 15) / 16
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
