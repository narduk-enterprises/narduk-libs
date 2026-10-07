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
    /// Paused by the child: music, recording and clock stand still together (a resume starts a fresh take).
    private(set) var isPaused = false
    /// The Effects page's sliders (Wobble, Echo, Bass boost, Speed); the song's notes are reshaped as they are scheduled.
    var effects = EffectSettings() {
        didSet { effectsChanged(from: oldValue) }
    }
    /// Bumped on every pad press so the view can flash.
    private(set) var padPresses = 0
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
    @ObservationIgnored private var glideTask: Task<Void, Never>?
    @ObservationIgnored private var landTask: Task<Void, Never>?
    @ObservationIgnored private var previewTask: Task<Void, Never>?
    @ObservationIgnored private var fadeTask: Task<Void, Never>?
    @ObservationIgnored private var swapTask: Task<Void, Never>?
    @ObservationIgnored private let clockOrigin = Date.timeIntervalSinceReferenceDate
    @ObservationIgnored private var resumeInput: BlasterInput?
    @ObservationIgnored private weak var lab: BeatLab?

    // Recording: the player records every song it plays (see "Recording" below).
    /// When the take being recorded began (nil when nothing records).
    private(set) var takeStart: Date?
    /// Bumped each time a take is saved, so the Home list refreshes.
    private(set) var savedCount = 0
    private(set) var recordingProblem: String?
    var store = RecordingStore.standard
    /// A take stops at this length and the next one starts (60 minutes).
    var maxTakeSeconds = 3600.0
    @ObservationIgnored private var wantsRecording = false
    @ObservationIgnored private var recorderChain: Task<Void, Never>?
    @ObservationIgnored private var capTask: Task<Void, Never>?
    @ObservationIgnored private var takeURL: URL?
    @ObservationIgnored private var interruptionObserver: (any NSObjectProtocol)?

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
    func play(_ recipe: SongRecipe, fadeIn: Double = 0) {
        watchInterruptions()
        stop()
        self.recipe = recipe
        lightsID = recipe.lightsID
        input = .song
        do {
            drop.settings = recipe.settings
            let player = SongPlayer(recipe: recipe, engine: drop)
            player.energy = energy
            effects.speed = nil
            player.effects = effects
            self.player = player
            drop.noteProvider = { [player] throughStep in player.notes(through: throughStep) }
            try drop.start()
            resetMix()
            source = drop.makeSoundSource()
            isRunning = true
            startTake()
            if fadeIn > 0 {
                drop.masterVolume = 0
                fade(to: Self.restingMaster, over: fadeIn)
            }
        } catch {
            stop()
        }
    }

    /// Swaps to `next` without a jump: the sound dips over about half a second, the new song comes in on the old
    /// song's next bar and rises over about 0.7 s. (A bar that is more than 2.5 s away is not waited for.)
    func swap(to next: SongRecipe) {
        guard isRunning, input == .song, !isPaused else { return play(next, fadeIn: 0.7) }
        swapTask?.cancel()
        let wait = min(2.5, player?.secondsToNextBar ?? 0)
        let dip = min(0.5, max(0.15, wait))
        fade(to: 0, over: dip)
        swapTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(wait, dip)))
            guard !Task.isCancelled, let self else { return }
            self.play(next, fadeIn: 0.7)
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
        swap(to: recipe.surprise())
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
        glideTask?.cancel()
        fadeTask?.cancel()
        swapTask?.cancel()
        isPaused = false
        finishTake()
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

    // MARK: Pause

    private static let restingMaster: Float = 0.85

    /// Ramps the master volume to `target` over `seconds` (a dip, never a jump).
    private func fade(to target: Float, over seconds: Double) {
        fadeTask?.cancel()
        let start = drop.masterVolume
        let steps = max(1, Int(seconds / 0.02))
        fadeTask = Task { [weak self] in
            for i in 1...steps {
                try? await Task.sleep(for: .milliseconds(20))
                guard !Task.isCancelled, let self else { return }
                self.drop.masterVolume = start + (target - start) * Float(i) / Float(steps)
            }
        }
    }

    /// Pause: the sound fades out in 0.15 s, the song stops advancing and the take is saved. Nothing is lost.
    func pause() {
        guard isRunning, input == .song, !isPaused else { return }
        swapTask?.cancel()
        endSurge(land: false)
        isPaused = true
        player?.paused = true
        finishTake()
        fade(to: 0, over: 0.15)
    }

    /// Resume from the same beat; the recording carries on in a new take.
    func resume() {
        guard isRunning, isPaused else { return }
        isPaused = false
        player?.paused = false
        fade(to: Self.restingMaster, over: 0.2)
        startTake()
    }

    func togglePause() { isPaused ? resume() : pause() }

    // MARK: Effects

    /// A sound-effect pad: sounds on the next free 16th and is recorded with everything else.
    func fire(_ pad: SoundPad) {
        guard isRunning, input == .song, let player else { return }
        player.trigger(pad)
        padPresses += 1
    }

    private func effectsChanged(from old: EffectSettings) {
        player?.effects = effects
        if effects.bass != old.bass, !isSurging { applyBassGain() }
        if effects.speed != old.speed, let position = effects.speed { glide(toSliderPosition: position) }
    }

    private func applyBassGain() {
        drop.setGain(Self.restingBass * Float(1 + 0.6 * effects.bass), for: .bass)
    }

    /// The Speed slider moves the tempo through the style's own slow-to-fast range, a few bpm at a time so it glides.
    private func glide(toSliderPosition position: Double) {
        guard input == .song else { return }
        let base = recipe.style.baseBPM
        let target =
            base * (Speed.slow.scale + (Speed.fast.scale - Speed.slow.scale) * min(1, max(0, position)))
            * recipe.tempoNudge
        glideTask?.cancel()
        glideTask = Task { [weak self] in
            while !Task.isCancelled, let self {
                var settings = self.drop.settings
                let delta = target - settings.bpm
                if abs(delta) < 0.25 {
                    settings.bpm = target
                    self.drop.settings = settings
                    return
                }
                settings.bpm += max(-2, min(2, delta))
                self.drop.settings = settings
                try? await Task.sleep(for: .milliseconds(40))
            }
        }
    }

    // MARK: Recording

    var isRecording: Bool { takeStart != nil }

    /// Seconds into the current take (0 when nothing records).
    func recordingElapsed(at date: Date = Date()) -> Double {
        takeStart.map { max(0, date.timeIntervalSince($0)) } ?? 0
    }

    /// The player is on screen: record the song now and keep recording across new songs until `endRecording()`.
    func beginRecording() {
        wantsRecording = true
        startTake()
    }

    /// Leaving the player (or tapping the REC pill): finish and save the take.
    func endRecording() {
        wantsRecording = false
        finishTake()
    }

    /// Resolves once every queued start and stop has run (the tests, and anything that must read the saved file).
    func settleRecording() async {
        await recorderChain?.value
    }

    /// Takes the master mixer (what the speakers play, no microphone) to an m4a. Starts and stops queue on one chain,
    /// so a stop followed at once by a start (a new song) never overlaps.
    private func startTake() {
        guard wantsRecording, isRunning, input == .song, !isPaused, takeStart == nil else { return }
        let url = store.newTakeURL(title: recipe.name)
        takeURL = url
        takeStart = Date()
        recordingProblem = nil
        let previous = recorderChain
        recorderChain = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            do {
                try self.drop.startRecording(to: url)
            } catch {
                self.takeStart = nil
                self.takeURL = nil
                self.recordingProblem = "Could not start recording"
            }
        }
        capTask?.cancel()
        capTask = Task { [weak self] in
            guard let seconds = self?.maxTakeSeconds else { return }
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, let self else { return }
            self.finishTake()
            self.startTake()
        }
    }

    private func finishTake() {
        capTask?.cancel()
        capTask = nil
        guard takeStart != nil else { return }
        takeStart = nil
        takeURL = nil
        let previous = recorderChain
        recorderChain = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            if await self.drop.stopRecording() != nil { self.savedCount += 1 }
        }
    }

    /// A phone call or Siri stops the engine; save what was recorded and pick the song up again afterwards.
    private func watchInterruptions() {
        guard interruptionObserver == nil else { return }
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            MainActor.assumeIsolated {
                switch raw.flatMap(AVAudioSession.InterruptionType.init) {
                case .began: self?.pauseForBackground()
                case .ended: self?.resumeFromBackground()
                default: break
                }
            }
        }
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
        drop.setGain(Self.restingBass * Float(1 + 0.6 * effects.bass), for: .bass)
        drop.setGain(Self.restingDrums, for: .drums)
        drop.setGain(1, for: .fx)
        drop.masterVolume = Self.restingMaster
    }
}
