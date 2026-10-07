import XCTest

@testable import BeatBlaster

@MainActor final class SilentTests: XCTestCase {
    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: "silent")
    }

    func testSpeakersAreOnByDefault() {
        UserDefaults.standard.removeObject(forKey: "silent")
        XCTAssertFalse(BlasterAudio().isSilent)
    }

    func testSilentLaunchArgumentMutesTheSpeakers() {
        UserDefaults.standard.set(true, forKey: "silent")
        XCTAssertTrue(BlasterAudio().isSilent)
    }
}
