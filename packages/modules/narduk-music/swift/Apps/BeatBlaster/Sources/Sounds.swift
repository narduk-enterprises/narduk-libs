import Foundation
import NardukMusicCore

/// Sound choices. Every one is a real change to the notes the engine plays: the synth's own patch and voice numbers,
/// drive, formant, octave, swing (`NoteParams.delay`), or a swap to another of the engine's instruments. Nothing is a
/// post effect: `DropEngine` owns its audio graph and exposes no EQ or effect insert.

/// The bass: the engine's wobble patches (`voice` picks one of 36 ... 48), pushed harder for Growl, swapped to the sine
/// sub for Deep or the plucked bass guitar for Pluck.
enum BassSound: String, CaseIterable, Identifiable, Codable {
    case wobble, growl, deep, pluck

    var id: String { rawValue }
    var word: String { rawValue.capitalized }
    var emoji: String {
        switch self {
        case .wobble: "🌊"
        case .growl: "🐻"
        case .deep: "🐋"
        case .pluck: "🎸"
        }
    }

    /// The note this bass plays in place of `note` (a wobble or bass-guitar note).
    func apply(_ note: ScheduledNote, patch: Int) -> ScheduledNote {
        var n = note
        var p = n.params
        switch self {
        case .wobble, .growl:
            if n.instrument == .bassGuitar {
                n.instrument = .wobble
                p.pitch = p.pitch.map { DropPattern.fold($0, into: 36...47) }
                p.wobbleRate = p.wobbleRate ?? .eighth
            }
            p.voice = patch
            if self == .growl {
                p.drive = 0.95
                p.formant = 1
            }
        case .deep:
            n.instrument = .sub
            p.pitch = p.pitch.map { DropPattern.fold($0 - 12, into: 26...37) }
            p.voice = nil
            p.drive = nil
        case .pluck:
            n.instrument = .bassGuitar
            p.pitch = p.pitch.map { DropPattern.fold($0, into: 28...43) }
            p.lengthSteps = min(max(p.lengthSteps, 2), 6)
            p.voice = nil
            p.wobbleRate = nil
        }
        n.params = p
        return n
    }
}

/// The keys timbres the engine has (`KeysVoice`): bell pluck, house stab, electric piano.
enum KeysSound: String, CaseIterable, Identifiable, Codable {
    case bell, synth, piano

    var id: String { rawValue }
    var word: String { rawValue.capitalized }
    var emoji: String {
        switch self {
        case .bell: "🔔"
        case .synth: "🎛️"
        case .piano: "🎹"
        }
    }
    var voice: Int {
        switch self {
        case .bell: KeysVoice.bell
        case .synth: KeysVoice.stab
        case .piano: KeysVoice.electricPiano
        }
    }
}

/// Drum kits. The engine's drums have no timbre setting, so a kit swaps or layers the engine's other instruments.
enum DrumKit: String, CaseIterable, Identifiable, Codable {
    case classic, boom, zappy, dj

    var id: String { rawValue }
    var word: String {
        switch self {
        case .classic: "Classic"
        case .boom: "Boom"
        case .zappy: "Zappy"
        case .dj: "DJ"
        }
    }
    var emoji: String {
        switch self {
        case .classic: "🥁"
        case .boom: "💣"
        case .zappy: "⚡️"
        case .dj: "💿"
        }
    }

