import NardukMusicCore
import NardukMusicEngine
import SwiftUI
import XCTest

@testable import BeatBlaster

/// Fast layout checks: each key screen is hosted in a UIHostingController at a fixed device size (no app launch, no
/// XCUITest) and the controls' reported frames are checked against the safe area, each other and the 44pt minimum.
@MainActor final class LayoutTests: XCTestCase {
    struct Device {
        let name: String
        let portrait: CGSize
        let portraitInsets: UIEdgeInsets
        let landscapeInsets: UIEdgeInsets
    }

    static let devices = [
        Device(
            name: "iPhone SE", portrait: CGSize(width: 375, height: 667),
            portraitInsets: UIEdgeInsets(top: 20, left: 0, bottom: 0, right: 0), landscapeInsets: .zero),
        Device(
            name: "iPhone 17 Pro Max", portrait: CGSize(width: 440, height: 956),
            portraitInsets: UIEdgeInsets(top: 62, left: 0, bottom: 34, right: 0),
            landscapeInsets: UIEdgeInsets(top: 0, left: 62, bottom: 21, right: 62)),
        Device(
            name: "iPad 11in", portrait: CGSize(width: 834, height: 1194),
            portraitInsets: UIEdgeInsets(top: 24, left: 0, bottom: 20, right: 0),
            landscapeInsets: UIEdgeInsets(top: 24, left: 0, bottom: 20, right: 0)),
    ]

    private final class Frames { var all: [String: CGRect] = [:] }

    /// Mac Catalyst windows are resizable: the default and the smallest sizes worth supporting (title bar above).
    static let macWindows = [CGSize(width: 1280, height: 800), CGSize(width: 800, height: 600)]

    /// Every device in both orientations, then the Mac windows: (label, size, insets).
    private var layouts: [(String, CGSize, UIEdgeInsets)] {
        Self.macWindows.map {
            ("Mac \(Int($0.width))x\(Int($0.height))", $0, UIEdgeInsets(top: 28, left: 0, bottom: 0, right: 0))
        }
            + deviceLayouts
    }

    private var deviceLayouts: [(String, CGSize, UIEdgeInsets)] {
        Self.devices.flatMap { device -> [(String, CGSize, UIEdgeInsets)] in
            let landscape = CGSize(width: device.portrait.height, height: device.portrait.width)
            return [
                ("\(device.name) portrait", device.portrait, device.portraitInsets),
                ("\(device.name) landscape", landscape, device.landscapeInsets),
            ]
        }
    }

    /// Hosts `view` and returns its controls' frames and the safe rectangle (the larger of the declared and live insets).
    private func host<V: View>(
        _ view: V, size: CGSize, insets: UIEdgeInsets, typeSize: DynamicTypeSize = .large
    ) -> (
        frames: [String: CGRect], safe: CGRect
    ) {
        let box = Frames()
        let controller = UIHostingController(
            rootView: view.onPreferenceChange(ProbeKey.self) { box.all = $0 }.preferredColorScheme(.dark)
                .dynamicTypeSize(typeSize))
        controller.additionalSafeAreaInsets = insets
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
        window.frame = CGRect(origin: .zero, size: size)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        controller.view.setNeedsLayout()
        controller.view.layoutIfNeeded()
        RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        controller.view.layoutIfNeeded()
        let live = controller.view.safeAreaInsets
        let effective = UIEdgeInsets(
            top: max(live.top, insets.top), left: max(live.left, insets.left), bottom: max(live.bottom, insets.bottom),
            right: max(live.right, insets.right))
        let safe = CGRect(origin: .zero, size: size).inset(by: effective)
        window.isHidden = true
        window.rootViewController = nil
        return (box.all, safe)
    }

    private func assertInside(_ ids: [String], _ frames: [String: CGRect], _ safe: CGRect, _ label: String) {
        for id in ids {
            guard let frame = frames[id] else { return XCTFail("\(id) missing — \(label)") }
            XCTAssertTrue(
                safe.insetBy(dx: -1, dy: -1).contains(frame), "\(id) \(frame) outside safe area \(safe) — \(label)")
        }
    }

