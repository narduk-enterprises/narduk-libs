import XCTest

@testable import BeatBlaster

/// The DROP button's state machine: the build starts on the press step, the drop lands on the release step (never
/// later), holds scale the build and the drop, and repeated presses never stack.
final class DropMachineTests: XCTestCase {
    let sps = 60.0 / 140 / 4  // 140 BPM sixteenths

    func testIdlePlaysTheSong() {
        XCTAssertEqual(DropMachine().layer(at: 10, secondsPerStep: sps), .song)
    }

    func testBuildStartsOnThePressStep() {
        var machine = DropMachine()
        XCTAssertTrue(machine.press(at: 37))
        XCTAssertEqual(machine.layer(at: 36, secondsPerStep: sps), .song)
        XCTAssertEqual(
            machine.layer(at: 37, secondsPerStep: sps), .build(rollEvery: 4, intensity: 0, isFirstStep: true))
    }

    func testRollSpeedsUpWithTheHold() {
        var machine = DropMachine()
        machine.press(at: 0)
        guard case .build(let early, _, _) = machine.layer(at: 4, secondsPerStep: sps),
            case .build(let late, let intensity, _) = machine.layer(at: 40, secondsPerStep: sps)
        else { return XCTFail("not building") }
        XCTAssertEqual(early, 4)
        XCTAssertEqual(late, 1)
        XCTAssertGreaterThan(intensity, 0.5)
    }

    func testReleaseLandsTheDropOnTheReleaseStep() {
        var machine = DropMachine()
        machine.press(at: 5)
        let drop = machine.release(at: 9, secondsPerStep: sps)
        XCTAssertEqual(drop?.start, 9)
        XCTAssertEqual(drop?.end, 9 + 32)  // a quick tap still drops, for two bars
        guard case .drop(let position, _) = machine.layer(at: 9, secondsPerStep: sps) else {
            return XCTFail("no drop on the release step")
        }
        XCTAssertEqual(position, 0)
    }

    func testLongHoldDropsForFourBars() {
        var machine = DropMachine()
        machine.press(at: 0)
        let drop = machine.release(at: 40, secondsPerStep: sps)  // ~4.3 s
        XCTAssertEqual(drop.map { $0.end - $0.start }, 64)
    }

    func testDropEndsBackToTheSong() {
        var machine = DropMachine()
        machine.press(at: 0)
        let drop = machine.release(at: 1, secondsPerStep: sps)!
        machine.advance(to: drop.end)
        XCTAssertEqual(machine.phase, .idle)
        XCTAssertEqual(machine.layer(at: drop.end, secondsPerStep: sps), .song)
    }

    func testPressesDoNotStack() {
        var machine = DropMachine()
        XCTAssertTrue(machine.press(at: 0))
        XCTAssertFalse(machine.press(at: 3))
        XCTAssertEqual(machine.phase, .building(start: 0))
        var idle = DropMachine()
        XCTAssertNil(idle.release(at: 5, secondsPerStep: sps).map { $0.start })
    }

    func testPressDuringADropStartsANewBuild() {
        var machine = DropMachine()
        machine.press(at: 0)
        machine.release(at: 2, secondsPerStep: sps)
        XCTAssertTrue(machine.press(at: 10))
        XCTAssertEqual(machine.phase, .building(start: 10))
    }
}
