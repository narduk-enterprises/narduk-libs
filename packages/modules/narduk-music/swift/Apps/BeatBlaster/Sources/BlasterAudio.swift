import AVFoundation
import Foundation
import NardukMusicEngine
import NardukSoundAnalysis
import NardukSoundVisuals
import Observation

/// Where the sound comes from.
enum BlasterInput: Equatable {
    case song
    case microphone
}

/// Owns the audio for the whole app (adapted from the SoundGallery's `GalleryModel`, minus the file source, plus the
/// DROP button and the jam controls). Frames are polled on the view's own clock and never observed, so a new frame never
/// invalidates a view body by itself (Wirewatcher #65).
@MainActor @Observable final class BlasterAudio {
    private(set) var input: BlasterInput = .song
    var song = BlasterSong()
    private(set) var isRunning = false
    /// Set when the microphone could not start (denied, or no input); the mic screen shows a friendly card.
    private(set) var micProblem: String?
    /// The tempo nudge the jam controls set: 0.8 (slow), 1 (normal), 1.2 (fast).
    private(set) var tempoScale = 1.0
    private(set) var bigBass = false
    /// True while the DROP button is held.
    private(set) var isSurging = false

    /// When the DROP button went down / came up, for the views' own clocks to draw the surge and the boom.
    @ObservationIgnored private(set) var surgeStart: Date?
    @ObservationIgnored private(set) var lastDrop: Date?

    @ObservationIgnored private var source: (any SoundFrameSource)?
    @ObservationIgnored private var latest = SoundFrame()
    @ObservationIgnored private let drop = DropEngine()
    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private var tap: AudioTapSource?
    @ObservationIgnored private var player: SongPlayer?
    @ObservationIgnored private var surgeTask: Task<Void, Never>?
    @ObservationIgnored private var landTask: Task<Void, Never>?
    @ObservationIgnored private let clockOrigin = Date.timeIntervalSinceReferenceDate
    /// What was playing when the app went to the background, to resume on return.
    @ObservationIgnored private var resumeInput: BlasterInput?

    var latestFrame: SoundFrame { latest }

    /// The state every `NardukSoundVisuals` canvas draws from; one for the app, advanced once per tick by `poll`.
    @ObservationIgnored let visualState = SoundVisualState()

    /// 0 ... 1 loudness of the latest frame, for the title pulse and the glow.
    var level: Double { Double(max(0, min(1, (latest.rmsDB + 50) / 50))) }

    func poll(at date: Date) -> SoundFrame {
        let now = date.timeIntervalSinceReferenceDate
        latest = source?.poll(time: now - clockOrigin) ?? SoundFrame()
        visualState.update(SoundVisualInput(frame: latest), now: now)
        return latest
    }

    // MARK: Transport

    /// Plays `song` from the top (stopping whatever ran before).
    func play(_ song: BlasterSong? = nil) {
        if let song { self.song = song }
        stop()
        input = .song
        do {
            try startSong()
            isRunning = true
        } catch {
            stop()
        }
    }

    /// Starts the song only if nothing plays (the home screen's background music).
    func playIfIdle() {
        if !isRunning || input != .song { play() }
    }

    func newSong() {
        song.reroll()
        if song.style == .demo { song.style = BlasterStyle.all.randomElement() ?? .demo }
        song.title = nil
        play()
    }

    func startMicrophone() async {
        stop()
        input = .microphone
        micProblem = nil
        guard await AVAudioApplication.requestRecordPermission() else {
            micProblem = "denied"
            return
        }
        do {
            try AudioSessionConfiguration.configureForMicrophone()
            let tap = try AudioTapSource.microphone(of: engine)
            engine.prepare()
            try engine.start()
            try tap.start()
            self.tap = tap
            source = tap
            isRunning = true
        } catch {
            micProblem = "unavailable"
            stop()
        }
    }

    func stop() {
        endSurge(land: false)
        landTask?.cancel()
        drop.stop()
        tap?.stop()
        tap = nil
        if engine.isRunning { engine.stop() }
        source = nil
        player = nil
        isRunning = false
        resetMix()
    }

    // MARK: Background

    func pauseForBackground() {
        guard isRunning else { return }
        resumeInput = input
        stop()
    }

    func resumeFromBackground() {
        guard let input = resumeInput else { return }
        resumeInput = nil
        switch input {
        case .song: play()
        case .microphone: Task { await startMicrophone() }
        }
    }

    // MARK: Jam controls

    func setTempo(_ scale: Double) {
        tempoScale = scale
        var settings = drop.settings
        settings.bpm = song.settings.bpm * scale
        drop.settings = settings
    }

    func toggleBass() {
        bigBass.toggle()
        resetMix()
    }

    // MARK: The DROP button

    /// Hold: the song builds (the conductor hears full energy), the bass drops out, the effects swell.
    func beginSurge() {
        guard isRunning, input == .song, !isSurging else { return }
        isSurging = true
        surgeStart = Date()
        landTask?.cancel()
        player?.surge = true
        drop.setMuted(true, for: .bass)
        surgeTask = Task { [weak self] in
            var t: Float = 0
            while !Task.isCancelled {
                guard let self else { return }
                t = min(1, t + 0.02)
                self.drop.setGain(1 + 0.5 * t, for: .fx)
                self.drop.setGain(1 - 0.45 * t, for: .drums)
                self.drop.masterVolume = 0.7 + 0.3 * t
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    /// Release: the bass slams back in loud, the drop lands, then the mix settles after a few seconds.
    func endSurge(land: Bool = true) {
        guard isSurging else { return }
        isSurging = false
        surgeTask?.cancel()
        surgeTask = nil
        player?.surge = false
        surgeStart = nil
        guard land else {
            resetMix()
            return
        }
        lastDrop = Date()
        player?.requestDrop()
        drop.setMuted(false, for: .bass)
        drop.setGain(1.5, for: .bass)
        drop.setGain(1.3, for: .drums)
        drop.setGain(1, for: .fx)
        drop.masterVolume = 1
        landTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled else { return }
            self?.resetMix()
        }
    }

    private func resetMix() {
        drop.setMuted(false, for: .bass)
        drop.setGain(bigBass ? 1.5 : 1, for: .bass)
        drop.setGain(1, for: .drums)
        drop.setGain(1, for: .fx)
        drop.masterVolume = 0.8
    }

    // MARK: Sources

    private func startSong() throws {
        switch song.style {
        case .demo:
            try drop.playDemo()
        case .genre, .guitars:
            var settings = song.settings
            settings.bpm *= tempoScale
            drop.settings = settings
            let player = SongPlayer(song: song, engine: drop)
            self.player = player
            drop.noteProvider = { [player] throughStep in player.notes(through: throughStep) }
            try drop.start()
        }
        resetMix()
        source = drop.makeSoundSource()
    }
}
