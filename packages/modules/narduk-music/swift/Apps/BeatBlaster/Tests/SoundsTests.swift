import NardukMusicCore
import XCTest

@testable import BeatBlaster

final class SoundsTests: XCTestCase {
    func testEveryInstrumentRowHasSixToEightChoices() {
        for count in [BassSound.allCases.count, KeysSound.allCases.count, DrumKit.allCases.count] {
            XCTAssertTrue((6...8).contains(count), "\(count)")
        }
        XCTAssertGreaterThanOrEqual(GuitarSound.allCases.count, 5)
        XCTAssertGreaterThanOrEqual(PadSound.allCases.count, 5)
    }

    func testEveryBassSoundPlaysDifferently() {
        let note = ScheduledNote(
            step: 0, instrument: .wobble, velocity: 0.9, params: NoteParams(pitch: 40, lengthSteps: 4, voice: 40))
        var seen = Set<String>()
        for sound in BassSound.allCases {
            let out = sound.apply(note, patch: 5)
            seen.insert(
                "\(out.instrument)-\(out.params.voice ?? -1)-\(out.params.drive ?? -1)-\(out.params.formant ?? -1)-\(out.params.lengthSteps)"
            )
        }
        XCTAssertEqual(seen.count, BassSound.allCases.count)
    }

    func testEveryKitChangesTheDrums() {
        let drums = [
            ScheduledNote(step: 1, instrument: .hat, velocity: 0.7),
            ScheduledNote(step: 4, instrument: .snare, velocity: 0.9),
            ScheduledNote(step: 0, instrument: .kick, velocity: 1),
        ]
        var seen = Set<String>()
        for kit in DrumKit.allCases {
            let out = drums.flatMap { kit.apply($0, keyRoot: 60) }
            seen.insert(out.map { "\($0.step)\($0.instrument)\($0.params.delay ?? 0)" }.joined(separator: ","))
        }
        XCTAssertGreaterThanOrEqual(
            seen.count, DrumKit.allCases.count - 1, "kits sound different (Classic matches nothing)")
    }

    func testGuitarAndPadChoicesChangeTheNotes() {
        let strum = ScheduledNote(step: 0, instrument: .strum, velocity: 0.7)
        XCTAssertEqual(GuitarSound.fuzz.apply(strum).instrument, .electricStrum)
        XCTAssertEqual(GuitarSound.fuzz.apply(strum).params.drive, 1)
        XCTAssertEqual(GuitarSound.auto.apply(strum), strum)
        let pad = ScheduledNote(
            step: 0, instrument: .keys, velocity: 0.5, params: NoteParams(pitch: 60, voice: KeysVoice.pad))
        XCTAssertEqual(PadSound.drone.apply(pad).params.voice, KeysVoice.drone)
        XCTAssertEqual(PadSound.shimmer.apply(pad).params.pitch, 72)
        XCTAssertEqual(PadSound.auto.apply(pad), pad)
    }

    func testSongsSavedBeforeTheNewRowsStillDecode() throws {
        let old = #"{"bass":"growl","bassPatch":7,"keys":"bell","keysOctave":1,"drums":"dj","swing":0.15}"#
        let profile = try JSONDecoder().decode(SoundProfile.self, from: Data(old.utf8))
        XCTAssertEqual(profile.bass, .growl)
        XCTAssertEqual(profile.guitar, .auto)
        XCTAssertEqual(profile.pads, .auto)
        let round = try JSONDecoder().decode(SoundProfile.self, from: JSONEncoder().encode(profile))
        XCTAssertEqual(round, profile)
    }
}
