import Foundation
import NardukMusicCore
import NardukMusicEngine

/// Writes notes for a `SongRecipe` and hands them to `DropEngine.noteProvider` (adapted from the SoundGallery's
/// SongPlayer). The child steers it live:
/// - `energy` (the Energy slider) is the level the `DropConductor` hears, so it moves the song between intro, build,
///   breakdown and drop and sets how busy each section is; for the guitar band it switches acoustic to electric and
///   brings the drums in.
/// - `band` filters the notes by instrument group and turns on the chord layers (pads and keys through the
///   conductor's comping; guitar as power-chord strums on the bass line's current root).
/// - The DROP button runs `DropMachine` here, in the app, instead of the conductor's `queueDrop()` (which waits for the
///   next 8-bar phrase and does nothing while a drop already plays). Press: from the next unscheduled step the kick and
///   bass drop out and a snare roll speeds up over a riser. Release: the app's drop pattern lands on the next
///   unscheduled 16th, and the song's bar grid is shifted so its bar 1 starts on that hit.
@MainActor final class SongPlayer {
    let recipe: SongRecipe
    var energy = 0.6
    var band: Set<BandPart> {
        didSet { applyComping() }
    }

    var effects = EffectSettings()
    /// Sound-effect pad notes waiting for their step (pads play on the next free 16th).
    private var queuedPads: [ScheduledNote] = []
    private(set) var machine = DropMachine()
    private var conductor: DropConductor?
    private var nextSignal = 0
    private var cursor = -1
    /// Engine step = song step + offset; a drop moves it so the song's bar 1 lands on the hit.
    private var offset = 0
    private var bassRoot = 41
    /// While paused the engine's steps keep passing but the song does not: `offset` absorbs them, so a resume carries on
    /// from the same beat.
    var paused = false
    private weak var engine: DropEngine?

    /// Seconds between the energy signals the conductor hears.
    static let signalInterval = 0.25

    init(recipe: SongRecipe, engine: DropEngine) {
        self.recipe = recipe
        self.band = recipe.band
        self.engine = engine
        resetConductor()
    }

    var secondsPerStep: Double { (engine?.settings ?? recipe.settings).secondsPerStep }

    /// The first step not yet handed to the engine: the soonest a new note can sound.
    var nextStep: Int { cursor + 1 }

    // MARK: DROP

    /// Seconds until the song's next bar line (0 when it is on one): where a swap of sound or vibe should land.
    var secondsToNextBar: Double {
        let songStep = max(0, nextStep - offset)
        return Double((songStep + 15) / 16 * 16 - songStep) * secondsPerStep
    }

    func pressDrop() { machine.press(at: nextStep) }

    /// A sound-effect pad: plays on the next 16th not yet handed to the engine. Returns that step.
    @discardableResult func trigger(_ pad: SoundPad) -> Int {
        let step = nextStep
        queuedPads += pad.notes(at: step)
        return step
    }

    /// Lands the drop; returns its first and end step, or nil when nothing was building.
    func releaseDrop() -> (start: Int, end: Int)? {
        guard let drop = machine.release(at: nextStep, secondsPerStep: secondsPerStep) else { return nil }
        // The song's next bar starts on the hit: skip it forward to its next bar line.
        let songStep = drop.start - offset
        let nextBar = (songStep + 15) / 16 * 16
        offset = drop.start - nextBar
        return drop
    }

    func cancelDrop() { machine.cancel() }

    private var level: Double {
        switch machine.phase {
        case .idle: energy
        case .building, .dropping: 1
        }
    }

    // MARK: Notes

    private func resetConductor() {
        guard case .genre = recipe.style else {
            conductor = nil
            return
        }
        conductor = DropConductor(settings: recipe.settings)
        applyComping()
    }

    private func applyComping() {
        guard var conductor else { return }
        var settings = conductor.settings
        settings.comping = band.contains(.pads) ? .sustain : (band.contains(.keys) ? recipe.comping : nil)
        conductor.settings = settings
        self.conductor = conductor
    }

