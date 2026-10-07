import AVFoundation
import Foundation
import NardukMusicCore
import NardukMusicEngine
import NardukSoundAnalysis
import NardukSoundVisuals
import Observation

/// What is making the sound.
enum BlasterInput: Equatable {
    case song
    case beatLab
    case microphone
}

/// Owns the audio for the whole app (adapted from the SoundGallery's `GalleryModel`): a recipe song steered live, the
/// Beat Lab sequencer, or the microphone. Frames are polled on the views' own clocks and never observed, so a new frame
/// never invalidates a view body by itself (Wirewatcher #65).
@MainActor @Observable final class BlasterAudio {
    private(set) var input: BlasterInput = .song
    /// The song playing (or last played); the player screen edits it.
    private(set) var recipe = SongRecipe(style: .genre(.house))
    private(set) var isRunning = false
    /// Set when the microphone could not start ("denied" or "unavailable").
    private(set) var micProblem: String?
    /// The Energy slider, 0 (chill) ... 1 (hype); heard by the conductor every quarter second.
    var energy = 0.6 {
        didSet { player?.energy = energy }
    }
    private(set) var isSurging = false
    /// The light the player and Light Show draw.
    var lightsID = "tunnel"

    @ObservationIgnored private(set) var surgeStart: Date?
    @ObservationIgnored private(set) var lastDrop: Date?

    @ObservationIgnored private var source: (any SoundFrameSource)?
    @ObservationIgnored private var latest = SoundFrame()
    @ObservationIgnored private var lastPoll = 0.0
    @ObservationIgnored private let drop = DropEngine()
    @ObservationIgnored private let engine = AVAudioEngine()
    @ObservationIgnored private var tap: AudioTapSource?
    @ObservationIgnored private var player: SongPlayer?
    @ObservationIgnored private var surgeTask: Task<Void, Never>?
    @ObservationIgnored private var landTask: Task<Void, Never>?
    @ObservationIgnored private var previewTask: Task<Void, Never>?
    @ObservationIgnored private let clockOrigin = Date.timeIntervalSinceReferenceDate
    @ObservationIgnored private var resumeInput: BlasterInput?
    @ObservationIgnored private weak var lab: BeatLab?

    var latestFrame: SoundFrame { latest }

    /// What every visualizer draws from: the frame plus, for the engine, its music context (kicks, section).
    var visualInput: SoundVisualInput {
        SoundVisualInput(frame: latest, music: input == .microphone || !isRunning ? nil : drop.latestMusic)
    }

    /// The step the Beat Lab is on (read inside a TimelineView only).
    var currentStep: Int { drop.currentStep }

    @ObservationIgnored let visualState = SoundVisualState()

    /// 0 ... 1 loudness of the latest frame.
    var level: Double { Double(max(0, min(1, (latest.rmsDB + 50) / 50))) }

    /// The latest frame at `date`. Idempotent per display frame, so several timelines on one screen can call it.
    func poll(at date: Date) -> SoundFrame {
        let now = date.timeIntervalSinceReferenceDate
        guard now - lastPoll > 0.004 else { return latest }
        lastPoll = now
        latest = source?.poll(time: now - clockOrigin) ?? SoundFrame()
        visualState.update(visualInput, now: now)
        return latest
    }

    // MARK: Songs

    /// Plays `recipe` from the top with its band, speed and lights.
    func play(_ recipe: SongRecipe) {
        stop()
        self.recipe = recipe
        lightsID = recipe.lightsID
        input = .song
        do {
            drop.settings = recipe.settings
            let player = SongPlayer(recipe: recipe, engine: drop)
            player.energy = energy
            self.player = player
            drop.noteProvider = { [player] throughStep in player.notes(through: throughStep) }
            try drop.start()
            resetMix()
            source = drop.makeSoundSource()
            isRunning = true
        } catch {
            stop()
        }
    }

