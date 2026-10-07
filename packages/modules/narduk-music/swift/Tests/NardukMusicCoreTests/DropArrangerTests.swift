import Foundation
import Testing

@testable import NardukMusicCore

/// The DROP written for the song under it (narduk-libs B8-drops): in key, on the downbeat, deterministic, and varied by
/// seed and variety.
@Suite struct DropArrangerTests {
    static let keys: [(root: Int, minor: Bool)] = [(65, true), (60, false), (69, true), (62, false)]

    /// A context for every genre and key; the chord roots are the subdominant and the dominant, both in the key.
    static func contexts(seed: UInt64 = 0x5EED, variety: Double = 0.75, dropNumber: Int = 0) -> [DropContext] {
        var out: [DropContext] = []
        for genre in Genre.allCases {
            for key in keys {
                out.append(
                    DropContext(
                        genre: genre, keyRoot: key.root, minor: key.minor, chordRoot: key.root + 5,
                        nextChordRoot: key.root + 7, secondsPerStep: 60 / 140 / 4, seed: seed, variety: variety,
                        dropNumber: dropNumber))
            }
        }
        return out
    }

    static func dropNotes(_ c: DropContext, bars: Int = 4, charge: Double = 1) -> [ScheduledNote] {
        (0..<(bars * c.stepsPerBar)).flatMap {
            DropArranger.drop(position: $0, step: 1_000 + $0, power: 1, charge: charge, context: c)
        }
    }

    static func buildNotes(_ c: DropContext, steps: Int = 80) -> [ScheduledNote] {
        (0..<steps).flatMap { DropArranger.build(step: 500 + $0, heldSteps: $0, context: c) }
    }

    /// Instruments whose pitch is a musical note (the drums and the impact ignore it).
    static let pitched: Set<Instrument> = [
        .wobble, .sub, .keys, .strum, .electricStrum, .bassGuitar, .acousticGuitar, .electricGuitar, .riser,
    ]

