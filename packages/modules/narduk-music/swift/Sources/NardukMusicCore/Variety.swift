import Foundation

// Seeded variety (narduk-libs#1617). The genre banks hold a handful of hand-written progressions, hook rhythms and
// drum kits, so two seeds of one genre mostly reshuffle the same material. These generators write new material from
// a per-genre grammar instead. Every draw comes from a stream derived from the track's seed and an axis name, never
// from the track's own RNG, so the original draw order (and with `SongSettings.variety == 0`, every note) is intact.

enum Variety {
    /// The stream for one axis of one track: a pure function of the track seed and the axis name.
    static func stream(_ track: Track, _ axis: String) -> MusicRNG {
        MusicRNG(seed: track.seed ^ StableHash.fnv1a("variety/" + axis))
    }

    /// Whether an axis draws generated material for this track: `variety` is the probability, decided per axis so
    /// a song may take generated chords over a banked drum kit.
    static func uses(_ axis: String, _ track: Track, variety: Double) -> Bool {
        guard variety > 0 else { return false }
        var gate = stream(track, "gate/" + axis)
        return gate.unit() < variety
    }

    /// Replaces the axes the generators cover on a freshly written track.
    static func apply(to track: inout Track, variety: Double, previous: Track?) {
        if uses("progression", track, variety: variety) {
            var rng = stream(track, "progression")
            var made = progression(genre: track.genre, mode: track.mode, rng: &rng)
            var attempts = 0
            while made == previous?.progression, attempts < 4 {
                made = progression(genre: track.genre, mode: track.mode, rng: &rng)
                attempts += 1
            }
            track.progression = made
        }
        if uses("motif", track, variety: variety) {
            var rng = stream(track, "motif")
            let rhythm = motifRhythm(genre: track.genre, rng: &rng)
            track.hook = TrackGenerator.hook(genre: track.genre, character: track.character, rhythm: rhythm, rng: &rng)
            track.answer = TrackGenerator.answer(to: track.hook, genre: track.genre)
            track.ending = TrackGenerator.ending(of: track.hook, genre: track.genre)
        }
    }

    // MARK: Progressions

    /// How a genre moves between chords: a weight per scale degree, and the shapes its eight bars may take.
    private struct Palette {
        var weights: [Double]  // degrees 0 ... 6
        var shapes: [Shape]
        var home: Double  // the chance the first chord is the tonic
    }

    /// Eight bars as indices into the chords drawn for the song.
    private struct Shape {
        var bars: [Int]
        var weight: Double
        var chords: Int { (bars.max() ?? 0) + 1 }
    }

    // Two-bar chords keep a two-bar hook whole; one-bar and four-bar chords change the song's harmonic rhythm.
    private static let twoBar = Shape(bars: [0, 0, 1, 1, 2, 2, 3, 3], weight: 3)
    private static let twoBarReturn = Shape(bars: [0, 0, 1, 1, 0, 0, 2, 2], weight: 2)
    private static let twoBarThree = Shape(bars: [0, 0, 1, 1, 2, 2, 2, 2], weight: 1.5)
    private static let fourBar = Shape(bars: [0, 0, 0, 0, 1, 1, 1, 1], weight: 1.5)
    private static let vamp = Shape(bars: [0, 0, 0, 0, 0, 0, 1, 1], weight: 1)
    private static let vampTurn = Shape(bars: [0, 0, 0, 0, 1, 1, 0, 0], weight: 1)
    private static let oneBar = Shape(bars: [0, 1, 2, 3, 0, 1, 2, 3], weight: 1.5)
    private static let oneBarPair = Shape(bars: [0, 1, 0, 2, 0, 1, 0, 3], weight: 1)

