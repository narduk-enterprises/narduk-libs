import XCTest

@testable import BeatBlaster

/// The lights a child can pick: unique ids (a saved song finds its light again) and names, and every one reachable
/// from Mash it up.
@MainActor final class LightsTests: XCTestCase {
    func testEveryLightHasItsOwnIdAndName() {
        let ids = VisualTile.all.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count, "duplicate light id")
        let names = VisualTile.all.map(\.name)
        XCTAssertEqual(Set(names).count, names.count, "duplicate light name")
        for id in ids { XCTAssertEqual(VisualTile.with(id: id).id, id) }
    }

    func testTheNewLightsAreThere() {
        for id in [
            "liquidSplash", "fractalDive", "synthwaveFlyover", "shader-fireworks", "shader-aurora", "jellyfish",
            "flower", "flameSun", "bioluminescentSea", "blackHole", "geometricChaos", "astraUnbound",
        ] {
            XCTAssertTrue(VisualTile.all.contains { $0.id == id }, id)
        }
    }

    func testMashItUpCanLandOnAnyLight() {
        let ids = VisualTile.all.map(\.id)
        var seen = Set<String>()
        for _ in 0..<2000 { seen.insert(SongRecipe.mashUp(lightIDs: ids).lightsID) }
        XCTAssertEqual(seen, Set(ids))
    }

    func testSwipingStepsThroughEveryLightAndWraps() {
        let audio = BlasterAudio()
        let ids = VisualTile.all.map(\.id)
        audio.update { $0.lightsID = ids[0] }
        audio.stepLights(by: 1)
        XCTAssertEqual(audio.lightsID, ids[1])
        XCTAssertEqual(audio.recipe.lightsID, ids[1], "the song keeps the light it was swiped to")
        audio.stepLights(by: -2)
        XCTAssertEqual(audio.lightsID, ids.last)
        var seen = Set<String>()
        for _ in ids { audio.stepLights(by: 1); seen.insert(audio.lightsID) }
        XCTAssertEqual(seen, Set(ids))
    }

    func testTappingTheLightsCyclesTheirColorsBackToTheSongsOwn() {
        let audio = BlasterAudio()
        let own = audio.visualState.look
        var looks = [own]
        for _ in BlasterAudio.colorPresets {
            audio.shiftColors()
            looks.append(audio.visualState.look)
        }
        XCTAssertEqual(Set(looks.map { "\($0)" }).count, looks.count, "every tap is a new look")
        audio.shiftColors()
        XCTAssertEqual(audio.colorStep, 0)
        XCTAssertEqual(audio.visualState.look, BlasterAudio.look(for: audio.recipe))
    }

    func testTheDropIsAsBigAsTheEnergy() {
        // Chill on the slider gets a gentle lift; the default and Hype get the full drop.
        XCTAssertLessThan(SongPlayer.dropIntensity(energy: 0.2), 0.5)
        XCTAssertGreaterThanOrEqual(SongPlayer.dropIntensity(energy: 0.6), 0.5)
        XCTAssertEqual(SongPlayer.dropIntensity(energy: 1), 1)
        XCTAssertLessThan(SongPlayer.dropIntensity(energy: 0.1), SongPlayer.dropIntensity(energy: 0.5))
    }
}
