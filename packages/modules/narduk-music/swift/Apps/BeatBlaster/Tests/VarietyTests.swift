import XCTest

@testable import BeatBlaster

final class VarietyTests: XCTestCase {
    func testEverydaySongsUseTheDefaultVariety() {
        let recipe = SongRecipe(style: .genre(.house))
        XCTAssertEqual(recipe.settings.variety, 0.75)
    }

    func testSurpriseMeAsksForTheMostVariety() {
        let surprised = SongRecipe(style: .genre(.house)).surprise()
        XCTAssertGreaterThan(surprised.settings.variety, 0)
        XCTAssertEqual(surprised.settings.variety, 1.0)
    }

    func testSongsSavedBeforeVarietyStillLoad() throws {
        var recipe = SongRecipe(style: .genre(.house))
        recipe.variety = nil
        let data = try JSONEncoder().encode(recipe)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "variety")
        let old = try JSONSerialization.data(withJSONObject: object)
        XCTAssertEqual(try JSONDecoder().decode(SongRecipe.self, from: old).settings.variety, 0.75)
    }
}
