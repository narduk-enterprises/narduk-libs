import NardukMusicCore
import NardukMusicEngine
import XCTest

@testable import BeatBlaster

@MainActor final class EffectsTests: XCTestCase {
    private func player() -> SongPlayer {
        SongPlayer(recipe: SongRecipe(style: .genre(.house), seed: 7), engine: DropEngine())
    }

    func testPadsLandOnTheNextFreeSixteenth() {
        let player = player()
        _ = player.notes(through: 99)
        XCTAssertEqual(player.nextStep, 100)
        for pad in SoundPad.allCases {
            let step = player.trigger(pad)
            XCTAssertEqual(step, 100, "\(pad) is quantized to the next 16th")
            XCTAssertTrue(pad.notes(at: step).allSatisfy { $0.step >= step })
            XCTAssertEqual(pad.notes(at: step).map(\.step).min(), step)
        }
    }

    func testAPadSoundsOnceAndOnlyAtItsStep() {
        let player = player()
        _ = player.notes(through: 49)
        player.trigger(.laser)
        let before = player.notes(through: 49)  // nothing new: the cursor has not moved
        XCTAssertTrue(before.isEmpty)
        let sounded = player.notes(through: 60).filter { $0.instrument == .laser }
        XCTAssertEqual(sounded.map(\.step), SoundPad.laser.notes(at: 50).map(\.step))
        XCTAssertTrue(player.notes(through: 90).filter { $0.instrument == .laser }.isEmpty, "a pad is one-shot")
    }

    func testFilterAndBassBoostReshapeBassNotes() {
        let bass = ScheduledNote(
            step: 0, instrument: .wobble, velocity: 0.6, params: NoteParams(pitch: 36, formant: 0.4))
        var effects = EffectSettings()
        XCTAssertEqual(effects.apply(to: [bass]), [bass], "untouched sliders leave the song as written")
        effects.filter = 1
        effects.bass = 1
        let changed = effects.apply(to: [bass])[0]
        XCTAssertEqual(changed.params.formant, 1)
        XCTAssertGreaterThan(changed.params.drive ?? 0, 0.4)
        XCTAssertGreaterThan(changed.velocity, bass.velocity)
    }

    func testEchoAddsFadingRepeatsToTheMelodyOnly() {
        let key = ScheduledNote(step: 8, instrument: .keys, velocity: 0.8, params: NoteParams(pitch: 60))
        let kick = ScheduledNote(step: 8, instrument: .kick, velocity: 1)
        var effects = EffectSettings()
        effects.echo = 1
        let out = effects.apply(to: [key, kick])
        let repeats = out.filter { $0.instrument == .keys && $0.step > 8 }
        XCTAssertGreaterThanOrEqual(repeats.count, 2)
        XCTAssertEqual(repeats.map(\.step), repeats.map(\.step).sorted())
        XCTAssertGreaterThan(repeats[0].velocity, repeats[1].velocity)
        XCTAssertEqual(out.filter { $0.instrument == .kick }.count, 1, "drums are never echoed")
    }

    func testEverySliderChangesTheNotesTheEngineGetsNext() {
        let player = player()
        _ = player.notes(through: 31)
        let plain = player.notes(through: 95)
        player.effects.echo = 1
        _ = player.notes(through: 127)
        let echoed = player.notes(through: 191)
        XCTAssertNotEqual(plain.count, echoed.count)
    }
}
