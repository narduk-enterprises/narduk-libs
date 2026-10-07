import Foundation
import NardukMusicCore
import Observation

/// One row of the Beat Lab grid.
enum LabRow: Int, CaseIterable, Identifiable {
    case kick, snare, hat, zap, bass, keys

    var id: Int { rawValue }
    var word: String {
        switch self {
        case .kick: "Kick"
        case .snare: "Snare"
        case .hat: "Hat"
        case .zap: "Zap"
        case .bass: "Bass"
        case .keys: "Keys"
        }
    }
    var emoji: String {
        switch self {
        case .kick: "🦶"
        case .snare: "🥁"
        case .hat: "🎩"
        case .zap: "⚡️"
        case .bass: "🔊"
        case .keys: "🎹"
        }
    }
    /// Bass and keys cells cycle through notes in the key (F minor); the drums are on/off.
    var noteCount: Int {
        switch self {
        case .bass, .keys: 4
        default: 1
        }
    }
    static let bassPitches = [41, 44, 46, 48]  // F, Ab, Bb, C
    static let keyPitches = [65, 68, 72, 75]  // F, Ab, C, Eb

    /// The sounds this row can play; tapping the row's name steps through them.
    var sounds: [String] {
        switch self {
        case .kick: ["Classic", "Boom", "Blast"]
        case .snare: ["Snare", "Scratch", "Laser", "Voice"]
        case .hat: ["Closed", "Open", "Wide"]
        case .zap: ["Laser", "Voice", "Scratch", "Stutter"]
        case .bass: BassSound.allCases.map(\.word)
        case .keys: ["Bell", "Synth", "Piano", "Pad"]
        }
    }
}

/// The step sequencer: 16 steps per row, each cell 0 (off) or a note number 1 ... noteCount. The engine asks for notes
/// ahead of the render position, exactly as it does the conductor's, so every hit is sample-accurate; an edit is heard
/// from the next step not yet scheduled (~0.25 s ahead).
@MainActor @Observable final class BeatLab {
    static let steps = 16
    var grid: [[Int]] = BeatLab.starter
    var speed: Speed = .medium
    /// The sound picked for each row (an index into `LabRow.sounds`).
    var sounds = Array(repeating: 0, count: LabRow.allCases.count)
    /// The key of the Bass and Keys rows (0 = C ... 11 = B; 5 = F, the notes as written).
    var key = 5
    /// The wobble patch for the Bass row's Wobble and Growl sounds; re-drawn when the bass sound changes.
    var bassPatch = 0

    @ObservationIgnored private var cursor = -1
    /// Where the beat is kept between launches (nil: nowhere, for previews).
    @ObservationIgnored private let store: UserDefaults?

    /// What a child built, kept on this device only, so a beat survives closing the app.
    struct Saved: Codable, Equatable {
        var grid: [[Int]]
        var speed: Speed
        var sounds: [Int]
        var key: Int
        var bassPatch: Int
    }
    static let savedKey = "beatLab.saved"

    init(store: UserDefaults? = .standard) {
        self.store = store
        guard let data = store?.data(forKey: Self.savedKey),
            let saved = try? JSONDecoder().decode(Saved.self, from: data)
        else { return }
        restore(saved)
    }

    var saved: Saved { Saved(grid: grid, speed: speed, sounds: sounds, key: key, bassPatch: bassPatch) }

    func save() {
        if let data = try? JSONEncoder().encode(saved) { store?.set(data, forKey: Self.savedKey) }
    }

    /// Takes a saved beat back, ignoring anything a different build's grid shape cannot hold.
    private func restore(_ saved: Saved) {
        let rows = LabRow.allCases
        guard saved.grid.count == rows.count, saved.grid.allSatisfy({ $0.count == Self.steps }),
            saved.sounds.count == rows.count
        else { return }
        grid = zip(rows, saved.grid).map { row, cells in cells.map { min(max($0, 0), row.noteCount) } }
        sounds = zip(rows, saved.sounds).map { row, index in min(max(index, 0), row.sounds.count - 1) }
        speed = saved.speed
        key = min(max(saved.key, 0), 11)
        bassPatch = max(saved.bassPatch, 0)
    }

    var bpm: Double { 112 * speed.scale }

