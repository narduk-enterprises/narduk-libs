import SwiftUI

/// Beat Lab: a 16-step sequencer (Kick, Snare, Hat, Zap, Bass, Keys) with lights behind it.
struct BeatLabView: View {
    let audio: BlasterAudio
    let lab: BeatLab
    let home: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var panel = false

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            ZStack {
                LiveVisual(audio: audio, tile: VisualTile.with(id: audio.lightsID), drawing: scenePhase == .active)
                    .opacity(0.45)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                Vignette()
                VStack(spacing: compact ? 10 : 16) {
                    HStack(spacing: 12) {
                        HomeButton(action: home)
                        Text("🥁 Beat Lab")
                            .font(.system(size: compact ? 26 : 44, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                        Spacer(minLength: 0)
                    }
                    Text(
                        "Tap the squares to make a beat. Tap a row's name to change its sound. Bass and Keys squares change note each tap."
                    )
                    .font(.system(size: compact ? 14 : 20, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    BeatGrid(audio: audio, lab: lab, compact: compact)
                    controls(compact: compact)
                    Spacer(minLength: 0)
                    MusicLightsBar(
                        audio: audio, musicTitle: "My beat", musicEmoji: "🥁", showMusicChange: false,
                        changeMusic: {}, changeLights: { withAnimation { panel = true } })
                }
                .padding(compact ? 12 : 24)
                if panel {
                    PickerPanel(title: "Pick the lights", badge: .lights, close: { withAnimation { panel = false } }) {
                        LightsGrid(audio: audio, selectedID: audio.lightsID, compact: compact) { audio.lightsID = $0 }
                    }
                    .transition(.move(edge: .bottom))
                }
            }
        }
        .onAppear { audio.startBeatLab(lab) }
    }

    private func controls(compact: Bool) -> some View {
        let size: CGFloat = compact ? 16 : 22
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                transport(size)
                Spacer(minLength: 0)
                speed(size)
                keyPicker(size)
                edit(size)
            }
            VStack(spacing: 10) {
                HStack(spacing: 10) {
                    transport(size)
                    speed(size)
                }
                HStack(spacing: 10) {
                    keyPicker(size)
                    edit(size)
                }
            }
        }
    }

    /// The key of the Bass and Keys rows: ◀︎ F ▶︎.
    private func keyPicker(_ size: CGFloat) -> some View {
        HStack(spacing: 6) {
            Button {
                Haptics.tap()
                lab.key = (lab.key + 11) % 12
            } label: {
                Pill(icon: "◀︎", word: "", color: .white.opacity(0.12), size: size * 0.8)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Key down")
            Text("🎼 Key: \(MusicKey.names[lab.key])")
                .font(.system(size: size * 0.85, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .fixedSize()
            Button {
                Haptics.tap()
                lab.key = (lab.key + 1) % 12
            } label: {
                Pill(icon: "▶︎", word: "", color: .white.opacity(0.12), size: size * 0.8)
            }
            .buttonStyle(Squish())
            .accessibilityLabel("Key up")
        }
    }

    private func transport(_ size: CGFloat) -> some View {
        Button {
            Haptics.tap()
            if audio.isRunning, audio.input == .beatLab { audio.stop() } else { audio.startBeatLab(lab) }
        } label: {
            let playing = audio.isRunning && audio.input == .beatLab
            Pill(
                icon: playing ? "⏹" : "▶︎", word: playing ? "Stop" : "Play",
                color: playing ? Neon.pink.opacity(0.75) : Neon.green.opacity(0.8), size: size)
        }
        .buttonStyle(Squish())
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
                            Text(row.emoji).font(.system(size: compact ? 14 : 24))
                            VStack(alignment: .leading, spacing: 0) {
                                Text(row.word)
                                    .font(.system(size: compact ? 12 : 20, weight: .black, design: .rounded))
                                    .foregroundStyle(.white)
                                Text("🔄 \(lab.soundName(row))")
                                    .font(.system(size: compact ? 9 : 14, weight: .heavy, design: .rounded))
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
                            Text("\(value)").font(.system(size: 14, weight: .black, design: .rounded)).foregroundStyle(
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
