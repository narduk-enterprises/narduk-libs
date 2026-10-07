import NardukMusicCore
import NardukMusicEngine
import XCTest

@testable import BeatBlaster

/// Beats a child keeps in Beat Lab, and songs built around them (Logan 2026-10-07: "save beats in our beat lab and
/// then we can use those to bootstrap a song or build a song around").
@MainActor final class BeatSongTests: XCTestCase {
    private var suite: String!
    private var store: UserDefaults!

    override func setUp() {
        suite = "bb-beat-song-\(UUID().uuidString)"
        store = UserDefaults(suiteName: suite)
    }

    override func tearDown() {
        store.removePersistentDomain(forName: suite)
    }

    private func beat() -> BeatLab.Saved {
        let lab = BeatLab(store: nil)
        lab.clear()
        for step in [0, 6, 10] { lab.tap(.kick, step) }
        for step in [4, 12] { lab.tap(.snare, step) }
        for step in stride(from: 0, to: 16, by: 2) { lab.tap(.hat, step) }
        lab.tap(.bass, 0)
        lab.key = 2
        lab.speed = .fast
        return lab.saved
    }

    func testKeptBeatsSurviveClosingTheAppAndKeepingTwiceKeepsOnce() {
        let lab = BeatLab(store: store)
        lab.clear()
        lab.tap(.kick, 3)
        let first = lab.keep()
        XCTAssertEqual(lab.keep(), first, "the same beat is kept once")
        lab.tap(.snare, 4)
        let second = lab.keep()
        XCTAssertEqual(lab.kept.map(\.id), [second.id, first.id], "newest first")

        let reopened = BeatLab(store: store)
        XCTAssertEqual(reopened.kept, lab.kept)
        reopened.forget(second)
        XCTAssertEqual(BeatLab(store: store).kept, [first])
    }

    func testLoadingAKeptBeatPutsItOnTheGridAndUndoBringsTheOldOneBack() {
        let lab = BeatLab(store: nil)
        lab.clear()
        lab.tap(.kick, 1)
        let kept = lab.keep()
        lab.clear()
        lab.tap(.hat, 9)
        let before = lab.grid
        lab.load(kept)
        XCTAssertEqual(lab.saved, kept.beat)
        lab.undo()
        XCTAssertEqual(lab.grid, before)
    }

    func testTheLabAndASongPlayTheSameNotesForABeat() {
        let lab = BeatLab(store: nil)
        lab.randomize()
        let played = lab.notes(through: 31)
        let pure = (0...31).flatMap { BeatLab.notes(of: lab.saved, at: $0) }
        XCTAssertEqual(played, pure)
    }

    func testASongAroundABeatTakesItsSpeedKeyAndSounds() {
        var saved = beat()
        saved.sounds[LabRow.bass.rawValue] = 3
        saved.sounds[LabRow.keys.rawValue] = 2
        saved.bassPatch = 17
        let recipe = SongRecipe.around(saved, style: .genre(.house), name: "Turbo Pickle")
        XCTAssertEqual(recipe.beat, saved)
        XCTAssertEqual(recipe.name, "Turbo Pickle")
        XCTAssertEqual(recipe.speed, .fast)
        XCTAssertEqual(recipe.keyRoot % 12, 2)
        XCTAssertEqual(recipe.sounds.bass, BassSound.allCases[3])
        XCTAssertEqual(recipe.sounds.bassPatch, 17)
        XCTAssertEqual(recipe.sounds.keys, .piano)
        XCTAssertEqual(recipe.sounds.drums, .classic, "the plain kit leaves the beat's drums as built")
        XCTAssertEqual(recipe.style, .genre(.house))
    }

    func testAnOlderSavedSongWithoutABeatStillLoads() throws {
        let recipe = SongRecipe(style: .genre(.trap), name: "Old")
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(recipe)) as? [String: Any])
        json.removeValue(forKey: "beat")
        let decoded = try JSONDecoder().decode(BeatBlaster.SongRecipe.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(decoded.beat)
    }

    func testTheSongPlaysTheBeatsDrumsInPlaceOfItsOwn() {
        // The guitar band has no sections, so the whole beat plays from the first bar.
        let recipe = SongRecipe.around(beat(), style: .guitars, name: "Beat")
        let player = SongPlayer(recipe: recipe, engine: DropEngine())
        let notes = player.notes(through: 63)
        let kicks = Set(notes.filter { $0.instrument == .kick }.map { $0.step % 16 })
        let snares = Set(notes.filter { $0.instrument == .snare }.map { $0.step % 16 })
        XCTAssertEqual(kicks, [0, 6, 10])
        XCTAssertEqual(snares, [4, 12])
    }

    func testTheSectionsShapeTheBeat() {
        XCTAssertFalse(SongPlayer.beatRows(in: .intro).contains(.kick))
        XCTAssertFalse(SongPlayer.beatRows(in: .intro).contains(.bass))
        XCTAssertTrue(SongPlayer.beatRows(in: .breakdown).contains(.snare))
        XCTAssertFalse(SongPlayer.beatRows(in: .breakdown).contains(.kick))
        XCTAssertEqual(SongPlayer.beatRows(in: .drop), Set(LabRow.allCases))
        XCTAssertEqual(SongPlayer.beatRows(in: nil), Set(LabRow.allCases))
    }

    func testTheBeatsNotesStayInTheSongsScale() {
        for minor in [true, false] {
            for pitch in 40...80 {
                let kept = SongPlayer.inScale(pitch, keyRoot: 62, minor: minor)
                let scale: Set<Int> = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]
                XCTAssertTrue(scale.contains(((kept - 62) % 12 + 12) % 12), "\(pitch)")
                XCTAssertLessThanOrEqual(pitch - kept, 1)
            }
        }
    }

    func testTheDropIsBuiltFromTheBeat() throws {
        let saved = beat()
        let player = SongPlayer(
            recipe: SongRecipe.around(saved, style: .genre(.dubstep), name: "Beat"), engine: DropEngine())
        _ = player.notes(through: 31)
        player.pressDrop()
        let material = try XCTUnwrap(player.dropContext?.material)
        let groove = SongPlayer.beatGroove(saved)
        XCTAssertEqual(material.drop.drums, groove.drums)
        XCTAssertEqual(material.drop.bass, groove.bass)
        XCTAssertEqual(Set(material.drop.drums.filter { $0.instrument == .kick }.map(\.step)), [0, 6, 10])
    }
}
