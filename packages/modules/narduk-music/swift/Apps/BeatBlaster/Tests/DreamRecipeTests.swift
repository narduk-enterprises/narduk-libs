import NardukMusicCore
import XCTest

@testable import BeatBlaster

/// Dream a Song builds the library's `SongRecipe`, and the app's song comes out of it.
final class DreamRecipeTests: XCTestCase {
    func testADreamBecomesAValidLibraryRecipe() {
        let song = Dreamer.keywordDream("space dragons")
        let recipe = song.recipe
        XCTAssertEqual(song.style, .genre(.synthwave))
        XCTAssertEqual(recipe.genre, .synthwave)
        XCTAssertEqual(recipe.title, song.title)
        XCTAssertEqual(recipe.seed, song.seed)
        XCTAssertEqual(recipe, recipe.validated())
        XCTAssertFalse(recipe.parts.isEmpty)
        let decoded = try? JSONDecoder().decode(NardukMusicCore.SongRecipe.self, from: JSONEncoder().encode(recipe))
        XCTAssertEqual(decoded, recipe)
    }

    func testTheAppSongPlaysTheRecipesSettings() {
        for idea in ["space dragons", "race car", "rainy day", "guitar band", "zzz"] {
            let song = Dreamer.keywordDream(idea)
            let recipe = song.recipe
            let blaster = SongRecipe(from: recipe, style: song.style)
            let wanted = recipe.settings()
            XCTAssertEqual(blaster.name, recipe.title, idea)
            XCTAssertEqual(blaster.settings.seed, wanted.seed, idea)
            XCTAssertEqual(blaster.settings.keyRoot, wanted.keyRoot, idea)
            XCTAssertEqual(blaster.settings.bpm, wanted.bpm, accuracy: 1e-9, idea)
        }
    }

    func testAFastDreamPicksTheFastSpeed() {
        let song = Dreamer.keywordDream("race car")
        XCTAssertEqual(SongRecipe(from: song.recipe, style: song.style).speed, .fast)
    }

    func testTheRecipesChordFeelAndModeCarryOver() {
        var recipe = NardukMusicCore.SongRecipe(title: "Test", genre: .house, mode: .lydian, comping: .stabs)
        recipe.voicing = .drop2
        let blaster = SongRecipe(from: recipe, style: .genre(.house))
        XCTAssertEqual(blaster.comping, .stabs)
        XCTAssertEqual(blaster.voicing, .drop2)
        XCTAssertEqual(blaster.settings.mode, .lydian)
    }
}
