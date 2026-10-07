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
        for id in ["liquidSplash", "fractalDive", "synthwaveFlyover", "shader-fireworks", "shader-aurora"] {
            XCTAssertTrue(VisualTile.all.contains { $0.id == id }, id)
        }
    }

    func testMashItUpCanLandOnAnyLight() {
        let ids = VisualTile.all.map(\.id)
        var seen = Set<String>()
        for _ in 0..<2000 { seen.insert(SongRecipe.mashUp(lightIDs: ids).lightsID) }
        XCTAssertEqual(seen, Set(ids))
    }
}
