import NardukMusicCore
import SwiftUI

/// The Effects page's sliders. `nil` means "untouched": the song plays as written. Applied to the notes the player
/// is about to schedule, so a change is heard within the engine's look-ahead (a quarter second).
struct EffectSettings: Equatable {
    /// 0 dark ("yoi") ... 1 bright ("wub"): the bass voices' formant.
    var filter: Double?
    /// 0 none ... 1 long repeating echoes of the melody and the snare.
    var echo = 0.0
    /// 0 ... 1: more drive and weight on the bass, and a louder bass channel (`BlasterAudio`).
    var bass = 0.0
    /// 0 slow ... 1 fast within the style's range; nil keeps the speed the song was made with.
    var speed: Double?

    static let echoed: Set<Instrument> = [
        .keys, .acousticGuitar, .electricGuitar, .strum, .electricStrum, .snare, .hat, .laser, .vox,
    ]
    static let bassVoices: Set<Instrument> = [.wobble, .sub, .bassGuitar]

    var isNeutral: Bool { filter == nil && echo < 0.02 && bass < 0.02 }

    func apply(to notes: [ScheduledNote]) -> [ScheduledNote] {
        guard !isNeutral else { return notes }
        var out: [ScheduledNote] = []
        out.reserveCapacity(notes.count)
        for var note in notes {
            if Self.bassVoices.contains(note.instrument) {
                if let filter { note.params.formant = filter }
                if bass >= 0.02 {
                    note.params.drive = max(note.params.drive ?? 0, 0.55 * bass)
                    note.velocity = min(1, note.velocity * (1 + 0.35 * bass))
                }
            }
            out.append(note)
            if echo >= 0.02, Self.echoed.contains(note.instrument) {
                // Dotted-eighth repeats, fading; more echo means more of them and louder.
                for (index, gap) in [3, 6, 9].enumerated() where Double(index) < 1 + 2 * echo {
                    let fade: Double = echo * pow(0.6, Double(index + 1)) * 1.4
                    var repeated = note
                    repeated.step += gap
                    repeated.velocity = note.velocity * fade
                    if repeated.velocity > 0.05 { out.append(repeated) }
                }
            }
        }
        return out
    }
}

/// Big one-shot sound-effect buttons, built from the engine's own voices. A press plays on the next free 16th.
enum SoundPad: String, CaseIterable, Identifiable {
    case airHorn, laser, scratch, boom, siren, clap, yeah, vocalChop

    var id: String { rawValue }

    var emoji: String {
        switch self {
        case .airHorn: "📯"
        case .laser: "🔫"
        case .scratch: "💿"
        case .boom: "💥"
        case .siren: "🚨"
        case .clap: "👏"
        case .yeah: "🗣"
        case .vocalChop: "🎤"
        }
    }

    var word: String {
        switch self {
        case .airHorn: "Air horn"
        case .laser: "Zap"
        case .scratch: "Scratch"
        case .boom: "Boom"
        case .siren: "Siren"
        case .clap: "Clap"
        case .yeah: "Yeah!"
        case .vocalChop: "Vocal"
        }
    }

    var color: Color {
        switch self {
        case .airHorn: Neon.yellow
        case .laser: Neon.cyan
        case .scratch: Neon.purple
        case .boom: Neon.orange
        case .siren: Neon.pink
        case .clap: Neon.green
        case .yeah: Neon.pink
        case .vocalChop: Neon.purple
        }
    }

    /// The notes for a press landing on `step`.
    func notes(at step: Int) -> [ScheduledNote] {
        func note(_ offset: Int, _ instrument: Instrument, _ velocity: Double = 1, _ params: NoteParams = .init())
            -> ScheduledNote
        {
            ScheduledNote(step: step + offset, instrument: instrument, velocity: velocity, params: params)
        }
        switch self {
        case .airHorn:
            let chord = [67, 71, 74].map {
                note(0, .keys, 1, NoteParams(pitch: $0, lengthSteps: 9, drive: 1, voice: 1))
            }
            return chord + [note(11, .keys, 1, NoteParams(pitch: 74, lengthSteps: 5, drive: 1, voice: 1))]
        case .laser:
            return [
                note(0, .laser, 1, NoteParams(pitch: 88, lengthSteps: 4)),
                note(3, .laser, 0.9, NoteParams(pitch: 76, lengthSteps: 4)),
            ]
        case .scratch:
            return [
                note(0, .scratch, 1, NoteParams(lengthSteps: 4)), note(3, .scratch, 0.9, NoteParams(lengthSteps: 3)),
            ]
        case .boom:
            return [note(0, .impact, 1, NoteParams(pitch: 36, lengthSteps: 8)), note(0, .kick, 1)]
        case .siren:
            return (0..<8).map { index in
                note(
                    index * 2, .keys, 0.8,
                    NoteParams(pitch: index.isMultiple(of: 2) ? 76 : 83, lengthSteps: 2, drive: 0.3, voice: 1))
            }
        case .clap:
            return [note(0, .snare, 1), note(1, .snare, 0.7), note(0, .openHat, 0.5)]
        case .yeah:
            return [note(0, .vox, 1, NoteParams(pitch: 60, lengthSteps: 4))]
        case .vocalChop:
            // A real sung syllable (VocalSet), then a second slice a beat later.
            return [0, 4].map { offset in
                note(
                    offset, .vocalSample, 1,
                    NoteParams(
                        pitch: 64, lengthSteps: 4, formant: Double((step + offset) % 5) / 5,
                        voice: NoteParams.sampleVoice(.ah, technique: .straight, kind: .chop)))
            }
        }
    }
}