    func notes(through throughStep: Int) -> [ScheduledNote] {
        if throughStep < cursor {  // the engine restarted from step 0
            cursor = -1
            nextSignal = 0
            offset = 0
            queuedPads.removeAll()
            machine.cancel()
            resetConductor()
        }
        guard throughStep > cursor else { return [] }
        if paused {
            offset += throughStep - cursor
            cursor = throughStep
            queuedPads.removeAll()
            return []
        }
        let range = (cursor + 1)...throughStep
        defer {
            cursor = throughStep
            machine.advance(to: throughStep + 1)
        }

        // The song, on its own (possibly shifted) step grid.
        var song = songNotes(through: throughStep - offset).compactMap { note -> ScheduledNote? in
            var note = note
            note.step += offset
            return range.contains(note.step) ? note : nil
        }
        for note in song.sorted(by: { $0.step < $1.step }) where BandPart.of(note) == .bass {
            bassRoot = note.params.pitch ?? bassRoot
        }
        if case .genre = recipe.style, band.contains(.guitar) { song += guitarLayer(range) }
        song += vocalLayer(range)

        // The DROP layers replace parts of the song step by step.
        let sps = secondsPerStep
        var out: [ScheduledNote] = []
        for note in song {
            let part = BandPart.of(note)
            switch machine.layer(at: note.step, secondsPerStep: sps) {
            case .song: out.append(note)
            case .build: if part != .bass, note.instrument != .kick { out.append(note) }
            case .drop: if part != .bass, part != .drums { out.append(note) }
            }
        }
        for step in range {
            switch machine.layer(at: step, secondsPerStep: sps) {
            case .song: break
            case .build(let every, let intensity, let first):
                if first {
                    out.append(
                        ScheduledNote(
                            step: step, instrument: .riser, velocity: 0.9,
                            params: NoteParams(pitch: 48, lengthSteps: DropMachine.riserSteps(secondsPerStep: sps))))
                }
                if step % every == 0 {
                    out.append(ScheduledNote(step: step, instrument: .snare, velocity: 0.3 + 0.65 * intensity))
                }
            case .drop(let position, let power):
                out += DropPattern.notes(
                    step: step, position: position, power: power, style: recipe.style, root: bassRoot)
            }
        }
        let played = out.filter { note in BandPart.of(note).map(band.contains) ?? true }
        let styled = effects.apply(to: recipe.sounds.apply(played, keyRoot: recipe.keyRoot))
        // Pads always sound: they skip the band filter and the DROP layers.
        let due = queuedPads.filter { range.contains($0.step) }
        queuedPads.removeAll { $0.step <= throughStep }
        return styled + due
    }

    /// The song's own notes up to `songStep` on its own grid.
    private func songNotes(through songStep: Int) -> [ScheduledNote] {
        guard songStep >= 0 else { return [] }
        switch recipe.style {
        case .genre:
            guard var conductor else { return [] }
            let seconds = Double(songStep) * secondsPerStep
            while Double(nextSignal) * Self.signalInterval <= seconds {
                conductor.ingest(MusicSignal(time: Double(nextSignal) * Self.signalInterval, level: level))
                nextSignal += 1
            }
            let notes = conductor.advance(throughStep: songStep)
            engine?.section = conductor.snapshot.section
            engine?.conductor = conductor.snapshot
            self.conductor = conductor
            return notes
        case .guitars:
            let from = max(0, cursor + 1 - offset)
            guard songStep >= from else { return [] }
            // The guitar part is written in A; move it to the recipe's key.
            let lift = MusicKey.offset(from: 9, to: recipe.keyRoot % 12)
            let guitar = GuitarPart.notes(in: from...songStep, seed: recipe.seed, electric: level > 0.6).map { note in
                var note = note
                note.params.pitch = note.params.pitch.map { $0 + lift }
                return note
            }
            return guitar + RockDrums.notes(in: from...songStep, level: level)
        }
    }

    /// The sampled female voice (the Singer row): one held vowel per bar, on the bass line's root folded into a
    /// woman's range, so it sings the song's chord. It rests while the DROP builds and plays.
    func vocalLayer(_ range: ClosedRange<Int>) -> [ScheduledNote] {
        guard let vowel = recipe.sounds.singer.vowel else { return [] }
        let sps = secondsPerStep
        return range.filter { ($0 - offset) % 16 == 0 && machine.layer(at: $0, secondsPerStep: sps) == .song }.map {
            step in
            ScheduledNote(
                step: step, instrument: .vocalSample, velocity: 0.55,
                params: NoteParams(
                    pitch: DropPattern.fold(bassRoot + 12, into: 60...71), lengthSteps: 15, drive: 0.7,
                    voice: NoteParams.sampleVoice(vowel, technique: .vibrato, kind: .sustain)))
        }
    }

