import XCTest

@testable import BeatBlaster

/// "Mash it up" (Logan's canvas decision, 2026-10-06): the beat from one vibe, the sounds from another, a random
/// light and speed, named from both vibes.
final class MashUpTests: XCTestCase {
    func testTheNameTakesAWordFromEachVibe() {
        XCTAssertEqual(SongRecipe.mashName(beat: .genre(.folk), sound: .genre(.dubstep)), "Wub Campfire")
        XCTAssertEqual(SongRecipe.mashName(beat: .genre(.dubstep), sound: .genre(.lofi)), "Sleepy Monster")
        XCTAssertEqual(SongRecipe.mashName(beat: .guitars, sound: .genre(.techno)), "Laser Star")
    }

    func testEveryMashUsesTwoDifferentVibesAndALightFromTheList() {
        let lights = ["tunnel", "halo", "jellyfish"]
        for _ in 0..<200 {
            let song = SongRecipe.mashUp(lightIDs: lights)
            XCTAssertTrue(lights.contains(song.lightsID))
            let words = song.name.split(separator: " ")
            XCTAssertEqual(words.count, 2, song.name)
            XCTAssertEqual(String(words[1]), song.style.funName.split(separator: " ").last.map(String.init))
            let soundVibes = BlasterStyle.all.filter { $0.funName.hasPrefix(String(words[0])) && $0 != song.style }
            XCTAssertFalse(soundVibes.isEmpty, "the first word comes from another vibe: \(song.name)")
        }
    }

    func testTheSoundsComeFromTheOtherVibe() {
        for style in BlasterStyle.all {
            let sounds = SoundProfile.signature(of: style)
            if style.hasGuitar { XCTAssertNotEqual(sounds.guitar, .auto, style.funName) }
            if style.hasPads { XCTAssertNotEqual(sounds.pads, .auto, style.funName) }
        }
        let dubstep = SoundProfile.signature(of: .genre(.dubstep))
        XCTAssertEqual(dubstep.bass, .wobble)
        XCTAssertEqual(SoundProfile.signature(of: .genre(.ukGarage)).swing, 0.3)
    }

    func testASecondTapAlwaysChangesTheBeat() {
        let playing = SongRecipe(style: .genre(.house))
        for _ in 0..<100 {
            XCTAssertNotEqual(SongRecipe.mashUp(lightIDs: ["tunnel"], after: playing).style, playing.style)
        }
    }

    func testAGuitarOrPadVibeBringsItsPlayerIntoTheBand() {
        for _ in 0..<200 {
            let song = SongRecipe.mashUp(lightIDs: ["tunnel"])
            if song.sounds.guitar != .auto { XCTAssertTrue(song.band.contains(.guitar), song.name) }
            if song.sounds.pads != .auto { XCTAssertTrue(song.band.contains(.pads), song.name) }
            XCTAssertTrue(song.band.isSuperset(of: [.drums, .bass]))
        }
    }
}