    /// A simple four-on-the-floor starter so it is never silent.
    static let starter: [[Int]] = [
        [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
        [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 2, 0, 0, 3, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]

    /// The last grid the child built by hand, kept through any run of Clear and Random beat so one tap of Undo brings
    /// it back. A square tapped since then makes the new grid the child's, and Undo goes away.
    private(set) var undoGrid: [[Int]]?

    func tap(_ row: LabRow, _ step: Int) {
        grid[row.rawValue][step] = (grid[row.rawValue][step] + 1) % (row.noteCount + 1)
        undoGrid = nil
    }

    func undo() {
        guard let undoGrid else { return }
        grid = undoGrid
        self.undoGrid = nil
    }

    func nextSound(_ row: LabRow) {
        sounds[row.rawValue] = (sounds[row.rawValue] + 1) % row.sounds.count
        if row == .bass { bassPatch = Int.random(in: 0..<48) }
    }

    func soundName(_ row: LabRow) -> String { row.sounds[sounds[row.rawValue] % row.sounds.count] }

    func clear() {
        undoGrid = undoGrid ?? grid
        grid = Array(repeating: Array(repeating: 0, count: Self.steps), count: LabRow.allCases.count)
    }

    func randomize() {
        var g = Array(repeating: Array(repeating: 0, count: Self.steps), count: LabRow.allCases.count)
        for step in 0..<Self.steps {
            if step % 8 == 0 || Double.random(in: 0...1) < 0.15 { g[0][step] = 1 }
            if step % 8 == 4 || (step % 2 == 1 && Double.random(in: 0...1) < 0.08) { g[1][step] = 1 }
            if step % 2 == 0 || Double.random(in: 0...1) < 0.3 { g[2][step] = 1 }
            if Double.random(in: 0...1) < 0.08 { g[3][step] = 1 }
            if Double.random(in: 0...1) < 0.3 { g[4][step] = Int.random(in: 1...4) }
            if step % 4 == 2, Double.random(in: 0...1) < 0.4 { g[5][step] = Int.random(in: 1...4) }
        }
        undoGrid = undoGrid ?? grid
        grid = g
    }

    func restart() { cursor = -1 }

    func notes(through throughStep: Int) -> [ScheduledNote] {
        if throughStep < cursor { cursor = -1 }
        guard throughStep > cursor else { return [] }
        defer { cursor = throughStep }
        var out: [ScheduledNote] = []
        let shift = MusicKey.offset(from: 5, to: key)
        let keyRoot = 65 + shift
        for step in (cursor + 1)...throughStep {
            let pos = step % Self.steps
            for row in LabRow.allCases {
                let value = grid[row.rawValue][pos]
                guard value > 0 else { continue }
                let sound = sounds[row.rawValue] % row.sounds.count
                func add(_ instrument: Instrument, _ velocity: Double, _ params: NoteParams = NoteParams()) {
                    out.append(ScheduledNote(step: step, instrument: instrument, velocity: velocity, params: params))
                }
                switch row {
                case .kick:
                    switch sound {
                    case 0: add(.kick, 0.95)
                    case 1:
                        out += DrumKit.boom.apply(
                            ScheduledNote(step: step, instrument: .kick, velocity: 0.95), keyRoot: keyRoot)
                    default: add(.impact, 0.8)
                    }
                case .snare:
                    switch sound {
                    case 0: add(.snare, 0.85)
                    case 1: add(.scratch, 0.85)
                    case 2: add(.laser, 0.7, NoteParams(pitch: DropPattern.fold(keyRoot + 12, into: 72...83)))
                    default: add(.vox, 0.8, NoteParams(pitch: keyRoot))
                    }
                case .hat:
                    switch sound {
                    case 0: add(.hat, pos % 4 == 0 ? 0.55 : 0.4, NoteParams(pan: 0.2))
                    case 1: add(.openHat, 0.5, NoteParams(pan: 0.2))
                    default: add(.hat, pos % 4 == 0 ? 0.55 : 0.4, NoteParams(pan: pos % 2 == 0 ? -0.7 : 0.7))
                    }
                case .zap:
                    switch sound {
                    case 0: add(.laser, 0.7, NoteParams(pitch: DropPattern.fold(keyRoot + 12, into: 72...83)))
                    case 1: add(.vox, 0.8, NoteParams(pitch: keyRoot))
                    case 2: add(.scratch, 0.8)
                    default: add(.glitch, 0.7, NoteParams(lengthSteps: 2))
                    }
                case .bass:
                    let wobble = ScheduledNote(
                        step: step, instrument: .wobble, velocity: 0.85,
                        params: NoteParams(
                            pitch: LabRow.bassPitches[value - 1] + shift, lengthSteps: 2, wobbleRate: .sixteenth,
                            drive: 0.6))
                    out.append(BassSound.allCases[sound].apply(wobble, patch: bassPatch))
                case .keys:
                    let voice = [KeysVoice.bell, KeysVoice.stab, KeysVoice.electricPiano, KeysVoice.pad][sound]
                    add(
                        .keys, 0.6,
                        NoteParams(
                            pitch: LabRow.keyPitches[value - 1] + shift, lengthSteps: voice == KeysVoice.pad ? 4 : 2,
                            voice: voice))
                }
            }
        }
        return out
    }
}
