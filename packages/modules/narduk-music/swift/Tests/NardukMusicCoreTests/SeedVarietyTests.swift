import Foundation
import Testing

@testable import NardukMusicCore

/// A new seed should be a different song, not a reshuffle (narduk-libs#1617). Each test writes tracks for many
/// seeds of one genre and measures how far apart they are on the features a listener hears.
@Suite struct SeedVarietyTests {
    static let seeds: [UInt64] = (1...16).map { $0 &* 0x1F3D_5B79 &+ 0x5EED }

    static func tracks(_ genre: Genre, variety: Double) -> [Track] {
        seeds.map { seed in
            let settings = SongSettings.varied(genre: genre, seed: seed, variety: variety)
            return TrackGenerator.make(
                number: 1, genre: genre, character: .steady, sessionSeed: seed, bpm: variety > 0 ? settings.bpm : 140,
                topApp: nil, previous: nil, variety: variety)
        }
    }

    /// 0 (the same song) ... 1: the mean of key, mode, progression, hook and tempo differences.
    static func distance(_ a: Track, _ b: Track, genre: Genre) -> Double {
        let range = genre.tempoRange
        let tempo = min(1, abs(a.bpm - b.bpm) / max(1, range.upperBound - range.lowerBound))
        let features: [Double] = [
            a.keyRoot % 12 == b.keyRoot % 12 ? 0 : 1,
            a.mode == b.mode ? 0 : 1,
            a.progression == b.progression ? 0 : 1,
            a.hook.distance(to: b.hook),
            tempo,
        ]
        return features.reduce(0, +) / Double(features.count)
    }

    static func meanDistance(_ tracks: [Track], genre: Genre) -> Double {
        var total = 0.0
        var pairs = 0
        for i in tracks.indices {
            for j in tracks.indices where j > i {
                total += distance(tracks[i], tracks[j], genre: genre)
                pairs += 1
            }
        }
        return total / Double(pairs)
    }

    /// The stated threshold: seeds of a genre sit at least this far apart on average (the banked songs are far
    /// below it once drums and timbre join the features), and well past where variety 0 leaves them.
    static let threshold = 0.65
    static let gain = 0.05

    @Test(arguments: Genre.allCases) func seedsSoundDifferent(genre: Genre) {
        let banked = Self.meanDistance(Self.tracks(genre, variety: 0), genre: genre)
        let varied = Self.meanDistance(Self.tracks(genre, variety: 0.75), genre: genre)
        #expect(varied >= Self.threshold, "\(genre.rawValue): mean seed distance \(varied)")
        #expect(varied >= banked + Self.gain, "\(genre.rawValue): \(varied) against banked \(banked)")
    }

    @Test(arguments: Genre.allCases) func progressionsAreNewAndWellFormed(genre: Genre) {
        let banked = Set(Self.tracks(genre, variety: 0).map(\.progression))
        let varied = Self.tracks(genre, variety: 1)
        for track in varied {
            #expect(track.progression.count == 8)
            #expect(track.progression.allSatisfy { (0...6).contains($0) })
        }
        let distinct = Set(varied.map(\.progression))
        #expect(distinct.count >= 10, "\(genre.rawValue): \(distinct.count) distinct progressions in 16 seeds")
        #expect(distinct.count > banked.count, "\(genre.rawValue): \(distinct.count) against \(banked.count) banked")
    }

    @Test(arguments: Genre.allCases) func varietyZeroIsTheBankedSong(genre: Genre) {
        for seed in Self.seeds.prefix(4) {
            let plain = TrackGenerator.make(
                number: 2, genre: genre, character: .busy, sessionSeed: seed, bpm: 120, topApp: nil, previous: nil)
            let zero = TrackGenerator.make(
                number: 2, genre: genre, character: .busy, sessionSeed: seed, bpm: 120, topApp: nil, previous: nil,
                variety: 0)
            #expect(plain == zero)
        }
    }

    @Test func temposStayInsideTheGenre() {
        for genre in Genre.allCases {
            for seed in Self.seeds {
                let bpm = SongSettings.varied(genre: genre, seed: seed).bpm
                #expect(genre.tempoRange.contains(bpm), "\(genre.rawValue) \(bpm)")
            }
            let tempos = Set(Self.seeds.map { SongSettings.varied(genre: genre, seed: $0).bpm })
            #expect(tempos.count >= 5, "\(genre.rawValue) \(tempos.count) distinct tempos")
        }
    }

    @Test func settingsFromBeforeVarietyDecodeAsZero() throws {
        var json = try #require(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(SongSettings(genre: .house))) as? [String: Any])
        #expect(json.removeValue(forKey: "variety") != nil)
        let old = try JSONSerialization.data(withJSONObject: json)
        #expect(try JSONDecoder().decode(SongSettings.self, from: old).variety == 0)
        let round = try JSONDecoder().decode(
            SongSettings.self, from: JSONEncoder().encode(SongSettings(variety: 0.4)))
        #expect(round.variety == 0.4)
    }
}