    /// Power-chord strums on the bass line's latest root: one per half bar, one per beat when the energy is high.
    private func guitarLayer(_ range: ClosedRange<Int>) -> [ScheduledNote] {
        let every = level > 0.7 ? 4 : 8
        return range.filter { ($0 - offset) % every == 0 }.map { step in
            ScheduledNote(
                step: step, instrument: .electricStrum, velocity: 0.4 + 0.35 * level,
                params: NoteParams(
                    pitch: bassRoot, lengthSteps: every, formant: (step - offset) % 8 == 4 ? 1 : 0, drive: 0.55,
                    voice: 4))
        }
    }
}

/// The app's drop: an impact and a full groove from bar 1, half-time for the bass-music genres and four-on-the-floor
/// for the rest, with the bass on the song's current root.
enum DropPattern {
    static func notes(step: Int, position: Int, power: Double, style: BlasterStyle, root: Int) -> [ScheduledNote] {
        let pos = position % 16
        let bar = position / 16
        var out: [ScheduledNote] = []
        func add(_ instrument: Instrument, _ velocity: Double, _ params: NoteParams = NoteParams()) {
            out.append(
                ScheduledNote(step: step, instrument: instrument, velocity: min(1, velocity * power), params: params))
        }
        let halfTime: Bool
        switch style {
        case .genre(let genre): halfTime = [.dubstep, .riddim, .trap, .drumAndBass].contains(genre)
        case .guitars: halfTime = false
        }
        let low = fold(root, into: 36...47)
        if position == 0 { add(.impact, 1) }
        if halfTime {
            if pos == 0 || pos == 10 || (bar % 2 == 1 && pos == 3) { add(.kick, 1) }
            if pos == 8 { add(.snare, 1) }
            if pos % 2 == 0, pos != 14 { add(.hat, 0.5, NoteParams(pan: 0.2)) }
            if pos == 14 { add(.openHat, 0.6, NoteParams(pan: -0.2)) }
            if pos == 0 || pos == 8 {
                add(
                    .wobble, 1,
                    NoteParams(pitch: low, lengthSteps: 8, wobbleRate: pos == 0 ? .eighth : .sixteenth, drive: 0.8))
            }
            if pos == 0 { add(.sub, 0.7, NoteParams(pitch: low - 12, lengthSteps: 16)) }
        } else {
            if pos % 4 == 0 { add(.kick, 1) }
            if pos == 4 || pos == 12 { add(.snare, 0.9) }
            if pos % 4 == 2 { add(.openHat, 0.45, NoteParams(pan: 0.2)) } else if pos % 2 == 0 { add(.hat, 0.4) }
            if style == .guitars {
                if pos == 0 || pos == 6 || pos == 8 { add(.bassGuitar, 1, NoteParams(pitch: low - 12, lengthSteps: 4)) }
                if pos % 4 == 0 {
                    add(.electricStrum, 0.9, NoteParams(pitch: low, lengthSteps: 4, drive: 0.8, voice: 4))
                }
            } else {
                if pos == 0 { add(.sub, 0.8, NoteParams(pitch: low - 12, lengthSteps: 16)) }
                if pos % 4 == 2 {
                    add(.wobble, 0.85, NoteParams(pitch: low, lengthSteps: 2, wobbleRate: .sixteenth, drive: 0.6))
                }
            }
        }
        return out
    }

    static func fold(_ pitch: Int, into range: ClosedRange<Int>) -> Int {
        var p = pitch
        while p < range.lowerBound { p += 12 }
        while p > range.upperBound { p -= 12 }
        return p
    }
}

