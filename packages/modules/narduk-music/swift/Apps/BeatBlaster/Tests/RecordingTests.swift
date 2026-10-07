import AVFoundation
import XCTest

@testable import BeatBlaster

@MainActor final class RecordingTests: XCTestCase {
    private var directory: URL!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("bb-rec-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    func testCleanNameStripsReservedCharactersAndNeverEmpty() {
        XCTAssertEqual(RecordingStore.cleanName("a/b:c?"), "abc")
        XCTAssertEqual(RecordingStore.cleanName("  "), "My song")
        XCTAssertEqual(RecordingStore.cleanName(String(repeating: "x", count: 100)).count, 60)
    }

    func testClockText() {
        XCTAssertEqual(clockText(0), "00:00")
        XCTAssertEqual(clockText(75), "01:15")
        XCTAssertEqual(clockText(3661), "1:01:01")
    }

    func testRowTitleDropsTheTakeStampAndDetailShowsDayAndLength() {
        func take(_ file: String, _ date: Date = Date()) -> Recording {
            Recording(url: URL(fileURLWithPath: "/x/\(file).m4a"), date: date, seconds: 75)
        }
        XCTAssertEqual(take("Laser Monkey Boogie 2026-10-07 04.12.33").title, "Laser Monkey Boogie")
        XCTAssertEqual(take("Laser Monkey Boogie 2026-10-07 04.12.33 2").title, "Laser Monkey Boogie")
        XCTAssertEqual(take("Smoke Test 2").title, "Smoke Test 2")
        XCTAssertEqual(take("2026-10-07 04.12.33").title, "2026-10-07 04.12.33")
        XCTAssertTrue(take("a").detail.hasPrefix("Today "))
        XCTAssertTrue(take("a").detail.hasSuffix(" · 01:15"))
        XCTAssertTrue(take("a", Date().addingTimeInterval(-86_400)).detail.hasPrefix("Yesterday "))
    }

    func testTakesShorterThanTheFloorStayOutOfTheList() throws {
        let store = RecordingStore(directory: directory)
        try Self.writeSilence(to: store.newTakeURL(title: "Peek"), seconds: 1)
        try Self.writeSilence(to: store.newTakeURL(title: "Real song"), seconds: 2.5)
        XCTAssertEqual(store.list().map(\.title), ["Real song"])
        XCTAssertEqual(RecordingStore(directory: directory, shortest: 0).list().count, 2, "hidden, not deleted")
    }

    func testStoreListRenameDelete() throws {
        let store = RecordingStore(directory: directory, shortest: 0)
        let url = store.newTakeURL(title: "Dino Disco")
        try Self.writeSilence(to: url, seconds: 1)
        var list = store.list()
        XCTAssertEqual(list.count, 1)
        XCTAssertEqual(list[0].seconds, 1, accuracy: 0.1)
        XCTAssertTrue(list[0].name.hasPrefix("Dino Disco"))
        let renamed = try store.rename(list[0], to: "My best jam")
        XCTAssertEqual(renamed.lastPathComponent, "My best jam.m4a")
        list = store.list()
        XCTAssertEqual(list.map(\.name), ["My best jam"])
        store.delete(list[0])
        XCTAssertTrue(store.list().isEmpty)
    }

    func testTwoTakesNeverShareAPath() throws {
        let store = RecordingStore(directory: directory)
        let date = Date()
        let first = store.newTakeURL(title: "Same", date: date)
        try Self.writeSilence(to: first, seconds: 0.5)
        XCTAssertNotEqual(store.newTakeURL(title: "Same", date: date), first)
    }

    /// The real engine records its master mixer to an m4a, saves it on stop, and a long take rotates into the next.
    func testRecorderStartStopSaveAndRotation() async throws {
        let audio = BlasterAudio()
        audio.store = RecordingStore(directory: directory, shortest: 0)
        audio.maxTakeSeconds = 1.2
        audio.minTakeSeconds = 0
        audio.play(SongRecipe(style: .genre(.house)))
        audio.beginRecording()
        XCTAssertTrue(audio.isRecording)
        try await Task.sleep(for: .seconds(2.2))
        audio.endRecording()
        XCTAssertFalse(audio.isRecording)
        await audio.settleRecording()
        audio.stop()
        let saved = audio.store.list()
        XCTAssertGreaterThanOrEqual(saved.count, 2, "a take longer than the cap rolls into a new file")
        XCTAssertGreaterThan(saved.reduce(0) { $0 + $1.seconds }, 1.0)
        XCTAssertEqual(audio.savedCount, saved.count)
    }

    /// A peek at the player (under minTakeSeconds) leaves nothing in My Songs.
    func testATakeTooShortToKeepIsThrownAway() async throws {
        let audio = BlasterAudio()
        audio.store = RecordingStore(directory: directory)
        audio.play(SongRecipe(style: .genre(.house)))
        audio.beginRecording()
        try await Task.sleep(for: .seconds(0.5))
        audio.endRecording()
        await audio.settleRecording()
        audio.stop()
        XCTAssertEqual(audio.store.list().count, 0)
        XCTAssertEqual(audio.savedCount, 0)
        let leftovers =
            (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        XCTAssertTrue(leftovers.isEmpty, "the short take's file is deleted: \(leftovers)")
    }

    func testShowModeHidesAndReveals() {
        var show = ShowMode()
        XCTAssertFalse(show.hidden)
        show.hide()
        XCTAssertTrue(show.hidden)
        show.reveal()
        XCTAssertFalse(show.hidden)
    }

    private static func writeSilence(to url: URL, seconds: Double) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2)!
        let file = try AVAudioFile(
            forWriting: url,
            settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100.0, AVNumberOfChannelsKey: 2,
            ])
        let frames = AVAudioFrameCount(seconds * 44_100)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        try file.write(from: buffer)
    }
}