/// The player's second page: the sound-effect pads, STUTTER and four sliders (Energy lives on the Mix page). A wide
/// screen sets them side by side (pads and STUTTER left, the sliders two by two right) so the tray stays short and the
/// lights keep the screen; a phone stacks them.
struct EffectsPanel: View {
    let audio: BlasterAudio
    let compact: Bool
    let short: Bool
    var wide = false
    var onPad: (SoundPad) -> Void = { _ in }
    /// STUTTER: true while the pad is held, false on release.
    var onStutter: (Bool) -> Void = { _ in }

    var body: some View {
        if wide {
            HStack(alignment: .top, spacing: 16) {
                VStack(spacing: 8) {
                    pads(columns: 4)
                    StutterPad(compact: compact, onHold: onStutter)
                }
                .frame(maxWidth: .infinity)
                Grid(horizontalSpacing: 14, verticalSpacing: 6) {
                    GridRow {
                        sliders[0]
                        sliders[1]
                    }
                    GridRow {
                        sliders[2]
                        sliders[3]
                    }
                }
                .frame(maxWidth: .infinity)
            }
        } else {
            VStack(spacing: compact ? 8 : 12) {
                pads(columns: compact ? 4 : 8)
                StutterPad(compact: compact, onHold: onStutter)
                ForEach(sliders.indices, id: \.self) { sliders[$0] }
            }
        }
    }

    private func pads(columns: Int) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columns), spacing: 8) {
            ForEach(SoundPad.allCases) { pad in
                Button {
                    Haptics.success()
                    onPad(pad)
                } label: {
                    VStack(spacing: 2) {
                        Glyph(pad.emoji, size: compact ? 28 : 36)
                        Text(pad.word)
                            .blasterFont(size: compact ? 12 : 15, weight: .black)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 64)
                    .background(pad.color.opacity(0.6), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.7), lineWidth: 2)
                    )
                }
                .buttonStyle(Squish())
                .accessibilityLabel(pad.word)
                .accessibilityIdentifier("fx.pad.\(pad.word)")
            }
        }
    }

    private var sliders: [EffectSlider] {
        [
            EffectSlider(
                icon: "🌊", title: "Wobble", low: "Dark", high: "Bright", color: Neon.cyan,
                value: Binding(get: { audio.effects.filter ?? 0.5 }, set: { audio.effects.filter = $0 })),
            EffectSlider(
                icon: "🔁", title: "Echo", low: "Dry", high: "Echoey", color: Neon.purple,
                value: Binding(get: { audio.effects.echo }, set: { audio.effects.echo = $0 })),
            EffectSlider(
                icon: "🔊", title: "Bass boost", low: "Normal", high: "BOOM", color: Neon.orange,
                value: Binding(get: { audio.effects.bass }, set: { audio.effects.bass = $0 })),
            EffectSlider(
                icon: "🐢", title: "Speed", low: "Slow", high: "Fast", color: Neon.green,
                value: Binding(
                    get: { audio.effects.speed ?? audio.recipe.speed.sliderPosition },
                    set: { audio.effects.speed = $0 })),
        ]
    }
}

/// STUTTER: hold it and the live mix repeats on the beat; let go and the song comes back.
struct StutterPad: View {
    let compact: Bool
    var onHold: (Bool) -> Void
    @State private var held = false

    var body: some View {
        HStack(spacing: 10) {
            Glyph("🔁", size: compact ? 28 : 36)
            Text(held ? "Stuttering…" : "Hold to STUTTER")
                .font(.system(size: compact ? 15 : 18, weight: .black, design: .rounded))
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, minHeight: 56)
        .background(Neon.cyan.opacity(held ? 0.9 : 0.6), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.7), lineWidth: 2))
        .scaleEffect(held ? 0.97 : 1)
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    guard !held else { return }
                    held = true
                    Haptics.success()
                    onHold(true)
                }
                .onEnded { _ in
                    held = false
                    onHold(false)
                }
        )
        .onDisappear {
            if held {
                held = false
                onHold(false)
            }
        }
        .probe("fx.stutter")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Stutter")
        .accessibilityHint("Hold to repeat the music on the beat")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("fx.stutter")
    }
}

/// A labelled 0...1 slider with big hit area.
struct EffectSlider: View {
    let icon: String
    let title: String
    let low: String
    let high: String
    let color: Color
    @Binding var value: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Glyph(icon, size: 18)
                Text(title)
                    .blasterFont(size: 15, weight: .black)
                    .foregroundStyle(.white)
            }
            HStack(spacing: 8) {
                Text(low).blasterFont(size: 12, weight: .heavy).foregroundStyle(.white.opacity(0.8))
                    .fixedSize()
                Slider(value: $value, in: 0...1)
                    .tint(color)
                    .frame(minHeight: 44)
                    .accessibilityLabel(title)
                Text(high).blasterFont(size: 12, weight: .heavy).foregroundStyle(
                    .white.opacity(0.8)
                )
                .fixedSize()
            }
        }
    }
}

extension Speed {
    /// Where the style's own speed sits on the Speed slider (slow 0 ... fast 1).
    var sliderPosition: Double {
        switch self {
        case .slow: 0
        case .medium: 0.5
        case .fast: 1
        }
    }
}