/// A part for the guitar instruments (from the SoundGallery) that never ends: it plays in sixteen-bar chapters, and
/// each chapter picks its own chord progression (the first is always Am, F, C, G), strum rhythm and lead licks from
/// the song's seed, so the song keeps changing instead of looping. `electric` picks driven strums and lead over the
/// acoustic ones.
enum GuitarPart {
    static let barSteps = 16
    static let bars = 16
    static let chapterSteps = barSteps * bars
    typealias Chord = (root: Int, minor: Bool)
    static let progressions: [[Chord]] = [
        [(45, true), (41, false), (48, false), (43, false)],  // Am F C G
        [(45, true), (43, false), (41, false), (43, false)],  // Am G F G
        [(45, true), (48, false), (43, false), (41, false)],  // Am C G F
        [(41, false), (48, false), (43, false), (45, true)],  // F C G Am
        [(45, true), (40, true), (41, false), (43, false)],  // Am Em F G
        [(48, false), (43, false), (45, true), (41, false)],  // C G Am F
    ]
    static let strumVariants: [[Int]] = [[0, 8], [0, 6, 12], [0, 4, 8, 14]]

    /// A stable mix of the seed and chapter number.
    static func mix(_ seed: UInt64, _ chapter: Int) -> UInt64 {
        var x = seed &+ UInt64(chapter) &* 0x9E37_79B9_7F4A_7C15
        x = (x ^ (x >> 30)) &* 0xBF58_476D_1CE4_E5B9
        x = (x ^ (x >> 27)) &* 0x94D0_49BB_1331_11EB
        return x ^ (x >> 31)
    }

    static func progression(chapter: Int, seed: UInt64) -> [Chord] {
        chapter == 0 ? progressions[0] : progressions[Int(mix(seed, chapter) % UInt64(progressions.count))]
    }

    static func notes(in steps: ClosedRange<Int>, seed: UInt64, electric: Bool) -> [ScheduledNote] {
        var out: [ScheduledNote] = []
        for step in steps {
            let chapter = step / chapterSteps
            let loopStep = step % chapterSteps
            let bar = loopStep / barSteps
            let inBar = loopStep % barSteps
            let chords = progression(chapter: chapter, seed: seed)
            let chord = chords[bar % chords.count]
            let voice = chord.minor ? 1 : 0
            let strums = strumVariants[chapter == 0 ? 0 : Int(mix(seed, chapter &+ 7919) % UInt64(strumVariants.count))]

            if strums.contains(inBar) {
                out.append(
                    ScheduledNote(
                        step: step, instrument: electric ? .electricStrum : .strum, velocity: inBar == 0 ? 0.9 : 0.7,
                        params: NoteParams(
                            pitch: chord.root, lengthSteps: 8, formant: inBar == 0 ? 0 : 1,
                            drive: electric ? 0.6 : nil, voice: voice)))
            }
            if inBar == 0 || inBar == 10 {
                out.append(
                    ScheduledNote(
                        step: step, instrument: .bassGuitar, velocity: 0.85,
                        params: NoteParams(pitch: chord.root - 12, lengthSteps: 6)))
            }
            if inBar % 2 == 0, inBar >= 4 {
                let tones = [0, 7, 12, 3 + (chord.minor ? 0 : 1), 7, 12, 15, 12]
                let pick = Int((mix(seed, chapter) &+ UInt64(bar * 8 + inBar / 2)) % UInt64(tones.count))
                out.append(
                    ScheduledNote(
                        step: step, instrument: electric ? .electricGuitar : .acousticGuitar, velocity: 0.6,
                        params: NoteParams(
                            pitch: chord.root + 12 + tones[pick], lengthSteps: 3, drive: electric ? 0.6 : nil)))
            }
        }
        return out
    }
}

/// A rock beat under the guitar band that fills in with the energy (nothing below a quarter, hats on every step at
/// the top).
enum RockDrums {
    static func notes(in steps: ClosedRange<Int>, level: Double) -> [ScheduledNote] {
        guard level > 0.25 else { return [] }
        var out: [ScheduledNote] = []
        for step in steps {
            let pos = step % 16
            if pos == 0 || pos == 8 || (level > 0.55 && pos == 10) {
                out.append(ScheduledNote(step: step, instrument: .kick, velocity: 0.85))
            }
            if pos == 4 || pos == 12 {
                out.append(ScheduledNote(step: step, instrument: .snare, velocity: 0.7 + 0.2 * level))
            }
            if pos % (level > 0.75 ? 1 : 2) == 0 {
                out.append(
                    ScheduledNote(
                        step: step, instrument: .hat, velocity: (pos % 4 == 0 ? 0.4 : 0.25) + 0.2 * level,
                        params: NoteParams(pan: 0.2)))
            }
        }
        return out
    }
}
