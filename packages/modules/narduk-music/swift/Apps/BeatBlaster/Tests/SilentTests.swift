import XCTest

@testable import BeatBlaster

@MainActor final class SilentTests: XCTestCase {
    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: "silent")
    }

    func testSpeakersAreMutedUnderXCTestWithoutAnyArgument() {
        UserDefaults.standard.removeObject(forKey: "silent")
        XCTAssertTrue(BlasterAudio.shouldMuteSpeakers, "a test run never plays through the speakers")
        XCTAssertTrue(BlasterAudio().isSilent)
    }

    func testTheEngineStillRunsWhileMuted() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        audio.play(SongRecipe(style: .genre(.house)))
        XCTAssertTrue(audio.isRunning)
        XCTAssertTrue(audio.isSilent)
    }

    func testSilentLaunchArgumentMutesTheSpeakers() {
        UserDefaults.standard.set(true, forKey: "silent")
        XCTAssertTrue(BlasterAudio().isSilent)
    }
}