    @Test func everyPitchedNoteIsInTheSongsKeyForEveryGenre() {
        for c in Self.contexts() {
            let scale = Set(DropArranger.scale(c).map { (c.keyRoot + $0) % 12 })
            for note in Self.dropNotes(c) + Self.buildNotes(c) where Self.pitched.contains(note.instrument) {
                guard let pitch = note.params.pitch else { continue }
                #expect(
                    scale.contains(pitch % 12),
                    "\(c.genre) in \(c.keyRoot) \(c.minor ? "minor" : "major"): \(note.instrument) \(pitch) is out of key"
                )
            }
        }
    }

    @Test func theDropLandsOnTheDownbeatWithAnImpactOrASubOnTheTonic() {
        for c in Self.contexts() {
            let first = DropArranger.drop(position: 0, step: 7, power: 1, charge: 1, context: c)
            #expect(first.allSatisfy { $0.step == 7 })
            let landing = first.filter { $0.instrument == .impact || $0.instrument == .sub }
            #expect(!landing.isEmpty, "\(c.genre) has nothing big on the downbeat")
            for sub in first where sub.instrument == .sub {
                #expect((sub.params.pitch ?? -1) % 12 == c.keyRoot % 12, "\(c.genre)'s landing sub is not the tonic")
            }
            // A genre with a drop-heavy kit hits its kick there too (the gentle ones keep it soft).
            #expect(
                first.contains { $0.instrument == .kick || $0.instrument == .tapeStop || $0.instrument == .openHat })
        }
    }

    @Test func theRiserRisesToTheTonic() {
        for c in Self.contexts() {
            let riser = Self.buildNotes(c).first { $0.instrument == .riser }
            let pitch = riser?.params.pitch ?? -1
            // It sweeps two octaves up from its pitch, so it ends on the same pitch class as the tonic.
            #expect((pitch + 24) % 12 == c.keyRoot % 12, "\(c.genre)'s riser does not end on the tonic")
            #expect(riser?.params.lengthSteps == DropArranger.riserSteps(secondsPerStep: c.secondsPerStep))
        }
    }

    @Test func theSecondBarMovesToTheNextChord() {
        for genre in [Genre.dubstep, .trap, .rock, .drumAndBass] {
            let c = DropContext(
                genre: genre, keyRoot: 65, minor: true, chordRoot: 70, nextChordRoot: 72, secondsPerStep: 0.1,
                variety: 0)
            let bar1 = (16..<32).flatMap { DropArranger.drop(position: $0, step: $0, power: 1, charge: 1, context: c) }
            let bass = bar1.filter { [.wobble, .sub, .bassGuitar, .electricStrum].contains($0.instrument) }
            #expect(bass.contains { ($0.params.pitch ?? -1) % 12 == 72 % 12 })
        }
    }

    @Test func aDropIsDeterministicPerSeed() {
        for (a, b) in zip(Self.contexts(seed: 42), Self.contexts(seed: 42)) {
            #expect(Self.dropNotes(a) == Self.dropNotes(b))
            #expect(Self.buildNotes(a) == Self.buildNotes(b))
        }
    }

    @Test func varietyZeroAlwaysPlaysTheFirstVariantAndHighVarietyReachesTheOthers() {
        for genre in Genre.allCases {
            let count = DropArranger.variantCount(genre)
            var seen: Set<Int> = []
            for seed in 0..<400 as Range<UInt64> {
                let zero = DropContext(
                    genre: genre, keyRoot: 65, minor: true, secondsPerStep: 0.1, seed: seed, variety: 0)
                #expect(DropArranger.variant(zero) == 0)
                let high = DropContext(
                    genre: genre, keyRoot: 65, minor: true, secondsPerStep: 0.1, seed: seed, variety: 1)
                seen.insert(DropArranger.variant(high))
            }
            #expect(seen == Set(0..<count), "\(genre) never reached every variant: \(seen.sorted())")
        }
    }

    @Test func repeatedDropsInOneSongDiffer() {
        var different = 0
        for genre in Genre.allCases {
            let drops = (0..<6).map { number in
                Self.dropNotes(
                    DropContext(
                        genre: genre, keyRoot: 65, minor: true, secondsPerStep: 0.1, seed: 99, variety: 1,
                        dropNumber: number))
            }
            if drops.contains(where: { $0 != drops[0] }) {
                different += 1
            }
        }
        #expect(different >= Genre.allCases.count - 2, "most genres' repeated drops should not repeat exactly")
    }

    @Test func everyGenreHasItsOwnDropStyleBuiltFromItsInstruments() {
        let bassHeavy: [Genre: Set<Instrument>] = [
            .dubstep: [.wobble], .riddim: [.wobble], .drumAndBass: [.wobble], .trap: [.sub, .hat],
            .house: [.keys], .techno: [.wobble], .ukGarage: [.sub, .keys], .chill: [.keys, .sub], .lofi: [.keys, .sub],
            .rock: [.electricStrum, .bassGuitar], .folk: [.strum, .bassGuitar], .funk: [.bassGuitar, .scratch],
            .synthwave: [.keys, .sub],
        ]
        for (genre, expected) in bassHeavy {
            let c = DropContext(genre: genre, keyRoot: 65, minor: true, secondsPerStep: 0.1, variety: 0)
            let used = Set(Self.dropNotes(c).map(\.instrument))
            #expect(expected.isSubset(of: used), "\(genre) drop is missing \(expected.subtracting(used))")
        }
        // The gentle genres do not slam: no impact in their drop.
        for genre in [Genre.chill, .lofi] {
            let c = DropContext(genre: genre, keyRoot: 65, minor: true, secondsPerStep: 0.1, variety: 0)
            #expect(!Self.dropNotes(c).contains { $0.instrument == .impact })
        }
    }

    @Test func intensityScalesWithTheHold() {
        for genre in [Genre.dubstep, .house, .rock] {
            let c = DropContext(genre: genre, keyRoot: 65, minor: true, secondsPerStep: 0.1, variety: 0)
            func impact(_ charge: Double) -> Double {
                DropArranger.drop(position: 0, step: 0, power: 1, charge: charge, context: c)
                    .filter { $0.instrument == .impact }.map(\.velocity).max() ?? 0
            }
            #expect(impact(1) > impact(0), "\(genre)'s impact does not grow with the hold")
            let early = Self.buildNotes(c, steps: 4).filter { $0.instrument == .snare }.map(\.velocity).max() ?? 0
            let late =
                (60..<64).flatMap { DropArranger.build(step: $0, heldSteps: $0, context: c) }
                .filter { $0.instrument == .snare }.map(\.velocity).max() ?? 0
            #expect(late > early)
        }
    }

    @Test func theBuildHoldsFlatOnceFullAndFollowsTheTempo() {
        let c = DropContext(genre: .dubstep, keyRoot: 65, minor: true, secondsPerStep: 0.125, variety: 0)
        let full = Int((DropArranger.fullChargeSeconds / 0.125).rounded())
        let a = DropArranger.build(step: 0, heldSteps: full + 8, context: c)
        let b = DropArranger.build(step: 0, heldSteps: full + 400, context: c)
        #expect(a == b, "the build keeps climbing after the charge is full")
        // A faster song fills its riser in more steps: the build rides the clock, not a fixed step count.
        #expect(DropArranger.riserSteps(secondsPerStep: 0.0625) == 2 * DropArranger.riserSteps(secondsPerStep: 0.125))
    }

    @Test func aTrackKeyNameParsesToATonicAndQuality() throws {
        let cases: [(String, Int, Bool)] = [
            ("F# dorian", 6, true), ("Bb major", 10, false), ("C ionian", 0, false), ("E♭ aeolian", 3, true),
            ("A minor", 9, true), ("D lydian", 2, false),
        ]
        for (name, pitchClass, minor) in cases {
            let key = try #require(DropArranger.parseKey(name), "\(name) did not parse")
            #expect(key.pitchClass == pitchClass && key.minor == minor, "\(name) parsed as \(key)")
        }
        #expect(DropArranger.parseKey("") == nil)
    }
}
