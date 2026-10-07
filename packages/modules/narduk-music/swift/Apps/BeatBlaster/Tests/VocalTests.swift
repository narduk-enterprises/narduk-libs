import NardukMusicCore
import NardukMusicEngine
import XCTest

@testable import BeatBlaster

/// The sampled female voice as a sound choice and a pad, the STUTTER hold, and the credit CC BY 4.0 asks for.
@MainActor final class VocalTests: XCTestCase {
    private func player(singer: SingerSound) -> SongPlayer {
        var recipe = SongRecipe(style: .genre(.house), seed: 5)
        recipe.sounds.singer = singer
        return SongPlayer(recipe: recipe, engine: DropEngine())
    }

    func testSongsSavedBeforeTheSingerRowStillLoadWithNoSinger() throws {
        let old = #"{"bass":"wobble","bassPatch":0,"keys":"piano","keysOctave":0,"drums":"boom","swing":0}"#
        let profile = try JSONDecoder().decode(SoundProfile.self, from: Data(old.utf8))
        XCTAssertEqual(profile.singer, .off)
        var sung = SoundProfile()
        sung.singer = .oo
        let again = try JSONDecoder().decode(SoundProfile.self, from: JSONEncoder().encode(sung))
        XCTAssertEqual(again.singer, .oo)
    }

    func testTheSingerHoldsOneVowelPerBarInAWomansRange() throws {
        let sung = player(singer: .oh).notes(through: 63).filter { $0.instrument == .vocalSample }
        XCTAssertEqual(sung.map(\.step), [0, 16, 32, 48])
        for note in sung {
            let pitch = try XCTUnwrap(note.params.pitch)
            XCTAssertTrue((60...71).contains(pitch), "pitch \(pitch)")
            let voice = try XCTUnwrap(note.params.voice)
            XCTAssertEqual(voice & 7, VocalVowel.oh.index)
            XCTAssertEqual((voice >> 5) & 3, SampleKind.sustain.index)
        }
    }

    func testNoSingerMeansNoSampledVoice() {
        let notes = player(singer: .off).notes(through: 63)
        XCTAssertFalse(notes.contains { $0.instrument == .vocalSample })
    }

    func testTheVocalPadSingsARealSyllableChop() {
        let notes = SoundPad.vocalChop.notes(at: 40)
        XCTAssertFalse(notes.isEmpty)
        for note in notes {
            XCTAssertEqual(note.instrument, .vocalSample)
            XCTAssertEqual(((note.params.voice ?? 0) >> 5) & 3, SampleKind.chop.index)
        }
        XCTAssertEqual(notes.first?.step, 40)
    }

    func testTheCreditIsTheExactLine() {
        XCTAssertEqual(
            Credits.vocalSet,
            "Vocal samples from VocalSet by Wilkins, Seetharaman, Wahl and Pardo (CC BY 4.0), modified.")
    }

    func testHoldingStutterKeepsCuttingAndLettingGoStops() async throws {
        let audio = BlasterAudio()
        defer { audio.stop() }
        audio.play(SongRecipe(style: .genre(.house), seed: 1))
        audio.setStutter(true)
        try await Task.sleep(for: .milliseconds(900))
        let held = audio.stutterCuts
        XCTAssertGreaterThanOrEqual(held, 1, "a hold sends cuts")
        audio.setStutter(false)
        try await Task.sleep(for: .milliseconds(100))
        let released = audio.stutterCuts
        try await Task.sleep(for: .milliseconds(900))
        XCTAssertEqual(audio.stutterCuts, released, "no more cuts after the release")
    }
}
