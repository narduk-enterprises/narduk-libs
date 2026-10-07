import NardukMusicCore
import NardukMusicEngine
import XCTest

@testable import BeatBlaster

/// The DROP button's sound comes from the library's `DropArranger`, written for the song playing: the player hands it
/// the current genre, key, tempo grid, seed and variety, and plays what it returns for the build and the drop.
@MainActor final class DropArrangerWiringTests: XCTestCase {
    private func player(_ genre: Genre, keyRoot: Int = 62, seed: UInt64 = 99) -> SongPlayer {
        var recipe = SongRecipe(style: .genre(genre), seed: seed)
        recipe.keyRoot = keyRoot
        recipe.mood = .dark
        return SongPlayer(recipe: recipe, engine: DropEngine())
    }

    func testThePlayerCallsTheArrangerWithTheCurrentGenreAndKey() throws {
        for genre in [Genre.dubstep, .house, .trap] {
            let player = player(genre)
            _ = player.notes(through: 31)
            player.pressDrop()
            let context = try XCTUnwrap(player.dropContext)
            XCTAssertEqual(context.genre, genre)
            XCTAssertEqual(context.keyRoot % 12, 62 % 12, "\(genre): the drop is in the song's key")
            XCTAssertTrue(context.minor, "\(genre): a dark mood is a minor key")
            XCTAssertEqual(context.secondsPerStep, player.secondsPerStep, accuracy: 1e-9)
            XCTAssertEqual(context.seed, 99)
            XCTAssertEqual(context.dropNumber, 0)
            let material = try XCTUnwrap(context.material, "\(genre): the song's own notes are captured at the press")
            XCTAssertFalse(material.current.isEmpty, "\(genre): the groove it is playing")
        }
    }

    func testTheBuildIsTheArrangersRiserOnThePressStep() throws {
        let player = player(.dubstep)
        _ = player.notes(through: 31)
        let press = player.nextStep
        player.pressDrop()
        let out = player.notes(through: press + 15)
        XCTAssertTrue(out.contains { $0.step == press && $0.instrument == .riser }, "the riser starts on the press")
        let context = try XCTUnwrap(player.dropContext)
        let expected = DropArranger.build(step: press, heldSteps: 0, context: context)
        XCTAssertTrue(expected.contains { $0.instrument == .riser })
    }

    func testTheDropLandsWithTheArrangersImpactAndTheNextDropIsNumberOne() throws {
        let player = player(.dubstep)
        _ = player.notes(through: 31)
        player.pressDrop()
        _ = player.notes(through: 31 + 64)
        let landing = try XCTUnwrap(player.releaseDrop()).start
        let out = player.notes(through: landing + 31)
        XCTAssertTrue(out.contains { $0.step == landing && $0.instrument == .impact }, "the drop lands on its step")
        player.pressDrop()
        XCTAssertEqual(player.dropContext?.dropNumber, 1, "a repeated drop is told it is the second, so it can differ")
    }

    func testAGuitarSongDropsAsARockBand() throws {
        let player = SongPlayer(recipe: SongRecipe(style: .guitars, seed: 3), engine: DropEngine())
        player.pressDrop()
        XCTAssertEqual(player.dropContext?.genre, .rock)
        XCTAssertNil(
            player.dropContext?.material, "a guitar song has no conductor to read, so it gets the plain groove")
    }

    func testCancellingForgetsTheDrop() {
        let player = player(.house)
        player.pressDrop()
        player.cancelDrop()
        XCTAssertNil(player.dropContext)
    }
}
