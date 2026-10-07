import Foundation
import NardukMusicCore

/// Sound choices. Every one is a real change to the notes the engine plays: the synth's own patch and voice numbers,
/// drive, formant, octave, swing (`NoteParams.delay`), or a swap to another of the engine's instruments. Nothing is a
/// post effect: `DropEngine` owns its audio graph and exposes no EQ or effect insert.

/// The bass: the engine's wobble patches (`voice` picks one of 36 ... 48), pushed harder for Growl, swapped to the sine
/// sub for Deep or the plucked bass guitar for Pluck.
enum BassSound: String, CaseIterable, Identifiable, Codable {
    case wobble, growl, deep, pluck, squelch, buzz, bounce, robot

    var id: String { rawValue }
    var word: String { rawValue.capitalized }
    var emoji: String {
        switch self {
        case .wobble: "icon-wobble-wave"
        case .growl: "icon-growl"
        case .deep: "icon-deep"
        case .pluck: "icon-pluck"
        case .squelch: "icon-squelch"
        case .buzz: "icon-buzz"
        case .bounce: "icon-bounce"
        case .robot: "icon-robot"
        }
    }

    /// The note this bass plays in place of `note` (a wobble or bass-guitar note).
    func apply(_ note: ScheduledNote, patch: Int) -> ScheduledNote {
        var n = note
        var p = n.params
        switch self {
        case .wobble, .growl, .squelch, .buzz, .robot:
            if n.instrument == .bassGuitar {
                n.instrument = .wobble
                p.pitch = p.pitch.map { DropPattern.fold($0, into: 36...47) }
                p.wobbleRate = p.wobbleRate ?? .eighth
            }
            p.voice = patch
            switch self {
            case .growl:
                p.drive = 0.95
                p.formant = 1
            case .squelch:
                p.voice = (patch + 6) % 48
                p.formant = 0.35
                p.drive = 0.5
            case .buzz:
                p.voice = (patch + 12) % 48
                p.formant = 0
                p.drive = 1
            case .robot:
                p.voice = (patch + 24) % 48
                p.formant = 0.8
                p.drive = 0.3
                p.wobbleRate = .sixteenth
            default: break
            }
        case .bounce:
            n.instrument = .sub
            p.pitch = p.pitch.map { DropPattern.fold($0, into: 28...40) }
            p.lengthSteps = 1
            p.voice = nil
            p.drive = 0.4
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
    case bell, synth, piano, pad, glow, sparkle, mellow

    var id: String { rawValue }
    var word: String { rawValue.capitalized }
    var emoji: String {
        switch self {
        case .bell: "icon-bell"
        case .synth: "icon-synth"
        case .piano: "icon-piano"
        case .pad: "icon-cloud"
        case .glow: "icon-glow"
        case .sparkle: "icon-sparkle"
        case .mellow: "icon-sax"
        }
    }
    var voice: Int {
        switch self {
        case .bell, .sparkle: KeysVoice.bell
        case .synth: KeysVoice.stab
        case .piano, .mellow: KeysVoice.electricPiano
        case .pad: KeysVoice.pad
        case .glow: KeysVoice.ambientPad
        }
    }
    /// Semitones the timbre sits above or below the song's keys.
    var shift: Int {
        switch self {
        case .sparkle: 12
        case .mellow: -12
        default: 0
        }
    }
}

/// Drum kits. The engine's drums have no timbre setting, so a kit swaps or layers the engine's other instruments.
enum DrumKit: String, CaseIterable, Identifiable, Codable {
    case classic, boom, zappy, dj, glitch, stomp, shimmer

    var id: String { rawValue }
    var word: String {
        switch self {
        case .classic: "Classic"
        case .boom: "Boom"
        case .zappy: "Zappy"
        case .dj: "DJ"
        case .glitch: "Glitch"
        case .stomp: "Stomp"
        case .shimmer: "Shimmer"
        }
    }
    var emoji: String {
        switch self {
        case .classic: "icon-kit-classic"
        case .boom: "icon-kit-boom"
        case .zappy: "icon-kit-zappy"
        case .dj: "icon-kit-dj"
        case .glitch: "icon-glitch"
        case .stomp: "icon-stomp"
        case .shimmer: "icon-sparkle"
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
                    params: NoteParams(
                        pitch: DropPattern.fold(keyRoot, into: 26...37), lengthSteps: 2, delay: note.params.delay)),
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
        case (.glitch, .hat):
            return note.step % 2 == 1 ? [retimbre(note, .glitch, velocity: 0.55)] : [note]
        case (.stomp, .snare):
            var low = note
            low.instrument = .kick
            low.velocity = min(1, note.velocity * 0.75)
            return [note, low]
        case (.shimmer, .hat):
            var late = note
            late.params.delay = 0.5
            late.velocity = note.velocity * 0.5
            return [note, late]
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

/// The guitar: how the song's strums and picked notes sound. Auto keeps what the style wrote.
enum GuitarSound: String, CaseIterable, Identifiable, Codable {
    case auto, folk, clean, crunch, fuzz

    var id: String { rawValue }
    var word: String { self == .auto ? "Auto" : rawValue.capitalized }
    var emoji: String {
        switch self {
        case .auto: "icon-auto"
        case .folk: "icon-guitar"
        case .clean: "icon-sparkle"
        case .crunch: "icon-crunch"
        case .fuzz: "icon-fuzz"
        }
    }

    func apply(_ note: ScheduledNote) -> ScheduledNote {
        var n = note
        switch self {
        case .auto: break
        case .folk:
            if n.instrument == .electricGuitar { n.instrument = .acousticGuitar }
            if n.instrument == .electricStrum { n.instrument = .strum }
        case .clean, .crunch, .fuzz:
            if n.instrument == .acousticGuitar { n.instrument = .electricGuitar }
            if n.instrument == .strum { n.instrument = .electricStrum }
            if n.instrument == .electricGuitar || n.instrument == .electricStrum {
                n.params.drive = self == .clean ? 0.05 : (self == .crunch ? 0.55 : 1)
            }
        }
        return n
    }
}

/// The pad chords: Auto keeps the style's own, the rest swap the pad voice or move it an octave.
enum PadSound: String, CaseIterable, Identifiable, Codable {
    case auto, soft, glow, deepPad, shimmer, drone

    var id: String { rawValue }
    var word: String {
        switch self {
        case .auto: "Auto"
        case .deepPad: "Deep"
        default: rawValue.capitalized
        }
    }
    var emoji: String {
        switch self {
        case .auto: "icon-auto"
        case .soft: "icon-cloud"
        case .glow: "icon-glow"
        case .deepPad: "icon-deep"
        case .shimmer: "icon-sparkle"
        case .drone: "icon-drone"
        }
    }

    func apply(_ note: ScheduledNote) -> ScheduledNote {
        var n = note
        switch self {
        case .auto: break
        case .soft: n.params.voice = KeysVoice.pad
        case .glow: n.params.voice = KeysVoice.ambientPad
        case .deepPad:
            n.params.voice = KeysVoice.ambientPad
            n.params.pitch = n.params.pitch.map { $0 - 12 }
        case .shimmer:
            n.params.voice = KeysVoice.pad
            n.params.pitch = n.params.pitch.map { $0 + 12 }
        case .drone: n.params.voice = KeysVoice.drone
        }
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
        case .happy: "icon-happy"
        case .cool: "icon-cool"
        case .dreamy: "icon-dreamy"
        case .dark: "icon-dark"
        case .spooky: "icon-spooky"
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
/// The real female voice (VocalSet, CC BY 4.0) as a song layer: one held vowel per bar on the song's key. Off by default.
enum SingerSound: String, CaseIterable, Identifiable, Codable {
    case off, ah, oh, oo, eh, ee

    var id: String { rawValue }
    var word: String { self == .off ? "None" : rawValue.capitalized }
    var emoji: String { self == .off ? "icon-mic-off" : "icon-mic" }

    var vowel: VocalVowel? {
        switch self {
        case .off: nil
        case .ah: .ah
        case .oh: .oh
        case .oo: .oo
        case .eh: .eh
        case .ee: .ee
        }
    }
}

struct SoundProfile: Codable, Hashable {
    var bass: BassSound = .wobble
    /// The wobble patch (`NoteParams.voice`); the engine has 6 base patches times character variants.
    var bassPatch = 0
    var keys: KeysSound = .piano
    /// Keys octave: -1, 0 or 1.
    var keysOctave = 0
    /// Boom: the kick carries a sub under it, so the default kick is felt as well as heard.
    var drums: DrumKit = .boom
    /// 0 ... 0.35 of a step the off-16ths sound late.
    var swing = 0.0
    var guitar: GuitarSound = .auto
    var pads: PadSound = .auto
    var singer: SingerSound = .off

    init(
        bass: BassSound = .wobble, bassPatch: Int = 0, keys: KeysSound = .piano, keysOctave: Int = 0,
        drums: DrumKit = .boom, swing: Double = 0, guitar: GuitarSound = .auto, pads: PadSound = .auto,
        singer: SingerSound = .off
    ) {
        self.bass = bass
        self.bassPatch = bassPatch
        self.keys = keys
        self.keysOctave = keysOctave
        self.drums = drums
        self.swing = swing
        self.guitar = guitar
        self.pads = pads
        self.singer = singer
    }

    /// Songs saved before the guitar and pad rows existed have no such keys: they decode as Auto.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            bass: try c.decodeIfPresent(BassSound.self, forKey: .bass) ?? .wobble,
            bassPatch: try c.decodeIfPresent(Int.self, forKey: .bassPatch) ?? 0,
            keys: try c.decodeIfPresent(KeysSound.self, forKey: .keys) ?? .piano,
            keysOctave: try c.decodeIfPresent(Int.self, forKey: .keysOctave) ?? 0,
            drums: try c.decodeIfPresent(DrumKit.self, forKey: .drums) ?? .boom,
            swing: try c.decodeIfPresent(Double.self, forKey: .swing) ?? 0,
            guitar: try c.decodeIfPresent(GuitarSound.self, forKey: .guitar) ?? .auto,
            pads: try c.decodeIfPresent(PadSound.self, forKey: .pads) ?? .auto,
            singer: try c.decodeIfPresent(SingerSound.self, forKey: .singer) ?? .off)
    }

    /// The sounds a vibe is known for (its bass, keys, drum kit, swing, guitar and pads), what "Mash it up" carries
    /// from the sound vibe onto the other vibe's beat. The wobble patch is random so two mashes never sound the same.
    static func signature(of style: BlasterStyle) -> SoundProfile {
        let patch = Int.random(in: 0..<48)
        switch style {
        case .guitars: return SoundProfile(bass: .pluck, bassPatch: patch, drums: .stomp, guitar: .fuzz)
        case .genre(let genre):
            switch genre {
            case .dubstep: return SoundProfile(bass: .wobble, bassPatch: patch, keys: .synth, drums: .boom)
            case .riddim: return SoundProfile(bass: .robot, bassPatch: patch, keys: .synth, drums: .stomp)
            case .drumAndBass: return SoundProfile(bass: .growl, bassPatch: patch, keys: .glow, drums: .zappy)
            case .trap: return SoundProfile(bass: .deep, bassPatch: patch, keys: .bell, drums: .boom)
            case .house: return SoundProfile(bass: .bounce, bassPatch: patch, keys: .piano, drums: .dj)
            case .chill:
                return SoundProfile(bass: .deep, bassPatch: patch, keys: .mellow, drums: .shimmer, pads: .soft)
            case .techno: return SoundProfile(bass: .buzz, bassPatch: patch, keys: .synth, drums: .glitch)
            case .ukGarage:
                return SoundProfile(bass: .squelch, bassPatch: patch, keys: .glow, drums: .dj, swing: 0.3)
            case .synthwave:
                return SoundProfile(bass: .buzz, bassPatch: patch, keys: .synth, drums: .classic, pads: .glow)
            case .lofi:
                return SoundProfile(
                    bass: .pluck, bassPatch: patch, keys: .mellow, drums: .classic, swing: 0.15, pads: .soft)
            case .rock: return SoundProfile(bass: .pluck, bassPatch: patch, drums: .stomp, guitar: .crunch)
            case .folk:
                return SoundProfile(bass: .pluck, bassPatch: patch, keys: .piano, drums: .classic, guitar: .folk)
            case .funk:
                return SoundProfile(
                    bass: .bounce, bassPatch: patch, keys: .piano, drums: .dj, swing: 0.15, guitar: .clean)
            }
        }
    }

    static func random() -> SoundProfile {
        SoundProfile(
            bass: [BassSound.wobble, .growl, .deep, .squelch, .buzz, .bounce, .robot].randomElement()!,
            bassPatch: Int.random(in: 0..<48),
            keys: KeysSound.allCases.randomElement()!, keysOctave: Int.random(in: -1...1),
            drums: DrumKit.allCases.randomElement()!, swing: [0, 0, 0.15, 0.3].randomElement()!,
            guitar: GuitarSound.allCases.randomElement()!, pads: PadSound.allCases.randomElement()!,
            singer: [SingerSound.off, .off, .ah, .oh, .oo].randomElement()!)
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
                    out.append(pads.apply(note))
                } else {
                    note.params.voice = keys.voice
                    note.params.pitch = note.params.pitch.map { $0 + 12 * keysOctave + keys.shift }
                    out.append(note)
                }
            case .acousticGuitar, .electricGuitar, .strum, .electricStrum:
                out.append(guitar.apply(note))
            case .kick, .snare, .hat, .openHat:
                out += drums.apply(note, keyRoot: keyRoot)
            default:
                out.append(note)
            }
        }
        return out
    }
}