    /// Plays `recipe` for a few seconds (the song maker's previews).
    func preview(_ recipe: SongRecipe, seconds: Double = 6) {
        play(recipe)
        previewTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, let self, self.recipe.id == recipe.id else { return }
            self.stop()
        }
    }

    /// Keeps the current song going, or starts it if nothing plays.
    func playIfIdle() {
        if !isRunning || input != .song { play(recipe) }
    }

    /// Edits to the playing song that apply live (band, lights, name).
    func update(_ edit: (inout SongRecipe) -> Void) {
        edit(&recipe)
        player?.band = recipe.band
        lightsID = recipe.lightsID
    }

    /// "Surprise me": a whole new song (style, speed, key, mood, band and every sound), same lights.
    func surprise() {
        play(recipe.surprise())
    }

    func setSpeed(_ speed: Speed) {
        recipe.speed = speed
        var settings = drop.settings
        settings.bpm = recipe.settings.bpm
        drop.settings = settings
    }

    // MARK: Beat Lab

    func startBeatLab(_ lab: BeatLab) {
        stop()
        input = .beatLab
        self.lab = lab
        lab.restart()
        var settings = SongSettings()
        settings.bpm = lab.bpm
        drop.settings = settings
        drop.noteProvider = { [weak lab] throughStep in lab?.notes(through: throughStep) ?? [] }
        do {
            try drop.start()
            resetMix()
            source = drop.makeSoundSource()
            isRunning = true
        } catch {
            stop()
        }
    }

    func setLabTempo(_ bpm: Double) {
        var settings = drop.settings
        settings.bpm = bpm
        drop.settings = settings
    }

    // MARK: Microphone

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
        previewTask?.cancel()
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
        case .song: play(recipe)
        case .beatLab: if let lab { startBeatLab(lab) }
        case .microphone: Task { await startMicrophone() }
        }
    }

    // MARK: The DROP button

    /// Hold: the bass is muted at once (even notes already scheduled), the drums duck and the effects and volume swell
    /// with the hold; from the next unscheduled step the song's kick and bass drop out under a speeding snare roll and
    /// a riser (`SongPlayer`/`DropMachine`). A press while a drop plays starts a new build; a second one is ignored.
    func beginSurge() {
        guard isRunning, input == .song, !isSurging, let player else { return }
        isSurging = true
        surgeStart = Date()
        landTask?.cancel()
        player.pressDrop()
        drop.setMuted(true, for: .bass)
        surgeTask?.cancel()
        surgeTask = Task { [weak self] in
            let start = Date()
            while !Task.isCancelled {
                guard let self else { return }
                let t = Float(min(1, Date().timeIntervalSince(start) / DropMachine.fullChargeSeconds))
                self.drop.setGain(1 + 0.5 * t, for: .fx)
                self.drop.setGain(Self.restingDrums - 0.55 * t, for: .drums)
                self.drop.masterVolume = 0.75 + 0.25 * t
                try? await Task.sleep(for: .milliseconds(40))
            }
        }
    }

    /// Release: the drop lands on the next unscheduled 16th (the soonest the engine can play it) with the bass back in
    /// loud; the flash and BOOM are timed to the audible hit; the mix returns to normal when the drop's bars end.
    /// `land: false` abandons the build (the song stopped) and resets the mix.
    func endSurge(land: Bool = true) {
        guard isSurging else { return }
        isSurging = false
        surgeTask?.cancel()
        surgeTask = nil
        surgeStart = nil
        guard land, let player, let hit = player.releaseDrop() else {
            player?.cancelDrop()
            resetMix()
            return
        }
        let sps = player.secondsPerStep
        let untilHit = max(0, Double(hit.start - drop.currentStep) * sps)
        lastDrop = Date().addingTimeInterval(untilHit)
        drop.setMuted(false, for: .bass)
        drop.setGain(1.4, for: .bass)
        drop.setGain(1.3, for: .drums)
        drop.setGain(1, for: .fx)
        drop.masterVolume = 1
        let length = untilHit + Double(hit.end - hit.start) * sps
        landTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(length))
            guard !Task.isCancelled else { return }
            self?.resetMix()
        }
    }

    private static let restingBass: Float = 1.2
    private static let restingDrums: Float = 1.15

    private func resetMix() {
        drop.setMuted(false, for: .bass)
        // The resting mix keeps the kick and bass up front (the drop lands louder still: 1.4 and 1.3).
        drop.setGain(Self.restingBass, for: .bass)
        drop.setGain(Self.restingDrums, for: .drums)
        drop.setGain(1, for: .fx)
        drop.masterVolume = 0.85
    }
}
