import Foundation

// The DROP button's sound, written for the song that is playing (narduk-libs B8-drops). A press starts a build, a hold
// keeps it at full charge and a release lands the drop; this file writes the notes of both, one step at a time, as pure
// functions of a `DropContext`: the genre, the key and current chord, the tempo grid, the seed and the variety. Same
// inputs, same notes, so a drop is deterministic and testable. It plays the instruments the song already has (the
// wobble bass, the sub, the kit, keys, strums), so a drop sounds like the song's own, not a stock effect.
//
// - Key and harmony: the riser rises two octaves and ends on the tonic; the drop lands on the tonic and then moves to
//   the song's current (or next) chord on the bar; every pitch is the tonic, the chord root, a fifth, a third in the
//   key, or a scale step.
// - Tempo: the snare roll, the riser's length and every groove are in steps of the song's own 16th grid, so they lock
//   to its BPM and bar grid; position 0 of the drop is the downbeat of the drop's own bar grid.
// - Genre: seven drop styles (half-time wobble, reese and break roll, 808 and hat rolls, four-on-the-floor slam, UK
//   garage two-step, gentle swell and tape stop, band fill and crash, synthwave gated snare and arpeggio).
// - Variety: `SongSettings.variety` is the chance that a drop picks one of its 2-3 variants instead of the first; the
//   seed and the drop's number pick which, so repeated drops differ. Variety 0 always plays the first.

/// What a drop needs to know about the song playing under it.
public struct DropContext: Sendable, Hashable {
    public var genre: Genre
    /// MIDI tonic of the key, in any octave.
    public var keyRoot: Int
    public var minor: Bool
    /// The song's current chord root (its bass line's latest root), MIDI, in any octave.
    public var chordRoot: Int
    /// The next chord's root, when the song knows it; the drop moves to it on its second bar. Nil holds the current one.
    public var nextChordRoot: Int?
    public var stepsPerBar: Int
    public var secondsPerStep: Double
    public var seed: UInt64
    /// 0 ... 1, `SongSettings.variety`.
    public var variety: Double
    /// How many drops this song has played, so the next one can differ from the last.
    public var dropNumber: Int
    /// The song's wobble patch (`NoteParams.voice`), so the drop's bass is the song's bass.
    public var bassVoice: Int?

    public init(
        genre: Genre, keyRoot: Int, minor: Bool, chordRoot: Int? = nil, nextChordRoot: Int? = nil,
        stepsPerBar: Int = 16, secondsPerStep: Double, seed: UInt64 = 0x5EED, variety: Double = 0.75,
        dropNumber: Int = 0, bassVoice: Int? = nil
    ) {
        self.genre = genre
        self.keyRoot = keyRoot
        self.minor = minor
        self.chordRoot = chordRoot ?? keyRoot
        self.nextChordRoot = nextChordRoot
        self.stepsPerBar = max(4, stepsPerBar)
        self.secondsPerStep = max(secondsPerStep, 0.001)
        self.seed = seed
        self.variety = min(1, max(0, variety.isFinite ? variety : 0))
        self.dropNumber = dropNumber
        self.bassVoice = bassVoice
    }
}

public enum DropArranger {
    /// Seconds of holding that fill the charge: the build stops getting faster here and holds flat until the release.
    public static let fullChargeSeconds = 4.0

    /// 0 ... 1: how long the build has run.
    public static func charge(heldSteps: Int, secondsPerStep: Double) -> Double {
        min(1, max(0, Double(heldSteps) * secondsPerStep / fullChargeSeconds))
    }

    /// How long the riser lasts, in steps: it tops out as the charge fills, however long the hold goes on.
    public static func riserSteps(secondsPerStep: Double) -> Int {
        max(1, Int((fullChargeSeconds / secondsPerStep).rounded()))
    }

