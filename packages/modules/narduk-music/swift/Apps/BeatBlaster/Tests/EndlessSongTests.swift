import NardukMusicEngine
import XCTest

@testable import BeatBlaster

/// The song never ends: every window of 8 bars keeps getting notes for over half an hour of simulated play, and the
/// music keeps changing instead of looping one pattern.
@MainActor final class EndlessSongTests: XCTestCase {
    private func run(_ style: BlasterStyle, minutes: Double) -> (windows: Int, silent: Int, distinct: Int) {
        var recipe = SongRecipe(style: style, seed: 12345)
        recipe.band = [.drums, .bass, .keys, .guitar]
        let player = SongPlayer(recipe: recipe, engine: DropEngine())
        let totalSteps = Int(minutes * 60 / player.secondsPerStep)
        let window = 128  // 8 bars of 16ths
        var silent = 0
        var signatures = Set<[Int]>()
        var windows = 0
        var step = 0
        while step < totalSteps {
            let notes = player.notes(through: step + window - 1)
            windows += 1
            if notes.isEmpty { silent += 1 }
            signatures.insert(notes.map { ($0.params.pitch ?? 0) &* 31 &+ ($0.step - step) })
            step += window
        }
        return (windows, silent, signatures.count)
    }

    func testEveryGenreKeepsPlayingForThirtyMinutes() {
        for style in [BlasterStyle.genre(.house), .genre(.dubstep), .guitars] {
            let result = run(style, minutes: 31)
            XCTAssertGreaterThan(result.windows, 90, "\(style.id)")
            XCTAssertEqual(result.silent, 0, "\(style.id) ran out of notes")
            XCTAssertGreaterThan(result.distinct, result.windows / 10, "\(style.id) loops one pattern")
        }
    }

    func testGuitarChaptersChangeButTheFirstStaysTheClassicLoop() {
        XCTAssertEqual(GuitarPart.progression(chapter: 0, seed: 1).map(\.root), [45, 41, 48, 43])
        let chapters = (1..<40).map { GuitarPart.progression(chapter: $0, seed: 99).map(\.root) }
        XCTAssertGreaterThan(Set(chapters).count, 2)
        let first = GuitarPart.notes(in: 0...255, seed: 99, electric: false).map { ($0.step, $0.params.pitch ?? 0) }
            .flatMap { [$0.0, $0.1] }
        let later = GuitarPart.notes(in: 256 * 5...256 * 6 - 1, seed: 99, electric: false).map {
            [$0.step - 256 * 5, $0.params.pitch ?? 0]
        }.flatMap { $0 }
        XCTAssertNotEqual(first, later, "a later chapter plays a different rhythm or lick")
    }
}
