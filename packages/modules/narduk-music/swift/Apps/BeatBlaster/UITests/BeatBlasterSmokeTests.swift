import XCTest

/// A fast UI smoke run of Beat Blaster on one simulator. Every flow starts at Home and ends back there.
///
/// The app launches with `-silent YES` (speakers muted; meters, visuals and recording stay live, and the app also mutes
/// itself under XCTest) and `-firstRun YES` (one-time hints reset), so a run never plays aloud and always starts from
/// the same state. Controls are found by accessibility identifier (`home.makeSong`, `player.drop`, ...), never by
/// position, so the layout can change without breaking the suite.
@MainActor final class BeatBlasterSmokeTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments += ["-silent", "YES", "-firstRun", "YES"]
        // The first recording can ask for the microphone: allow it so the run never blocks on a system alert.
        addUIInterruptionMonitor(withDescription: "microphone") { alert in
            for label in ["Allow", "OK", "Allow While Using App"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
        app.launch()
    }

    override func tearDownWithError() throws {
        app.terminate()
    }

    // MARK: Helpers

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @discardableResult
    private func require(
        _ id: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        let found = element(id)
        if !found.waitForExistence(timeout: timeout) {
            print("UI TREE when \"\(id)\" was missing:\n\(app.debugDescription)")
            XCTFail("no element with identifier \"\(id)\"", file: file, line: line)
        }
        return found
    }

    private func button(_ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS[c] %@", label)).firstMatch
    }

    private func requireButton(
        _ label: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line
    ) -> XCUIElement {
        let found = button(label)
        XCTAssertTrue(found.waitForExistence(timeout: timeout), "no button \"\(label)\"", file: file, line: line)
        return found
    }

    /// Home, through the guided song maker (the Wub Monster vibe, then Next through every step), to the player.
    private func makeASong() {
        require("home.makeSong").tap()
        require("maker.title")
        // Step 1 only offers Next once a vibe is picked.
        requireButton("Wub Monster").tap()
        var steps = 0
        while !button("Play my song!").exists, steps < 8 {
            let next = requireButton("Next")
            next.tap()
            steps += 1
        }
        requireButton("Play my song!").tap()
        require("player.root")
    }

    private func goHomeFromPlayer() {
        require("player.home").tap()
        require("home.makeSong")
    }

    // MARK: Tests

    /// Home -> Make a Song -> player -> open the controls tray -> DROP press and release -> Home.
    func testMakeASongPlayDropAndGoHome() {
        require("home.makeSong")
        makeASong()

        require("player.tray").tap()
        let tab = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH %@", "player.tray.tab.")).firstMatch
        XCTAssertTrue(tab.waitForExistence(timeout: 10), "the controls tray did not open (no player.tray.tab.*)")

        let drop = require("player.drop")
        drop.press(forDuration: 0.6)
        XCTAssertTrue(element("player.drop").exists, "DROP is gone after it was released")
        XCTAssertTrue(element("player.root").exists, "the player vanished after DROP")

        goHomeFromPlayer()
    }

    /// Record a few seconds in the player, then find the song in My Songs, rename it and see the share sheet.
    func testRecordSaveRenameAndShareFromMySongs() {
        makeASong()

        // The player starts a take by itself: let it run a moment, then stop and save it from the REC badge.
        let rec = require("player.rec")
        XCTAssertTrue(rec.label.contains("Recording"), "REC badge label: \(rec.label)")
        Thread.sleep(forTimeInterval: 3)
        rec.tap()
        XCTAssertTrue(require("player.rec").label.contains("Start recording"), "REC badge did not go idle")
        goHomeFromPlayer()

        let mySongs = require("home.mySongs", timeout: 15)
        mySongs.tap()
        let row = require("mysongs.row")

        let rename = require("mysongs.rename")
        rename.tap()
        let field = require("mysongs.renameField")
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
        field.typeText("Smoke Test")
        requireButton("Save").tap()
        XCTAssertTrue(
            app.staticTexts["Smoke Test"].waitForExistence(timeout: 6), "the row did not take its new name")
        XCTAssertTrue(row.exists)

        require("mysongs.share").tap()
        let sheet = app.otherElements["ActivityListView"]
        XCTAssertTrue(
            sheet.waitForExistence(timeout: 8) || app.sheets.firstMatch.waitForExistence(timeout: 2)
                || app.navigationBars["UIActivityContentView"].exists,
            "the share sheet did not appear")
        // Dismiss the sheet by tapping above it, then leave My Songs.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.05)).tap()

        require("mysongs.home").tap()
        require("home.makeSong")
    }
}
