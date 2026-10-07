import XCTest

@testable import BeatBlaster

@MainActor final class BeatLabSaveTests: XCTestCase {
    private var suite: String!
    private var store: UserDefaults!

    override func setUp() {
        suite = "bb-lab-\(UUID().uuidString)"
        store = UserDefaults(suiteName: suite)
    }

    override func tearDown() {
        store.removePersistentDomain(forName: suite)
    }

    func testABeatSurvivesClosingTheApp() {
        let lab = BeatLab(store: store)
        lab.clear()
        lab.tap(.kick, 3)
        lab.tap(.bass, 5)
        lab.tap(.bass, 5)
        lab.nextSound(.snare)
        lab.speed = .fast
        lab.key = 9
        lab.save()

        let reopened = BeatLab(store: store)
        XCTAssertEqual(reopened.saved, lab.saved)
        XCTAssertEqual(reopened.grid[LabRow.kick.rawValue][3], 1)
        XCTAssertEqual(reopened.grid[LabRow.bass.rawValue][5], 2)
        XCTAssertEqual(reopened.soundName(.snare), "Scratch")
    }

    func testNothingSavedStartsOnTheStarterBeat() {
        XCTAssertEqual(BeatLab(store: store).grid, BeatLab.starter)
        XCTAssertEqual(BeatLab(store: nil).grid, BeatLab.starter)
    }

    func testASavedBeatOfTheWrongShapeIsIgnoredAndOddValuesAreClamped() throws {
        var saved = BeatLab(store: nil).saved
        saved.grid.removeLast()
        store.set(try JSONEncoder().encode(saved), forKey: BeatLab.savedKey)
        XCTAssertEqual(BeatLab(store: store).grid, BeatLab.starter, "a grid missing a row is not used")

        saved = BeatLab(store: nil).saved
        saved.grid[LabRow.kick.rawValue][0] = 9
        saved.sounds[LabRow.keys.rawValue] = 99
        saved.key = 40
        store.set(try JSONEncoder().encode(saved), forKey: BeatLab.savedKey)
        let lab = BeatLab(store: store)
        XCTAssertEqual(lab.grid[LabRow.kick.rawValue][0], 1)
        XCTAssertEqual(lab.sounds[LabRow.keys.rawValue], LabRow.keys.sounds.count - 1)
        XCTAssertEqual(lab.key, 11)
    }

    func testUndoBringsBackTheBeatBeforeClearOrRandom() {
        let lab = BeatLab(store: nil)
        lab.tap(.keys, 7)
        let mine = lab.grid
        XCTAssertNil(lab.undoGrid)
        lab.randomize()
        lab.randomize()
        lab.clear()
        lab.undo()
        XCTAssertEqual(lab.grid, mine, "Undo goes back to the beat built by hand")
        XCTAssertNil(lab.undoGrid)

        lab.clear()
        lab.tap(.kick, 0)
        XCTAssertNil(lab.undoGrid, "a tap after Clear makes the new grid the child's")
    }
}