    private static func palette(_ genre: Genre) -> Palette {
        let all = [twoBar, twoBarReturn, twoBarThree, fourBar, oneBar, oneBarPair]
        let hookOnBass = [twoBar, twoBarReturn, twoBarThree, fourBar, vamp, vampTurn]
        switch genre {
        case .dubstep, .trap, .drumAndBass:
            return Palette(weights: [1, 0.15, 0.5, 0.7, 0.5, 1, 0.9], shapes: hookOnBass, home: 0.85)
        case .riddim:
            return Palette(weights: [1, 0.3, 0.2, 0.4, 0.5, 0.8, 0.8], shapes: [vamp, vampTurn, fourBar, twoBarReturn, twoBarThree], home: 0.95)
        case .techno:
            return Palette(weights: [1, 0.2, 0.2, 0.3, 0.3, 0.6, 0.7], shapes: [vamp, vampTurn, fourBar, twoBar], home: 0.95)
        case .house, .chill, .ukGarage, .lofi:
            return Palette(weights: [1, 0.7, 0.5, 0.8, 0.8, 0.9, 0.3], shapes: all, home: 0.7)
        case .synthwave:
            return Palette(weights: [1, 0.1, 0.8, 0.5, 0.4, 1, 1], shapes: all, home: 0.75)
        case .rock:
            return Palette(weights: [1, 0.2, 0.3, 0.9, 0.8, 0.5, 0.9], shapes: all, home: 0.85)
        case .folk:
            return Palette(weights: [1, 0.5, 0.15, 0.9, 1, 0.7, 0.05], shapes: [twoBar, twoBarReturn, oneBar, fourBar], home: 0.9)
        case .funk:
            return Palette(weights: [1, 0.7, 0.2, 0.9, 0.6, 0.3, 0.4], shapes: [vamp, vampTurn, fourBar, twoBarReturn, oneBarPair], home: 0.95)
        }
    }

    /// A progression for the genre: a shape, then distinct chords drawn by the genre's weights. In a major mode the
    /// supertonic and leading-tone chords stay rare, since they are minor and diminished there.
    static func progression(genre: Genre, mode: Mode, rng: inout MusicRNG) -> [Int] {
        let palette = palette(genre)
        var weights = palette.weights
        if mode.isMajorQuality {
            weights[6] *= 0.15
            weights[2] *= 0.7
        }
        let shape = pick(palette.shapes, weights: palette.shapes.map(\.weight), rng: &rng)
        var chords: [Int] = []
        for slot in 0..<shape.chords {
            if slot == 0 {
                chords.append(rng.unit() < palette.home ? 0 : pick(Array(0...6), weights: weights, rng: &rng))
                continue
            }
            var available = Array(0...6).filter { !chords.contains($0) }
            if available.isEmpty { available = Array(0...6) }
            chords.append(pick(available, weights: available.map { weights[$0] }, rng: &rng))
        }
        return shape.bars.map { chords[$0] }
    }

    // MARK: Motifs

    /// What a genre's hook looks like on the two-bar, 32-step grid.
    private struct MotifProfile {
        var notes: ClosedRange<Int>
        /// The chance a step lands on each kind of position: on the beat, an 8th, a 16th.
        var beat: Double
        var eighth: Double
        var sixteenth: Double
        /// Note length: the longest a note may ring, and the shortest.
        var longest: Int
        var shortest: Int
        /// Triplet feel: positions on a 3-step grid (riddim's hook leans on them).
        var triplet = false
    }

    private static func motifProfile(_ genre: Genre) -> MotifProfile {
        switch genre {
        case .dubstep: MotifProfile(notes: 6...9, beat: 1, eighth: 0.7, sixteenth: 0.3, longest: 8, shortest: 2)
        case .riddim:
            MotifProfile(notes: 5...8, beat: 1, eighth: 0.6, sixteenth: 0.15, longest: 6, shortest: 2, triplet: true)
        case .drumAndBass: MotifProfile(notes: 6...10, beat: 1, eighth: 0.8, sixteenth: 0.5, longest: 6, shortest: 1)
        case .trap: MotifProfile(notes: 5...8, beat: 1, eighth: 0.5, sixteenth: 0.3, longest: 8, shortest: 2)
        case .house: MotifProfile(notes: 6...10, beat: 0.6, eighth: 1, sixteenth: 0.3, longest: 3, shortest: 1)
        case .chill: MotifProfile(notes: 4...7, beat: 1, eighth: 0.6, sixteenth: 0.2, longest: 10, shortest: 2)
        case .techno: MotifProfile(notes: 6...10, beat: 0.8, eighth: 1, sixteenth: 0.5, longest: 3, shortest: 1)
        case .ukGarage: MotifProfile(notes: 6...9, beat: 0.8, eighth: 0.9, sixteenth: 0.6, longest: 4, shortest: 1)
        case .synthwave: MotifProfile(notes: 5...8, beat: 1, eighth: 0.8, sixteenth: 0.2, longest: 8, shortest: 2)
        case .lofi: MotifProfile(notes: 4...7, beat: 0.9, eighth: 0.5, sixteenth: 0.4, longest: 8, shortest: 2)
        case .rock: MotifProfile(notes: 6...10, beat: 1, eighth: 0.9, sixteenth: 0.2, longest: 8, shortest: 1)
        case .folk: MotifProfile(notes: 6...9, beat: 1, eighth: 0.8, sixteenth: 0.15, longest: 6, shortest: 2)
        case .funk: MotifProfile(notes: 8...12, beat: 0.5, eighth: 0.7, sixteenth: 1, longest: 3, shortest: 1)
        }
    }