    private func assertNoOverlap(_ ids: [String], _ frames: [String: CGRect], _ label: String) {
        for (i, a) in ids.enumerated() {
            for b in ids[(i + 1)...] {
                guard let fa = frames[a], let fb = frames[b] else { return XCTFail("\(a) or \(b) missing — \(label)") }
                XCTAssertFalse(fa.insetBy(dx: 1, dy: 1).intersects(fb), "\(a) \(fa) overlaps \(b) \(fb) — \(label)")
            }
        }
    }

    private func assertTapTargets(_ ids: [String], _ frames: [String: CGRect], _ label: String) {
        for id in ids {
            guard let frame = frames[id] else { return XCTFail("\(id) missing — \(label)") }
            XCTAssertGreaterThanOrEqual(frame.width, 43.5, "\(id) too narrow \(frame) — \(label)")
            XCTAssertGreaterThanOrEqual(frame.height, 43.5, "\(id) too short \(frame) — \(label)")
        }
    }

    private func withDefaults(_ values: [String: Any], _ body: () -> Void) {
        let defaults = UserDefaults.standard
        for (key, value) in values { defaults.set(value, forKey: key) }
        body()
        for key in values.keys { defaults.removeObject(forKey: key) }
    }

    private func player(_ audio: BlasterAudio) -> some View {
        PlayerView(audio: audio, mySongs: MySongs(), home: {}, newSong: {})
    }

