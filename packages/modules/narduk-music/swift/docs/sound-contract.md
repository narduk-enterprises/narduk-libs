# NardukSound contract

Status: design, 2026-10-06 (narduk-libs#1567, phase A1 of the NardukSound
program). Plan, layers and phases: `docs/sound-visuals-plan.md` in
narduk-enterprises/data-beats. This document is what A2 (analysis), A3 (sonify),
A4 (gallery), A5 (port) and A6 (music) build against. A type or rule here
changes only by editing this file in a PR.

Logan's framing: data, data streams, music creation and visualizations from that
music; and "it doesn't have to be music". So a visualizer must work from a
`SoundFrame` alone, and use a `MusicContext` only when one is present.

## 1. Products

Three new products of the existing package
(`packages/modules/narduk-music/swift`), one gate and one release tag. The empty
targets landed first (narduk-libs#1580) so no later lane edits the root
`Package.swift`.

| Product               | Depends on                               | Owns                                                                                              |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `NardukSoundAnalysis` | nothing                                  | `SoundFrame`, the analyzer (`SpectrumAnalyzer` moves in), loudness, frame sources, `SoundMailbox` |
| `NardukSonify`        | `NardukMusicCore`                        | the stream sonifier lifted from DataBeatsKit (A3)                                                 |
| `NardukSoundVisuals`  | `NardukSoundAnalysis`, `NardukMusicCore` | `SoundVisualState`, `SoundVisualInput`, palette, render budget, visualizers, gallery              |

Existing products keep their public API. A6 adds `NardukSoundAnalysis` as a
dependency of `NardukMusicDSP` and of `NardukMusicEngine`; `VisualizerFrame`
stays as a deprecated adapter until then. All three targets compile on the Linux
gate: anything that needs SwiftUI, Metal, AVFoundation or UIKit/AppKit sits
behind `#if canImport(...)` inside the target. Platforms are macOS 15 and iOS 18
from the first commit (the root manifest already declares them).

### Where each type lives

`SoundFrame` has no dependencies, so it is in Analysis. `MusicContext` names
`Instrument` and `SongSection`, which are in Core, and Analysis must not depend
on Core, so `MusicContext` is in **NardukMusicCore**. The pair is joined only in
Visuals (`SoundVisualInput`). The engine (A6) depends on both and publishes
both.

## 2. The types

### SoundFrame (NardukSoundAnalysis)

What any sound is doing at about 60 Hz. Every visualizer must work from this
alone.

```swift
public struct SoundFrame: Sendable, Hashable {
    /// Strictly increasing per source, starting at 1. 0 means "no frame yet". The only "is this new?" test.
    public var sequence: UInt64
    /// Seconds on the source's own timeline: samples rendered / sample rate for the engine and offline renders,
    /// host time for a microphone or tap. Used for staleness and replay, never for animation (see section 4).
    public var time: Double
    /// 64 log-spaced bands, 20 Hz to 16 kHz, 0 ... 1 (the SpectrumAnalyzer layout today).
    public var spectrum: [Float]
    /// The latest 512 mono output samples, -1 ... 1.
    public var waveform: [Float]
    /// Master bus peak and RMS in dBFS; -120 is silence.
    public var peakDB: Float
    public var rmsDB: Float
    public init(sequence: UInt64 = 0, time: Double = 0, spectrum: [Float] = ..., waveform: [Float] = ...,
                peakDB: Float = -120, rmsDB: Float = -120)
}
```

The initializer is public with defaults because apps build synthetic frames
(Wirewatcher's `DemoDropModel` and `DropOfflineModel` both do today). Band count
and sample count are named constants (`SoundFrame.bandCount`,
`SoundFrame.sampleCount`), never magic numbers in a visualizer.

Onsets, beat, chroma and pitch are not here. They are added as optional fields
when a visualizer needs one (A9).

### MusicContext (NardukMusicCore)

What music knows about itself, when the source is music. Visualizers use it when
present and degrade without it. Only what the engine can emit today.

```swift
public struct MusicContext: Sendable, Hashable {
    /// Instruments that fired since the previous frame the consumer saw (see "hit coalescing", section 4).
    public var hits: InstrumentSet
    /// Conductor step, 16ths (4 per beat, 16 per bar).
    public var step: Int
    public var section: SongSection
    /// Conductor energy 0 ... 1.
    public var energy: Float
    /// Wobble LFO phase 0 ... 1 and filter cutoff 0 ... 1.
    public var wobblePhase: Float
    public var wobbleCutoff: Float
    /// Seconds per 16th (60 / bpm / 4): lets the consumer interpolate the beat clock between frames.
    public var secondsPerStep: Double
    /// Progress through the current phrase, 0 ... 1 (the tunnel's build speed reads it).
    public var phraseProgress: Float
}
```

Two fields beyond the plan's list, `secondsPerStep` and `phraseProgress`,
because Wirewatcher's `DropVisualState` reads them from `SongSettings` and
`ConductorSnapshot` on every update (section 6, gaps G1 and G2). Both are
available to the engine today.

`hits` is an `InstrumentSet`, an `OptionSet` over `Instrument` (14 cases fit a
`UInt16`), not the plan's `Set<Instrument>`. This is the one deliberate
deviation from the plan text: a `Set` allocates when built, and coalescing
(section 4) becomes a bitwise OR. `InstrumentSet` is `ExpressibleByArrayLiteral`
and has `contains`, so call sites read the same. If review prefers the plain
`Set`, only the mailbox merge changes.

When the source is not music, `music` is `nil`. Visualizers that want a wobble,
a section or a beat fall back as in section 5.

## 3. SoundVisualState (NardukSoundVisuals)

One main-actor class that turns the latest frame into drawable state, so every
visualizer on screen draws from the same smoothed numbers. Source of truth is
Wirewatcher's `DropVisualState` (504 lines); Data Beats' `SpectrumCaps`,
`PadState`, `MeterState` and the state half of `StageFX` fold in.

```swift
public struct SoundVisualInput: Sendable {
    public var frame: SoundFrame
    public var music: MusicContext?
    /// False when the source is stopped: the beat clock holds and `beatPulse` is 0.
    public var isRunning: Bool
}

public struct SoundVisualOptions: Sendable, Equatable {
    /// Reduced motion / calm mode: no flash, shake, chroma or glitch, slower smoothing, fewer particles.
    public var calm = false
    /// An app-supplied 0 ... 1 activity level that makes the stage wilder (Wirewatcher: smoothed traffic intensity).
    /// nil means the stage is as wild as the music is energetic.
    public var intensity: Float?
}

@MainActor public final class SoundVisualState {
    public init(configuration: SoundVisualConfiguration = .init(), seed: UInt64 = 0x9E37_79B9_7F4A_7C15)
    public func update(_ input: SoundVisualInput, now: Double, options: SoundVisualOptions)
    // read-only outputs: see below
}
```

`SoundVisualConfiguration` holds the constants the two apps disagree on, so
porting does not change either look: spectrum attack and release, the peak-cap
hold and fall (Wirewatcher 0.4 s and 0.55/s; Data Beats 0.45 s and 0.9/s), pad
decay (Data Beats `exp(-4.5 dt)`), meter windows (Data Beats -60 ... 0 dB;
Wirewatcher's `level` -48 ... 0 dB) and the particle capacity. Defaults are
Wirewatcher's.

### Outputs

| Group     | Members                                                                                                            | From                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Spectrum  | `spectrum[64]` smoothed, `peaks[64]` with hold                                                                     | `DropVisualState`, `SpectrumCaps`         |
| Waveform  | `waveform[512]`, a ring of the last 10 (`history`, `historyHead`, `historyCount`)                                  | `DropVisualState`                         |
| Meters    | `peak`, `rms`, `peakHold`, `level` (0 ... 1)                                                                       | `MeterState`, `DropVisualState.level`     |
| Pads      | `padBrightness[Instrument]`, a fixed array indexed by instrument, not a dictionary                                 | `PadState`                                |
| Envelopes | `kick`, `snare`, `hat`, `glitch`, `laser`, `impact`, `flash`, `shake` (+ `shakeOffset`), `chroma`                  | `DropVisualState`                         |
| Music     | `wobblePhase`, `wobbleCutoff`, `energy`, `section`, `phraseProgress`, `dropAmount`, `travel`, `energyHistory[128]` | `DropVisualState`                         |
| Clock     | `time`, `stepPosition`, `beats`, `beatPhase`, `barPhase`, `beatPulse`, `fps`                                       | `DropVisualState`                         |
| Mood      | `wild`, `calm`, `palette` (the blended, saturated section palette)                                                 | `DropVisualState`                         |
| Particles | a fixed pool of 320 (`ring`, `spark`, `streak`, `block`), normalized coordinates                                   | `DropVisualState`, `StageFX`              |
| Silence   | `isSilent` (true when RMS is below -100 dB and no band exceeds 0.002)                                              | replaces Data Beats' per-view `live` test |

Without a `MusicContext`, `energy` falls back to `level`, the section is
`.intro`, wobble values are 0, hits come from the low-band onset detector
`DropVisualState` already has for sparse engines, and the clock runs on wall
time at the last known tempo (`beatPulse` is 0).

### Rules

1. **Idempotent per display frame.** `update` returns immediately if `now` is
   within 2 ms of the last update, so the stage, the button and the meters can
   all call it. `dt` is clamped to 0.1 s.
2. **Never allocates.** Every buffer, the particle pool and the history rings
   are allocated in `init`. Nothing in `update` builds an array, string, closure
   or `Set`. Enforced by a test (section 7).
3. **`now` is passed in**, never read from a clock inside the state. Live views
   pass `CACurrentMediaTime()`; the offline renderer passes its own tick time,
   which is how Wirewatcher renders video today.
4. **Stale gap.** An update more than 0.5 s after the last one (the view was
   hidden) skips the backlog instead of replaying it.
5. **Deterministic.** The only randomness is a seeded xorshift, so a fixed frame
   sequence yields a fixed state, which is what makes golden images possible.
6. **No app concepts.** Traffic sprites, logo pulses, `pendingPulses` and
   `trafficIntensity` are Wirewatcher's and move to a Wirewatcher-owned
   `TrafficLogoState` that reads the same clock (`stepPosition`, `beats`). The
   Data Beats data comet and `PlayheadClock` stay in the app.

## 4. Polling, ordering and thread rules

- **Poll, never observe.** Frames are read on the visualizer's own
  `TimelineView` or `MTKView` clock. Observing a frame property re-runs SwiftUI
  bodies at 60 Hz (Wirewatcher #65). `DropEngine.latestFrame` is already
  `@ObservationIgnored`.
- **`sequence` replaces `FrameSignature`.** Wirewatcher builds a hash of six
  fields per update to ask "is this a new frame?", and Data Beats' `StageFX`
  compares whole frames (`frame != lastHitFrame`). Both become
  `sequence != last`.
- **Hit coalescing.** `DropEngine` publishes a frame by overwriting
  `latestFrame` with `hits: core.takeHits()`. A frame overwritten before it is
  read takes its hits with it: a visualizer that polls at 60 Hz against a 60 Hz
  publish timer on a separate phase drops a kick now and then. Data Beats' pads
  read `latestFrame.hits` directly and have this today. The contract: frames
  reach consumers through a `SoundMailbox<Value>` (NardukSoundAnalysis), a
  latest-value box whose `publish` merges instead of overwriting when the
  previous value was never taken (`hits` OR-ed, `peakDB` the max, the newer
  `sequence`), and whose `take()` returns the value once. The merge is a closure
  the producer supplies, because Analysis cannot name `MusicContext`.
- **Analysis runs off the audio thread**, fed through the lock-free `SPSCRing`
  that exists in `NardukMusicDSP` (the audio thread pushes samples, the analysis
  side pops them). The mailbox may take a lock because neither of its sides is
  the render thread.
- **Frames may allocate** (two small arrays at 60 Hz, off the render thread);
  `SoundVisualState.update` may not.
- **Offline.** An offline renderer produces frames on its own timeline (`time`
  from samples rendered) and passes its own `now`. The same visualizers draw a
  render and a live session.

## 5. Render budget

One place decides how fast the visuals animate, taken from Wirewatcher's
`DropFrameRate` (written after the 2026-10-06 WindowServer watchdog panic on a
hot 120 Hz display):

```swift
public enum SoundRenderBudget {
    public static let normal = 60
    public static let reduced = 30
    /// 0 means paused: hold the last frame, schedule nothing.
    public static func framesPerSecond(isVisible: Bool, thermal: ProcessInfo.ThermalState,
                                       lowPowerMode: Bool) -> Int
    public static func schedule(_ fps: Int, cap: Int = normal) -> AnimationTimelineSchedule
}
extension EnvironmentValues { @Entry public var soundFramesPerSecond: Int }
```

- 60 fps is the cap on every display, 120 Hz included. The visuals are soft
  glows and beat-locked motion.
- Not visible means 0: minimized, fully occluded or on another Space on macOS;
  scene not `.active` on iOS.
- `.serious` thermal state means 30, `.critical` means 0. On iOS, Low Power Mode
  also means 30.
- The environment value is set by the host view; views take their rate from it
  and never from the display.
- Visibility reporting is platform glue behind `#if canImport(AppKit)` /
  `#if canImport(UIKit)` (Wirewatcher's `WindowVisibilityReader` is AppKit only;
  the iOS twin reads `scenePhase`). The Metal tunnel gets a
  `UIViewRepresentable` twin and keeps `TunnelDrawableSizer` (cap 2560 x 1440
  pixels, reallocate only after the size holds still for 150 ms).

## 6. Palette

Visualizers take a palette and never name a color. Apps supply theirs.

```swift
public struct SoundPalette: Equatable, Sendable {
    public var c0: SIMD3<Float>, c1: SIMD3<Float>, c2: SIMD3<Float>   // the three neon colors, linear 0 ... 1
    public func mixed(with: SoundPalette, _ t: Float) -> SoundPalette
    public func saturated(_ amount: Float) -> SoundPalette
    public func sample(_ t: Float) -> SIMD3<Float>                    // cyclic c0 -> c1 -> c2 -> c0
}
public protocol SoundPaletteProvider: Sendable {
    func palette(for section: SongSection?) -> SoundPalette           // nil when there is no MusicContext
}
```

Blend, saturation and cyclic sampling are Wirewatcher's `DropPalette`, lifted
unchanged. The section-to-palette table is the app's: Wirewatcher's
`SongSection.palette` and Data Beats' `Neon.section` (one hue per section)
become two providers. Data Beats gives `c1` its section hue and picks `c0` and
`c2` as neighbors, so its Canvas code reads `palette.c1` where it read
`Neon.section(...)`. Chrome (backgrounds, grid, text) stays in the app; only
series colors come from the palette. The gallery ships a default provider.

## 7. Proof

Written into the package, not folklore (the precedents are in
`NardukMusicDSPTests` and `NardukMusicRenderTests`):

- **Golden images.** A fixed `SoundFrame` + `MusicContext` sequence, a fixed
  seed and a fixed `now` series render each visualizer to an image compared
  against a committed golden (per platform, as the render goldens are).
- **No-allocation tests** on `SoundVisualState.update` and on each visualizer's
  draw-state path, in a release build, following `RenderThreadAllocationTests`.
- **Idempotence test:** two `update` calls inside 2 ms leave every output
  unchanged.
- **Mailbox tests:** a burst of publishes before one `take` returns the OR of
  all hits and the newest sequence.
- **Analyzer tests** on synthetic signals (A2): a sine lands in the right band,
  silence reads -120 dB.

## 8. Audit

Sources read (origin/main, 2026-10-06): data-beats `902d4e6`,
`App/Sources/Visuals/**`; wirewatcher `4c7d38f`, `App/Sources/Views/Drop/**`.
The bodies of the Data Beats data charts (`AnalysisCharts`, `DataScoreView`,
`LiveScoreView`, `MatrixViews`, `PhaseViews`) take no `VisualizerFrame` or
engine state; they are data views and stay in the app.

### Overlap

| Concern       | Data Beats                               | Wirewatcher                         | Shared form                               |
| ------------- | ---------------------------------------- | ----------------------------------- | ----------------------------------------- |
| Spectrum bars | `SpectrumBarsView`, `SpectrumCaps`       | `DropRenderers.mirror`, `peaks`     | `spectrum`, `peaks`                       |
| Waveform      | `OscilloscopeView`, Stage waveform ring  | `phosphor`, `history`               | `waveform`, `history`                     |
| Wobble        | `WobbleMeterView` (dial: phase + cutoff) | tunnel uniforms, `halo`             | `wobblePhase`, `wobbleCutoff`             |
| Meters        | `MeterState` (-60 ... 0 dB)              | `level` (-48 ... 0 dB)              | `peak`, `rms`, `level`                    |
| Hit flash     | `PadState`, `StageFX` particles          | kick/snare/hat envelopes, particles | `padBrightness`, envelopes, particle pool |
| Section color | `Neon.section`                           | `SongSection.palette`               | `SoundPaletteProvider`                    |
| Frame budget  | `TimelineView(.animation)` uncapped      | `DropFrameRate`                     | `SoundRenderBudget`                       |
| Stage orb     | `StageView` (spectrum ring, core, comet) | `DropStage` (+ HUD, logos)          | visualizer plus app overlay               |

Data Beats redraws on `TimelineView(.animation)` at the display rate with no cap
and no visibility pause; moving it onto `SoundRenderBudget` is a behavior change
it gains for free (A7).

### Fields each visualizer needs, against the contract

| Visualizer                         | Reads                                                                             | In the contract                   |
| ---------------------------------- | --------------------------------------------------------------------------------- | --------------------------------- |
| Data Beats spectrum, scope         | spectrum, waveform, section                                                       | yes                               |
| Data Beats wobble meter            | wobblePhase, wobbleCutoff, peakDB, rmsDB, section                                 | yes                               |
| Data Beats pads                    | hits per frame                                                                    | yes, once hits coalesce (G4)      |
| Data Beats stage orb               | spectrum, waveform, hits, section, energy; data comet and playhead                | audio side yes; comet is app-side |
| Wirewatcher mirror, halo, phosphor | spectrum, peaks, history, palette, kick, flash, chroma, shake, travel, beat clock | yes                               |
| Wirewatcher Metal tunnel           | the above plus snare, hat, impact, glitch, wild, dropAmount, barPhase, wobble     | yes                               |

### Gaps found, and what the contract does about each

| #   | Gap                                                                                                                                | Resolution                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | The beat clock needs the tempo (`settings.secondsPerStep`); the plan's `MusicContext` has none                                     | added `secondsPerStep`                                                                                                                                                                                  |
| G2  | The tunnel's build speed needs `phraseProgress`, computed from `settings.stepsPerPhrase`                                           | added `phraseProgress`                                                                                                                                                                                  |
| G3  | `isRunning` gates the clock and `beatPulse`; it belongs to the source, not the audio                                               | `SoundVisualInput.isRunning`                                                                                                                                                                            |
| G4  | Hits are lost when a frame is overwritten before it is read (engine and Data Beats pads)                                           | mailbox coalescing, section 4                                                                                                                                                                           |
| G5  | `calm` (reduced motion) is an app switch                                                                                           | `SoundVisualOptions.calm`                                                                                                                                                                               |
| G6  | `wild` mixes live traffic into the stage                                                                                           | `SoundVisualOptions.intensity`; traffic itself stays in Wirewatcher                                                                                                                                     |
| G7  | `DropVisualState` is also the logo-sprite scheduler                                                                                | split out to a Wirewatcher `TrafficLogoState` (A4 lifts the rest)                                                                                                                                       |
| G8  | Wirewatcher hard-codes 4 steps per beat and 16 per bar                                                                             | stated in the contract; add `stepsPerBar` if `SongSettings.stepsPerBar` is ever varied                                                                                                                  |
| G9  | Two peak-cap, pad and meter constant sets                                                                                          | `SoundVisualConfiguration`                                                                                                                                                                              |
| G10 | The stage fades in only when `live` (spectrum max > 0.002)                                                                         | `SoundVisualState.isSilent`                                                                                                                                                                             |
| G11 | No iOS visibility report                                                                                                           | `SoundRenderBudget` platform glue, section 5                                                                                                                                                            |
| G12 | Data Beats' `EnergyTimelineView` draws the build and drop thresholds and a per-step section history; the contract has neither      | **open.** The timeline is not in the A5 port list. When it ports, add `buildThreshold` and `dropThreshold` to `MusicContext` and a section ring beside `energyHistory`                                  |
| G13 | `SpectrumAnalyzer` already smooths (attack 0.65, release 0.12 per frame) and `DropVisualState` smooths again (34 and 8 per second) | open, for A2 and A4: either the analyzer emits raw bands and the state owns smoothing, or the state's smoothing is configurable down to none. Default until decided: configurable, Wirewatcher's values |

HUD text (section title, bar.beat, BPM, wobble rate, legend, track,
`dropQueued`) is not visualizer input. Apps keep reading `ConductorSnapshot` for
it.

Everything either app draws from the engine is covered once G1 to G11 are
applied. G12 and G13 are the only open items, and neither blocks A2, A3 or A4.

## 9. Which lane does what

| Phase       | Reads this document for                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| A2 analysis | `SoundFrame`, `SoundMailbox`, the analyzer move, the tap source, G13                           |
| A3 sonify   | the `NardukSonify` boundary: it emits `MusicSignal`s only and knows nothing of frames          |
| A4 gallery  | `SoundVisualState`, `SoundVisualInput`/`Options`, palette, budget, G7                          |
| A5 port     | the overlap table, `SoundVisualConfiguration` (so the ports look unchanged)                    |
| A6 music    | `MusicContext`, `InstrumentSet`, publishing through the mailbox, the `VisualizerFrame` adapter |
| A7, A8      | what each app deletes and what it keeps (G7, G12)                                              |