    /// The tonic (a pitch class, 0 = C) and quality of a key as `TrackInfo.key` names it ("F# dorian", "Bb major"):
    /// minor for the aeolian, dorian, phrygian and locrian modes, major otherwise. Nil if the tonic does not parse.
    public static func parseKey(_ key: String) -> (pitchClass: Int, minor: Bool)? {
        let words = key.split(separator: " ")
        guard let name = words.first, let letter = name.first else { return nil }
        let base: [Character: Int] = ["C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11]
        guard var pitchClass = base[Character(letter.uppercased())] else { return nil }
        for accidental in name.dropFirst() {
            if accidental == "#" || accidental == "♯" { pitchClass += 1 }
            if accidental == "b" || accidental == "♭" { pitchClass -= 1 }
        }
        let mode = words.dropFirst().joined(separator: " ").lowercased()
        let minor = ["minor", "aeolian", "dorian", "phrygian", "locrian"].contains { mode.contains($0) }
        return ((pitchClass % 12 + 12) % 12, minor)
    }

    // MARK: Variants

    /// How many variants a genre's drop has.
    public static func variantCount(_ genre: Genre) -> Int {
        switch genre {
        case .dubstep, .riddim, .drumAndBass, .trap, .rock: 3
        default: 2
        }
    }

    /// Which variant this drop plays: always 0 at variety 0, otherwise decided by the seed and the drop's number.
    public static func variant(_ c: DropContext) -> Int {
        let count = variantCount(c.genre)
        guard c.variety > 0, count > 1 else { return 0 }
        var rng = MusicRNG(seed: c.seed ^ StableHash.fnv1a("drop/\(c.genre.rawValue)/\(c.dropNumber)"))
        guard rng.unit() < c.variety else { return 0 }
        return Int(rng.next() % UInt64(count))
    }

    // MARK: Build

    /// The notes of the build at `step`, `heldSteps` after the press (0 is the press). Everything rides the charge, which
    /// stops at 1: the roll and the riser hold where they are until the release.
    public static func build(step: Int, heldSteps: Int, context c: DropContext) -> [ScheduledNote] {
        let charge = charge(heldSteps: heldSteps, secondsPerStep: c.secondsPerStep)
        let every = charge < 0.25 ? 4 : (charge < 0.5 ? 2 : 1)
        var out: [ScheduledNote] = []
        func add(_ instrument: Instrument, _ velocity: Double, _ params: NoteParams = NoteParams()) {
            out.append(ScheduledNote(step: step, instrument: instrument, velocity: min(1, velocity), params: params))
        }
        let style = style(of: c.genre)
        let v = variant(c)
        if heldSteps == 0 {
            // The riser sweeps two octaves up from the tonic's pitch class, so it ends on the tonic.
            let velocity: Double =
                switch style {
                case .gentle: 0.4
                case .synthwave: 0.7
                default: 0.9
                }
            add(
                .riser, velocity,
                NoteParams(pitch: fold(c.keyRoot, 40...51), lengthSteps: riserSteps(secondsPerStep: c.secondsPerStep)))
            if style == .gentle {
                add(.keys, 0.35, NoteParams(pitch: fold(c.keyRoot, 60...71), lengthSteps: 16, voice: 3))
            }
        }
        let rise = 0.3 + 0.65 * charge
        switch style {
        case .gentle:
            if heldSteps % 8 == 4, charge > 0.5 { add(.snare, 0.3 + 0.2 * charge) }
        case .trap:
            if charge > 0.25 { add(.hat, 0.2 + 0.6 * charge, NoteParams(pan: 0.2)) }
            if charge > 0.5, heldSteps % 2 == 0 { add(.snare, rise) }
        case .fourOnFloor, .garage:
            if heldSteps % 4 == 0 { add(.kick, 0.45 + 0.4 * charge) }
            if heldSteps % 8 == 4, charge > 0.4 { add(.snare, rise) }
            if heldSteps % every == 0, charge > 0.6 { add(.snare, rise * 0.7) }
        case .band:
            if heldSteps % every == 0 { add(.snare, rise) }
            if charge > 0.4, heldSteps % 4 == 0 { add(.kick, 0.5 + 0.4 * charge) }
            if c.genre == .funk, charge > 0.25, heldSteps % 4 == 2 { add(.scratch, 0.3 + 0.3 * charge) }
        case .synthwave:
            // A gated snare (short, on every other step) under an arpeggio that climbs the scale as the charge fills.
            if heldSteps % 2 == 0 {
                add(.snare, rise)
                let degree = min(heldSteps / 2, 11)
                add(
                    .keys, 0.3 + 0.35 * charge,
                    NoteParams(pitch: scaleStep(degree, c), lengthSteps: 2, voice: v == 1 ? 0 : 1))
            }
        case .reese:
            if heldSteps % every == 0 { add(.snare, rise) }
            if v >= 1, charge > 0.5, [0, 10].contains(heldSteps % 16) { add(.kick, 0.8) }
        case .halfTime:
            if heldSteps % every == 0 { add(.snare, rise) }
            if v == 2, charge > 0.5, heldSteps % 16 == 12 { add(.laser, 0.4) }
        }
        return out
    }

    // MARK: Drop

    /// The notes of the drop at `step`, `position` steps after it landed (0 is the downbeat). `power` is 0.8 ... 1 (it
    /// grows with the hold) and `charge` the build's final charge: the impact and the extra layers scale with it.
    public static func drop(position: Int, step: Int, power: Double, charge: Double, context c: DropContext)
        -> [ScheduledNote]
    {
        let spb = c.stepsPerBar
        let pos = position % spb
        let bar = position / spb
        let root = bar == 0 ? c.keyRoot : (bar % 2 == 1 ? (c.nextChordRoot ?? c.chordRoot) : c.keyRoot)
        let low = fold(root, 36...47)
        let punch = 0.75 + 0.25 * min(1, max(0, charge))
        var out: [ScheduledNote] = []
        func add(_ instrument: Instrument, _ velocity: Double, _ params: NoteParams = NoteParams()) {
            out.append(
                ScheduledNote(step: step, instrument: instrument, velocity: min(1, velocity * power), params: params))
        }
        func wobble(_ velocity: Double, length: Int, rate: WobbleRate, drive: Double = 0.8, glide: Double? = nil) {
            add(
                .wobble, velocity,
                NoteParams(
                    pitch: low, lengthSteps: length, wobbleRate: rate, drive: drive, voice: c.bassVoice, glide: glide))
        }
        let v = variant(c)
        switch style(of: c.genre) {
        case .halfTime:
            let riddim = c.genre == .riddim
            if pos == 0 {
                add(.impact, punch)
                add(.sub, 0.7, NoteParams(pitch: low - 12, lengthSteps: 16))
            }
            if pos == 0 || pos == 10 || (bar % 2 == 1 && pos == 3) { add(.kick, 1) }
            if pos == 8 { add(.snare, 1) }
            if pos % 2 == 0, pos != 14 { add(.hat, 0.5, NoteParams(pan: 0.2)) }
            if pos == 14 { add(.openHat, 0.6, NoteParams(pan: -0.2)) }
            if riddim {
                // Stuttering wobble hits instead of held notes.
                let hits = v == 1 ? [0, 3, 6, 8, 11, 14] : [0, 2, 3, 6, 8, 10, 11]
                if hits.contains(pos) { wobble(0.95, length: 1, rate: .sixteenth, drive: 0.85) }
            } else if v == 2 {
                if pos == 0 { wobble(1, length: 16, rate: .quarter, glide: 0.4) }
            } else if pos == 0 || pos == 8 {
                wobble(1, length: 8, rate: pos == 0 ? .eighth : .sixteenth)
            }
            if v == 1, pos >= 14 { add(.snare, 0.5 + 0.1 * Double(pos - 14)) }
        case .reese:
            if pos == 0 { add(.impact, punch * 0.9) }
            if pos == 0 || pos == 10 || (v == 2 && pos == 6) { add(.kick, 1) }
            if pos == 4 || pos == 12 { add(.snare, 0.95) }
            if pos % 2 == 0 { add(.hat, 0.4, NoteParams(pan: 0.2)) }
            // A reese: a slow, driven, detuned-sounding wobble that glides between the root and the fifth.
            if pos == 0 { wobble(1, length: 10, rate: .quarter, drive: 0.9, glide: 0.35) }
            if pos == 10 {
                add(
                    .wobble, 0.9,
                    NoteParams(
                        pitch: low + 7, lengthSteps: 6, wobbleRate: .quarter, drive: 0.9, voice: c.bassVoice,
                        glide: 0.35
                    ))
            }
            // The break roll: the last beat of every other bar rolls the snare.
            if pos >= 12, bar % 2 == 1 || v == 1 { add(.snare, 0.4 + 0.15 * Double(pos - 12)) }
        case .trap:
            if pos == 0 { add(.impact, punch * 0.9) }
            if pos == 0 { add(.kick, 1) }
            if pos == 10 || (v == 1 && pos == 6) { add(.kick, 0.9) }
            if pos == 8 { add(.snare, 1) }
            // The 808: a long sub that slides up a fifth.
            if pos == 0 { add(.sub, 1, NoteParams(pitch: low - 12, lengthSteps: 6, glide: 0.5)) }
            if pos == 6 { add(.sub, 0.9, NoteParams(pitch: low - 5, lengthSteps: 10, glide: 0.5)) }
            // Hats every other step, rolling every step into the end of each bar (triplet-ish at the bar's end).
            let roll = pos >= 12 && (bar % 2 == 1 || v >= 1)
            if roll {
                add(.hat, 0.3 + 0.12 * Double(pos - 12), NoteParams(pan: pos % 2 == 0 ? 0.25 : -0.25))
            } else if pos % 2 == 0 {
                add(.hat, 0.45, NoteParams(pan: 0.2))
            }
        case .fourOnFloor:
            let techno = c.genre == .techno
            if pos == 0 { add(.impact, punch) }
            if pos % 4 == 0 { add(.kick, 1) }
            if !techno, pos == 4 || pos == 12 { add(.snare, 0.8) }
            if pos % 4 == 2 { add(.openHat, 0.5, NoteParams(pan: 0.2)) } else if techno, pos % 2 == 1 { add(.hat, 0.3) }
            if pos == 0 { add(.sub, 0.85, NoteParams(pitch: low - 12, lengthSteps: 16)) }
            if techno {
                // A rolling bass between the kicks.
                if pos % 4 != 0 {
                    add(
                        .wobble, 0.6,
                        NoteParams(pitch: low, lengthSteps: 1, wobbleRate: .sixteenth, drive: 0.6, voice: c.bassVoice))
                }
                if v == 1, pos == 14 { add(.laser, 0.5) }
            } else {
                // House: stabs on the chord.
                let stabs = v == 1 ? [0, 8] : [0, 6, 10]
                if stabs.contains(pos) {
                    for tone in chord(root, c) {
                        add(.keys, 0.55, NoteParams(pitch: fold(tone, 60...76), lengthSteps: 2, voice: 1))
                    }
                }
            }
        case .garage:
            if pos == 0 { add(.impact, punch * 0.85) }
            if pos == 0 || pos == 10 { add(.kick, 1) }
            if pos == 4 || pos == 12 { add(.snare, 0.9) }
            if pos % 2 == 0 { add(.hat, 0.4, NoteParams(pan: 0.2, delay: 0.2)) }
            if pos == 0 { add(.sub, 0.9, NoteParams(pitch: low - 12, lengthSteps: 6)) }
            if pos == 6 { add(.sub, 0.8, NoteParams(pitch: low - 12, lengthSteps: 4, glide: 0.2)) }
            if pos == 2 || pos == 11 || (v == 1 && pos == 7) {
                for tone in chord(root, c) {
                    add(.keys, 0.5, NoteParams(pitch: fold(tone, 60...72), lengthSteps: 2, voice: 1))
                }
            }
        case .gentle:
            // No big impact: a soft landing, a warm chord and (variant 0) a tape stop on the downbeat.
            if pos == 0 {
                add(.sub, 0.6, NoteParams(pitch: low - 12, lengthSteps: 16))
                if v == 0 { add(.tapeStop, 0.5) } else { add(.kick, 0.6) }
                for tone in chord(root, c) {
                    add(
                        .keys, 0.45,
                        NoteParams(pitch: fold(tone, 60...76), lengthSteps: 16, voice: c.genre == .lofi ? 2 : 3))
                }
            }
            if pos == 10 || (v == 1 && pos == 0) { add(.kick, 0.5) }
            if pos == 8 { add(.snare, 0.5) }
            if pos % 4 == 2 { add(.hat, 0.25, NoteParams(pan: 0.2, delay: c.genre == .lofi ? 0.25 : 0)) }
        case .band:
            switch c.genre {
            case .folk:
                // A crash, an acoustic strum on every beat and a soft kit.
                if pos == 0 {
                    add(.openHat, 0.9)
                    add(.impact, 0.4)
                }
                if pos % 4 == 0 {
                    add(
                        .strum, 0.85,
                        NoteParams(pitch: low, lengthSteps: 4, formant: pos % 8 == 4 ? 1 : 0, voice: c.minor ? 1 : 0))
                }
                if pos == 0 || pos == 8 { add(.kick, 0.8) }
                if pos == 4 || pos == 12 { add(.snare, 0.6) }
                if pos % 2 == 0 { add(.hat, 0.3) }
                if pos == 0 || pos == 8 { add(.bassGuitar, 0.85, NoteParams(pitch: low - 12, lengthSteps: 6)) }
            case .funk:
                if pos == 0 {
                    add(.openHat, 0.9)
                    add(.impact, 0.4)
                }
                if pos == 0 || pos == 7 || pos == 10 { add(.kick, 0.9) }
                if pos == 4 || pos == 12 { add(.snare, 0.9) }
                if pos % 2 == 0 { add(.hat, 0.35) }
                if [0, 3, 6, 10, 12, 14].contains(pos) {
                    add(.bassGuitar, 0.9, NoteParams(pitch: low - 12, lengthSteps: 2))
                }
                if pos % 4 == 2 { add(.scratch, 0.4) }
                if pos == 0 { add(.electricStrum, 0.8, NoteParams(pitch: low, lengthSteps: 2, drive: 0.5, voice: 4)) }
            default:
                // Rock: a crash and a power chord on the one, then a driving kit under the chord.
                if pos == 0 {
                    add(.openHat, 1)
                    add(.impact, 0.5 + 0.2 * punch)
                }
                if pos == 0 || pos == 8 || (v >= 1 && pos == 10) { add(.kick, 1) }
                if pos == 4 || pos == 12 { add(.snare, 0.95) }
                if pos % 2 == 0 { add(.hat, 0.4, NoteParams(pan: 0.2)) }
                if pos % 4 == 0 || (v == 2 && pos == 6) {
                    add(.electricStrum, 0.9, NoteParams(pitch: low, lengthSteps: 4, drive: 0.8, voice: 4))
                }
                if pos == 0 || pos == 6 || pos == 8 {
                    add(.bassGuitar, 0.95, NoteParams(pitch: low - 12, lengthSteps: 4))
                }
            }
        case .synthwave:
            if pos == 0 { add(.impact, punch * 0.8) }
            if pos % 4 == 0 { add(.kick, 0.95) }
            // The gated snare: a short snare with a closed hat on the backbeat.
            if pos == 4 || pos == 12 {
                add(.snare, 1)
                add(.hat, 0.5)
            }
            if pos % 2 == 0 { add(.sub, 0.6, NoteParams(pitch: low - 12, lengthSteps: 2)) }
            // The arpeggio: the chord's tones, up and back, every other step.
            if pos % 2 == 1 {
                let tones = chord(root, c)
                let index = (pos / 2) % (tones.count * 2 - 2)
                let tone = index < tones.count ? tones[index] : tones[tones.count * 2 - 2 - index]
                add(.keys, 0.5, NoteParams(pitch: fold(tone, 60...84), lengthSteps: 2, voice: v == 1 ? 0 : 1))
            }
        }
        return out
    }

    // MARK: Style and key

    enum Style { case halfTime, reese, trap, fourOnFloor, garage, gentle, band, synthwave }

    static func style(of genre: Genre) -> Style {
        switch genre {
        case .dubstep, .riddim: .halfTime
        case .drumAndBass: .reese
        case .trap: .trap
        case .house, .techno: .fourOnFloor
        case .ukGarage: .garage
        case .chill, .lofi: .gentle
        case .rock, .folk, .funk: .band
        case .synthwave: .synthwave
        }
    }

    /// The key's scale as pitch classes above the tonic (natural minor or major).
    static func scale(_ c: DropContext) -> [Int] { c.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11] }

    /// Scale step `degree` above the tonic (0 is the tonic; 7 is the octave), in the arpeggio's register.
    static func scaleStep(_ degree: Int, _ c: DropContext) -> Int {
        let scale = scale(c)
        return fold(c.keyRoot, 60...71) + scale[degree % 7] + 12 * (degree / 7)
    }

    /// The chord on `root`: its root, a third that stays in the key and its fifth.
    static func chord(_ root: Int, _ c: DropContext) -> [Int] {
        let scale = scale(c)
        let offset = ((root - c.keyRoot) % 12 + 12) % 12
        let third = scale.contains((offset + 3) % 12) ? 3 : 4
        return [root, root + third, root + 7]
    }

    static func fold(_ pitch: Int, _ range: ClosedRange<Int>) -> Int {
        var p = pitch
        while p < range.lowerBound { p += 12 }
        while p > range.upperBound { p -= 12 }
        return p
    }
}