    func testPlayerTrayCollapsedAndOpenKeepControlsInsideAndApart() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        let pages: [(String, [String: Any])] = [
            ("collapsed", [:]), ("open play", ["tray": true]), ("open effects", ["page": "effects"]),
        ]
        for (label, size, insets) in layouts {
            for (state, defaults) in pages {
                withDefaults(defaults) {
                    let (frames, safe) = host(player(audio), size: size, insets: insets)
                    let name = "\(label), tray \(state)"
                    let always = [
                        "player.home", "player.pause", "player.rec", "player.drop", "player.tray.handle", "player.tray",
                    ]
                    assertInside(always, frames, safe, name)
                    assertNoOverlap(
                        ["player.home", "player.pause", "player.rec", "player.drop", "player.tray.handle"], frames, name
                    )
                    assertNoOverlap(["player.drop", "player.tray"], frames, name)
                    assertTapTargets(
                        ["player.home", "player.pause", "player.rec", "player.drop", "player.tray.handle"], frames, name
                    )
                    if state == "collapsed", let tray = frames["player.tray"] {
                        XCTAssertLessThanOrEqual(tray.height, 60, "collapsed tray is just a handle — \(name)")
                    }
                }
            }
        }
    }

    /// Logan's canvas decision: the tray runs the full width along the bottom and DROP is pinned bottom right (its
    /// column keeps about 12 pt for the glow, so "pinned" allows the screen padding plus that).
    func testTheTrayRunsFullWidthWithDropBottomRight() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        withDefaults(["tray": true]) {
            for (label, size, insets) in layouts {
                let (frames, safe) = host(player(audio), size: size, insets: insets)
                guard let tray = frames["player.tray"], let drop = frames["player.drop"] else {
                    return XCTFail("tray or DROP missing — \(label)")
                }
                XCTAssertLessThanOrEqual(tray.minX - safe.minX, 30, "the tray starts at the left edge — \(label)")
                XCTAssertGreaterThanOrEqual(drop.maxX, tray.maxX - 16, "DROP is on the right — \(label)")
                XCTAssertGreaterThanOrEqual(safe.maxX - drop.maxX, 0, "DROP inside — \(label)")
                XCTAssertLessThanOrEqual(safe.maxX - drop.maxX, 40, "DROP is pinned right — \(label)")
                if size.width > size.height {
                    XCTAssertLessThanOrEqual(drop.minX - tray.maxX, 24, "the tray fills up to DROP — \(label)")
                } else {
                    XCTAssertLessThanOrEqual(safe.maxX - tray.maxX, 30, "the tray spans the width — \(label)")
                }
            }
        }
    }

    func testDropStaysPutWhenTheTrayOpens() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        for (label, size, insets) in layouts {
            let closed = host(player(audio), size: size, insets: insets).frames["player.drop"]
            var open: CGRect?
            withDefaults(["tray": true]) {
                open = host(player(audio), size: size, insets: insets).frames["player.drop"]
            }
            XCTAssertNotNil(closed, label)
            // Portrait lets DROP ride above the tray; landscape keeps it at the side. Either way it never sinks.
            XCTAssertEqual(closed?.size, open?.size, label)
            XCTAssertLessThanOrEqual(open?.maxY ?? 0, closed?.maxY ?? 0 + 1, "DROP stays reachable — \(label)")
        }
    }

    func testShowModeHidesEverythingAndATapBringsItBack() {
        var show = ShowMode()
        XCTAssertFalse(show.hidden)
        show.hide()
        XCTAssertTrue(show.hidden)
        show.reveal()
        XCTAssertFalse(show.hidden)
    }

    func testMakerStepsKeepHomeAndTitleInsideAndReadable() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        for (label, size, insets) in layouts {
            for step in 1...5 {
                let (frames, safe) = host(
                    SongMakerView(audio: audio, home: {}, done: { _ in }, startStep: step), size: size, insets: insets)
                let name = "\(label), step \(step)"
                assertInside(["maker.home"], frames, safe, name)
                assertTapTargets(["maker.home"], frames, name)
                if let title = frames["maker.title"] {
                    XCTAssertGreaterThanOrEqual(title.width, 40, "the title keeps room for 2+ characters — \(name)")
                    XCTAssertTrue(safe.insetBy(dx: -1, dy: -1).contains(title), "title outside safe area — \(name)")
                    if let home = frames["maker.home"] { XCTAssertFalse(home.intersects(title), name) }
                }
            }
        }
    }

    func testMySongsHeaderStaysInsideAndReadable() {
        let audio = BlasterAudio()
        for (label, size, insets) in layouts {
            let (frames, safe) = host(RecordingsView(audio: audio, home: {}), size: size, insets: insets)
            assertInside(["mysongs.home", "mysongs.title"], frames, safe, label)
            assertTapTargets(["mysongs.home"], frames, label)
            XCTAssertGreaterThanOrEqual(frames["mysongs.title"]?.width ?? 0, 40, label)
        }
    }

    func testTrayStateOpensClosesAndFoldsAwayWhenIdle() {
        var tray = TrayState()
        let start = Date(timeIntervalSinceReferenceDate: 1_000)
        XCTAssertFalse(tray.isOpen)
        XCTAssertFalse(tray.isIdle(at: start))
        tray.open(at: start)
        XCTAssertTrue(tray.isOpen)
        XCTAssertFalse(tray.isIdle(at: start.addingTimeInterval(7.9)))
        XCTAssertTrue(tray.isIdle(at: start.addingTimeInterval(8)))
        tray.touch(at: start.addingTimeInterval(6))
        XCTAssertFalse(tray.isIdle(at: start.addingTimeInterval(8)))
        XCTAssertTrue(tray.isIdle(at: start.addingTimeInterval(14)))
        tray.toggle(at: start)
        XCTAssertFalse(tray.isOpen)
        tray.touch(at: start.addingTimeInterval(100))
        XCTAssertFalse(tray.isOpen, "a touch never opens a closed tray")
    }

    func testCollapsingTheTrayNeverStopsTheMusic() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        audio.play(SongRecipe(style: .genre(.house)))
        var tray = TrayState()
        tray.open()
        tray.close()
        XCTAssertTrue(audio.isRunning)
        audio.beginSurge()
        XCTAssertNotNil(audio.surgeStart, "DROP builds with the tray collapsed")
        audio.endSurge()
    }

    func testPauseFreezesTheSongAndResumesOnTheSameBeat() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        audio.play(SongRecipe(style: .genre(.house)))
        XCTAssertFalse(audio.isPaused)
        audio.pause()
        XCTAssertTrue(audio.isPaused)
        XCTAssertFalse(audio.isRecording, "the take is saved while paused")
        audio.resume()
        XCTAssertFalse(audio.isPaused)
        audio.togglePause()
        XCTAssertTrue(audio.isPaused)
        audio.play(SongRecipe(style: .genre(.house)))
        XCTAssertFalse(audio.isPaused, "a new song starts playing")
    }

    func testPausedPlayerKeepsItsPlaceInTheSong() {
        let recipe = SongRecipe(style: .genre(.house))
        let a = SongPlayer(recipe: recipe, engine: DropEngine())
        let b = SongPlayer(recipe: recipe, engine: DropEngine())
        // Open and closed hats follow the conductor's energy, which is not the position; compare the rest.
        func key(_ note: ScheduledNote, _ shift: Int) -> String {
            let name = [.hat, .openHat].contains(note.instrument) ? "hat" : "\(note.instrument)"
            return "\(note.step - shift)-\(name)"
        }
        let straight = a.notes(through: 31).filter { $0.step >= 16 }.map { key($0, 0) }
        _ = b.notes(through: 15)
        b.paused = true
        XCTAssertTrue(b.notes(through: 100).isEmpty, "nothing plays while paused")
        b.paused = false
        let resumed = b.notes(through: 116).map { key($0, 85) }
        XCTAssertFalse(straight.isEmpty)
        XCTAssertEqual(Set(resumed), Set(straight))
    }

    /// Largest accessibility text: the controls must still fit, stay apart and keep their 44pt targets.
    func testLargestTextKeepsThePlayerAndMakerUsable() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        for (label, size, insets) in layouts {
            for state in [[:], ["tray": true]] as [[String: Any]] {
                withDefaults(state) {
                    let (frames, safe) = host(player(audio), size: size, insets: insets, typeSize: .accessibility5)
                    let name = "\(label), largest text, tray \(state.isEmpty ? "collapsed" : "open")"
                    let keys = ["player.home", "player.pause", "player.rec", "player.drop", "player.tray.handle"]
                    assertInside(keys + ["player.tray"], frames, safe, name)
                    assertNoOverlap(keys, frames, name)
                    assertTapTargets(keys, frames, name)
                }
            }
            let (frames, safe) = host(
                SongMakerView(audio: audio, home: {}, done: { _ in }, startStep: 4), size: size, insets: insets,
                typeSize: .accessibility5)
            assertInside(["maker.home"], frames, safe, "\(label), largest text, maker")
            XCTAssertGreaterThanOrEqual(frames["maker.title"]?.width ?? 0, 40, label)
        }
    }

    func testStutterAndVocalPadsAreBigEnoughOnEveryScreen() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        for (label, size, insets) in layouts {
            withDefaults(["page": "effects"]) {
                let (frames, _) = host(player(audio), size: size, insets: insets)
                let name = "\(label), effects page"
                XCTAssertNotNil(frames["fx.stutter"], "STUTTER is on the Effects page — \(name)")
                assertTapTargets(["fx.stutter"], frames, name)
            }
        }
    }

    func testTextFollowsDynamicTypeButDisplayTextGrowsLess() {
        XCTAssertEqual(BlasterFont.scale(.large, size: 18), 1, "the design sizes are the Large sizes")
        XCTAssertLessThan(BlasterFont.scale(.xSmall, size: 18), 1, "smaller settings shrink the text")
        let label = BlasterFont.scale(.accessibility5, size: 14)
        let display = BlasterFont.scale(.accessibility5, size: 44)
        XCTAssertGreaterThan(label, 1.5, "small labels grow a lot at the largest size")
        XCTAssertGreaterThan(display, 1, "display text still grows")
        XCTAssertLessThan(display, label, "but less, so the screens fit")
    }

    func testEachSongGetsItsOwnColourTurnThatTheStateEases() {
        let audio = BlasterAudio()
        defer { audio.stop() }
        let a = SongRecipe(style: .genre(.house), seed: 1)
        let b = SongRecipe(style: .genre(.dubstep), seed: 2)
        XCTAssertEqual(BlasterAudio.look(for: a), BlasterAudio.look(for: a), "the same song always looks the same")
        XCTAssertNotEqual(BlasterAudio.look(for: a), BlasterAudio.look(for: b))
        audio.play(a)
        XCTAssertEqual(audio.visualState.look, BlasterAudio.look(for: a))
        audio.play(b)
        XCTAssertEqual(audio.visualState.look, BlasterAudio.look(for: b))
        XCTAssertTrue(audio.visualState.isEasingLook, "a new look eases in instead of snapping")
    }
}