    /// A hook rhythm as the flat (position, length) pairs the bank uses: a handful of positions drawn by the genre's
    /// weights, always opening the first bar and answering in the second, each note ringing into the next.
    static func motifRhythm(genre: Genre, rng: inout MusicRNG) -> [Int] {
        let profile = motifProfile(genre)
        let count = profile.notes.lowerBound + Int(rng.next() % UInt64(profile.notes.count))
        func weight(_ pos: Int) -> Double {
            if profile.triplet { return pos % 3 == 0 ? 1 : pos % 2 == 0 ? 0.2 : 0.05 }
            if pos % 4 == 0 { return profile.beat }
            if pos % 2 == 0 { return profile.eighth }
            return profile.sixteenth
        }
        var chosen: Set<Int> = [0, 16]
        var candidates = Array(1..<32).filter { $0 != 16 }
        while chosen.count < count, !candidates.isEmpty {
            // Each bar gets at least three notes, so the hook has a contour in both of its bars.
            let sparse = [0, 16].first { bar in chosen.filter { $0 >= bar && $0 < bar + 16 }.count < 3 }
            let pool = sparse.map { bar in candidates.filter { $0 >= bar && $0 < bar + 16 } } ?? candidates
            let pos = pick(pool, weights: pool.map(weight), rng: &rng)
            chosen.insert(pos)
            candidates.removeAll { $0 == pos }
        }
        let positions = chosen.sorted()
        var flat: [Int] = []
        for (index, pos) in positions.enumerated() {
            let next = index + 1 < positions.count ? positions[index + 1] : 32
            let room = next - pos
            // A note rings to the next one, up to the genre's longest, but may stop short for air.
            var length = min(room, profile.longest)
            if length > profile.shortest, rng.unit() < 0.35 { length = max(profile.shortest, length - 1 - Int(rng.next() % 3)) }
            flat += [pos, max(1, length)]
        }
        return flat
    }

    // MARK: Helpers

    /// A weighted pick; a zero total falls back to the first item.
    static func pick<T>(_ items: [T], weights: [Double], rng: inout MusicRNG) -> T {
        let total = weights.reduce(0, +)
        guard total > 0 else { return items[0] }
        var roll = rng.unit() * total
        for (item, weight) in zip(items, weights) {
            roll -= weight
            if roll < 0 { return item }
        }
        return items[items.count - 1]
    }
}

extension Genre {
    /// The tempos the genre lives in (bpm).
    public var tempoRange: ClosedRange<Double> { TrackGenerator.tempoRange(self) }
}

extension SongSettings {
    /// Settings for a song of `genre` whose tempo, key and mode come from `seed` too (narduk-libs#1617): the
    /// default `bpm` is one number per genre, so two seeds otherwise start at the same tempo.
    public static func varied(genre: Genre, seed: UInt64, variety: Double = 0.75) -> SongSettings {
        var rng = MusicRNG(seed: seed ^ StableHash.fnv1a("variety/tempo/" + genre.rawValue))
        let range = genre.tempoRange
        var settings = SongSettings(genre: genre, seed: seed, variety: variety)
        settings.bpm = (range.lowerBound + rng.unit() * (range.upperBound - range.lowerBound)).rounded()
        return settings
    }
}