    /// The notes this kit plays for one drum note; `keyRoot` tunes the layered sub and zap.
    func apply(_ note: ScheduledNote, keyRoot: Int) -> [ScheduledNote] {
        switch (self, note.instrument) {
        case (.boom, .kick):
            return [
                note,
                ScheduledNote(
                    step: note.step, instrument: .sub, velocity: note.velocity * 0.8,
                    params: NoteParams(pitch: DropPattern.fold(keyRoot, into: 26...37), lengthSteps: 2, delay: note.params.delay)),
            ]
        case (.boom, .hat):
            return note.step % 4 == 2 ? [retimbre(note, .openHat, velocity: 0.8)] : [note]
        case (.zappy, .snare):
            return [
                note,
                ScheduledNote(
                    step: note.step, instrument: .laser, velocity: note.velocity * 0.6,
                    params: NoteParams(pitch: DropPattern.fold(keyRoot + 12, into: 72...83), delay: note.params.delay)),
            ]
        case (.zappy, .hat), (.zappy, .openHat):
            var n = note
            n.params.pan = n.step % 2 == 0 ? -0.6 : 0.6
            return [n]
        case (.dj, .snare):
            return [retimbre(note, .scratch, velocity: 1)]
        default:
            return [note]
        }
    }

    private func retimbre(_ note: ScheduledNote, _ instrument: Instrument, velocity: Double) -> ScheduledNote {
        var n = note
        n.instrument = instrument
        n.velocity = min(1, note.velocity * velocity)
        return n
    }
}

/// Happy or sad and in between: the harmony mode every track of the song is pinned to.
enum Mood: String, CaseIterable, Identifiable, Codable {
    case happy, cool, dreamy, dark, spooky

    var id: String { rawValue }
    var word: String { rawValue.capitalized }
    var emoji: String {
        switch self {
        case .happy: "😀"
        case .cool: "😎"
        case .dreamy: "🦄"
        case .dark: "🌙"
        case .spooky: "👻"
        }
    }
    var mode: HarmonyMode {
        switch self {
        case .happy: .major
        case .cool: .dorian
        case .dreamy: .lydian
        case .dark: .minor
        case .spooky: .phrygian
        }
    }
}

/// Note names for the key pickers (index 0 = C).
enum MusicKey {
    static let names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]

    /// Semitones from key `from` to key `to` (0 = C), folded to -6 ... 5 so parts never move far.
    static func offset(from: Int, to: Int) -> Int {
        let up = ((to - from) % 12 + 12) % 12
        return up > 5 ? up - 12 : up
    }
}

/// The sounds of one song, applied to every note on its way to the engine.
struct SoundProfile: Codable, Hashable {
    var bass: BassSound = .wobble
    /// The wobble patch (`NoteParams.voice`); the engine has 6 base patches times character variants.
    var bassPatch = 0
    var keys: KeysSound = .piano
    /// Keys octave: -1, 0 or 1.
    var keysOctave = 0
    var drums: DrumKit = .classic
    /// 0 ... 0.35 of a step the off-16ths sound late.
    var swing = 0.0

    static func random() -> SoundProfile {
        SoundProfile(
            bass: BassSound.allCases.randomElement()!, bassPatch: Int.random(in: 0..<48),
            keys: KeysSound.allCases.randomElement()!, keysOctave: Int.random(in: -1...1),
            drums: DrumKit.allCases.randomElement()!, swing: [0, 0, 0.15, 0.3].randomElement()!)
    }

    func apply(_ notes: [ScheduledNote], keyRoot: Int) -> [ScheduledNote] {
        var out: [ScheduledNote] = []
        out.reserveCapacity(notes.count + 8)
        for var note in notes {
            if swing > 0, note.step % 2 == 1, note.params.delay == nil { note.params.delay = swing }
            switch note.instrument {
            case .wobble, .bassGuitar:
                out.append(bass.apply(note, patch: bassPatch))
            case .keys:
                if let voice = note.params.voice, voice == KeysVoice.pad || voice >= KeysVoice.ambientPad {
                    out.append(note)
                } else {
                    note.params.voice = keys.voice
                    note.params.pitch = note.params.pitch.map { $0 + 12 * keysOctave }
                    out.append(note)
                }
            case .kick, .snare, .hat, .openHat:
                out += drums.apply(note, keyRoot: keyRoot)
            default:
                out.append(note)
            }
        }
        return out
    }
}
