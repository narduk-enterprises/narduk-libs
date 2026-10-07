#if canImport(SwiftUI)
    import NardukMusicCore
    import NardukSoundAnalysis
    import SwiftUI
    import Testing

    @testable import NardukSoundVisuals

    /// Geometry, sound reactivity and the calm rule for the Lissajous ribbons. The draw function stays a pure
    /// function of `SoundVisualState`; these tests call the same helpers it does.
    @MainActor @Suite struct LissajousRibbonsCanvasesTests {
        @Test func thePictureStaysWithinAFewHundredPoints() {
            let points =
                SoundVisualizers.lissajousRibbonCount
                * (SoundVisualizers.lissajousLivePoints
                    + SoundVisualizers.lissajousTrailCount * SoundVisualizers.lissajousTrailPoints)
            #expect(points >= 200)
            #expect(points <= 400)
        }

        @Test func bandMeansAreFoldsOverBassMidsAndHighs() {
            var bands = [Float](repeating: 0, count: SoundFrame.spectrumCount)
            for index in 0..<10 { bands[index] = 0.5 }
            for index in 10..<36 { bands[index] = 0.25 }
            for index in 36..<bands.count { bands[index] = 1 }
            bands.withUnsafeBufferPointer { spectrum in
                #expect(SoundVisualizers.lissajousBandMean(spectrum, from: 0, to: 10) == 0.5)
                #expect(SoundVisualizers.lissajousBandMean(spectrum, from: 10, to: 36) == 0.25)
                #expect(SoundVisualizers.lissajousBandMean(spectrum, from: 36, to: 64) == 1)
                #expect(SoundVisualizers.lissajousBandMean(spectrum, from: 5, to: 5) == 0)
            }
        }

        @Test func bassSetsTheSlowFrequencyAndEachRibbonHasItsOwnRatio() {
            let quiet = SoundVisualizers.lissajousFrequencies(bass: 0, ribbon: 0)
            let mid = SoundVisualizers.lissajousFrequencies(bass: 0.49, ribbon: 0)
            let loud = SoundVisualizers.lissajousFrequencies(bass: 1, ribbon: 0)
            #expect(quiet == (a: 1, b: 2))
            #expect(mid == quiet)
            #expect(loud == (a: 2, b: 3))
            #expect(SoundVisualizers.lissajousFrequencies(bass: 0, ribbon: 1) == (a: 2, b: 1))
            #expect(SoundVisualizers.lissajousFrequencies(bass: 0, ribbon: 2) == (a: 1, b: 3))
            #expect(SoundVisualizers.lissajousFrequencies(bass: 1, ribbon: 1) == (a: 3, b: 2))
            #expect(SoundVisualizers.lissajousFrequencies(bass: 1, ribbon: 2) == (a: 3, b: 1))
            #expect(SoundVisualizers.lissajousFrequencies(bass: -1, ribbon: 0) == quiet)
            #expect(SoundVisualizers.lissajousFrequencies(bass: 4, ribbon: 0) == loud)
            for bass in [Float(0), 0.2, 1] {
                let ratios = (0..<3).map { SoundVisualizers.lissajousFrequencies(bass: bass, ribbon: $0) }
                #expect(ratios[0] != ratios[1] && ratios[1] != ratios[2] && ratios[0] != ratios[2])
                for ratio in ratios {
                    #expect(ratio.a >= 1 && ratio.b >= 1)
                    #expect(max(ratio.a, ratio.b) <= 3)
                }
            }
        }

        @Test func midsSetTheWidthAndHighsShimmerOnlyTheEdge() {
            #expect(SoundVisualizers.lissajousWidth(mids: 0) < SoundVisualizers.lissajousWidth(mids: 1))
            #expect(SoundVisualizers.lissajousWidth(mids: 0) >= 0.6)
            #expect(SoundVisualizers.lissajousWidth(mids: 1) <= 1.2)
            #expect(SoundVisualizers.lissajousShimmer(highs: 0) == 0)
            #expect(SoundVisualizers.lissajousShimmer(highs: 1) > SoundVisualizers.lissajousShimmer(highs: 0.2))

            let count = SoundVisualizers.lissajousLivePoints
            var widened = false
            var peakNudge: CGFloat = 0
            for index in 0..<count {
                let narrow = SoundVisualizers.lissajousPoint(
                    index: index, count: count, a: 2, b: 3, phase: 0.3, amplitude: 1, width: 0.66, shimmer: 0)
                let wide = SoundVisualizers.lissajousPoint(
                    index: index, count: count, a: 2, b: 3, phase: 0.3, amplitude: 1, width: 1.14, shimmer: 0)
                #expect(abs(wide.y - narrow.y) < 0.000_001)
                if abs(wide.x) > abs(narrow.x) + 0.02 { widened = true }
                let edged = SoundVisualizers.lissajousPoint(
                    index: index, count: count, a: 2, b: 3, phase: 0.3, amplitude: 1, width: 1, shimmer: 0.075)
                let plain = SoundVisualizers.lissajousPoint(
                    index: index, count: count, a: 2, b: 3, phase: 0.3, amplitude: 1, width: 1, shimmer: 0)
                peakNudge = max(peakNudge, hypot(edged.x - plain.x, edged.y - plain.y))
            }
            #expect(widened)
            #expect(peakNudge > 0.02 && peakNudge < 0.08)
        }

        @Test func amplitudeFollowsLevelAndTheWaveAndNeverCollapses() {
            let quiet = SoundVisualizers.lissajousAmplitude(level: 0, wave: 0, ribbonScale: 1)
            let loud = SoundVisualizers.lissajousAmplitude(level: 1, wave: 1, ribbonScale: 1)
            let dipped = SoundVisualizers.lissajousAmplitude(level: 1, wave: -1, ribbonScale: 1)
            #expect(quiet > 0.4)
            #expect(loud > quiet * 1.5)
            #expect(dipped < loud)
            #expect(dipped > 0.4)
        }

        @Test func ribbonPointsStayInsideAShortCardAndAPortraitPhone() {
            let sizes = [
                CGSize(width: 393, height: 160), CGSize(width: 393, height: 852), CGSize(width: 480, height: 270),
            ]
            for size in sizes {
                let radius = SoundVisualizers.lissajousRadius(minSide: min(size.width, size.height), bloom: 1)
                let stretch = SoundVisualizers.lissajousStretch(size)
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                for ribbon in 0..<SoundVisualizers.lissajousRibbonCount {
                    let freq = SoundVisualizers.lissajousFrequencies(bass: 1, ribbon: ribbon)
                    let count = SoundVisualizers.lissajousLivePoints
                    for index in 0..<count {
                        let unit = SoundVisualizers.lissajousPoint(
                            index: index, count: count, a: freq.a, b: freq.b, phase: 1.2,
                            amplitude: SoundVisualizers.lissajousAmplitude(
                                level: 1, wave: 1, ribbonScale: SoundVisualizers.lissajousRibbonScale(ribbon)),
                            width: SoundVisualizers.lissajousWidth(mids: 1),
                            shimmer: SoundVisualizers.lissajousShimmer(highs: 1))
                        let screen = SoundVisualizers.lissajousScreen(
                            unit, center: center, radius: radius, stretch: stretch)
                        #expect(screen.x > 8 && screen.x < size.width - 8, "x \(screen.x) in \(size)")
                        #expect(screen.y > 8 && screen.y < size.height - 8, "y \(screen.y) in \(size)")
                        #expect(screen.x.isFinite && screen.y.isFinite)
                    }
                }
            }
        }

        @Test func anOlderCopyReadsTheHistoryRing() {
            let samples = SoundFrame.waveformCount
            var wave = [Float](repeating: 0.2, count: samples)
            wave[0] = 0.2
            var history = [Float](repeating: 0, count: samples * SoundVisualState.historyDepth)
            let head = 2
            let previous = (head - 1 + SoundVisualState.historyDepth) % SoundVisualState.historyDepth
            history[previous * samples] = -0.55
            let older = wave.withUnsafeBufferPointer { live in
                history.withUnsafeBufferPointer { past in
                    SoundVisualizers.lissajousSample(
                        live, past, historyHead: head, historyCount: 4, age: 1, index: 0, count: 40)
                }
            }
            let live = wave.withUnsafeBufferPointer { live in
                history.withUnsafeBufferPointer { past in
                    SoundVisualizers.lissajousSample(
                        live, past, historyHead: head, historyCount: 4, age: 0, index: 0, count: 40)
                }
            }
            #expect(older == -0.55)
            #expect(live == 0.2)
        }

        @Test func eachRibbonTakesOnePaletteColor() {
            let palette = SoundPalette(c0: SIMD3(0.1, 0.2, 0.3), c1: SIMD3(0.4, 0.5, 0.6), c2: SIMD3(0.7, 0.8, 0.9))
            #expect(SoundVisualizers.lissajousRibbonColor(0, palette) == palette.c0)
            #expect(SoundVisualizers.lissajousRibbonColor(1, palette) == palette.c1)
            #expect(SoundVisualizers.lissajousRibbonColor(2, palette) == palette.c2)
        }

        @Test func calmSlowsTheSpinAndRemovesTheBloomPeak() {
            #expect(SoundVisualizers.lissajousMotion(true) == 0.4)
            #expect(SoundVisualizers.lissajousMotion(false) == 1)
            #expect(SoundVisualizers.lissajousBloom(beatPulse: 1, kick: 1, calm: true) == 0)
            #expect(SoundVisualizers.lissajousBloom(beatPulse: 0.25, kick: 0.8, calm: false) == 0.8)
            #expect(SoundVisualizers.lissajousBloom(beatPulse: 3, kick: 0, calm: false) == 1)
            let early = SoundVisualizers.lissajousPhase(time: 2, beatPhase: 0.25, ribbon: 1, age: 2, motion: 1)
            let later = SoundVisualizers.lissajousPhase(time: 8, beatPhase: 0.25, ribbon: 1, age: 2, motion: 1)
            let calmEarly = SoundVisualizers.lissajousPhase(time: 2, beatPhase: 0.25, ribbon: 1, age: 2, motion: 0.4)
            let calmLater = SoundVisualizers.lissajousPhase(time: 8, beatPhase: 0.25, ribbon: 1, age: 2, motion: 0.4)
            #expect(abs((calmLater - calmEarly) - (later - early) * 0.4) < 1e-9)
            let resting = SoundVisualizers.lissajousStrokeWidth(bloom: 0, age: 0)
            let peaked = SoundVisualizers.lissajousStrokeWidth(bloom: 1, age: 0)
            #expect(resting >= 1.5)
            #expect(peaked > resting + 1)
            #expect(peaked <= 5)
            #expect(SoundVisualizers.lissajousStrokeWidth(bloom: 1, age: 2) >= 1.5)
            #expect(SoundVisualizers.lissajousGlow(bloom: 1) > SoundVisualizers.lissajousGlow(bloom: 0))
            #expect(SoundVisualizers.lissajousGlow(bloom: 1) <= 1.5)
        }

        #if canImport(AppKit)
            @Test func theSameStateDrawsTwiceIdentically() throws {
                let state = CanvasVisualizerTests.busyState()
                let first = try CanvasVisualizerTests.grid(.lissajousRibbons, state)
                let second = try CanvasVisualizerTests.grid(.lissajousRibbons, state)
                #expect(CanvasVisualizerTests.drift(first, second) == 0)
            }

            @Test func loudRibbonsDifferFromSilenceInTheMiddleOfTheCard() throws {
                let loud = try CanvasVisualizerTests.grid(.lissajousRibbons, CanvasVisualizerTests.busyState())
                let quiet = try CanvasVisualizerTests.grid(
                    .lissajousRibbons, CanvasVisualizerTests.busyState(silent: true))
                #expect(CanvasVisualizerTests.drift(loud, quiet) > 1)
                #expect(Self.region(loud, rows: 3..<6, cols: 5..<11) > Self.region(quiet, rows: 3..<6, cols: 5..<11))
            }

            @Test func bassChangesTheFigureAndMidsSpreadItSideways() throws {
                let lowState = Self.shaped(bass: 0, mids: 0.4, highs: 0)
                let highState = Self.shaped(bass: 1, mids: 0.4, highs: 0)
                let low = try CanvasVisualizerTests.grid(.lissajousRibbons, lowState)
                let high = try CanvasVisualizerTests.grid(.lissajousRibbons, highState)
                #expect(CanvasVisualizerTests.drift(low, high) > 1, "bass did not change the figure")
                let lowBass = SoundVisualizers.lissajousBandMean(lowState.spectrum, from: 0, to: 10)
                let highBass = SoundVisualizers.lissajousBandMean(highState.spectrum, from: 0, to: 10)
                #expect(highBass > 0.8, "bass did not settle, mean \(highBass)")
                #expect(
                    SoundVisualizers.lissajousFrequencies(bass: highBass, ribbon: 0).a
                        > SoundVisualizers.lissajousFrequencies(bass: lowBass, ribbon: 0).a)

                let narrowState = Self.shaped(bass: 0.2, mids: 0, highs: 0)
                let wideState = Self.shaped(bass: 0.2, mids: 1, highs: 0)
                let narrow = try CanvasVisualizerTests.grid(.lissajousRibbons, narrowState)
                let wide = try CanvasVisualizerTests.grid(.lissajousRibbons, wideState)
                #expect(Self.horizontalMoment(wide) > Self.horizontalMoment(narrow) + 0.15)
            }

            @Test func aKickBloomsTheRibbonAndCalmDrawsWithoutThatPeak() throws {
                // Long enough that the low-band onset on the first loud frame has decayed, so only the
                // explicit kick is left.
                let resting = Self.shaped(bass: 0.8, mids: 0.5, highs: 0.3, kick: false, running: false, frames: 48)
                let hit = Self.shaped(bass: 0.8, mids: 0.5, highs: 0.3, kick: true, running: false, frames: 48)
                #expect(hit.kick > 0.5)
                #expect(resting.kick < 0.05)
                let calmHit = try CanvasVisualizerTests.grid(.lissajousRibbons, resting)
                let bloomed = try CanvasVisualizerTests.grid(.lissajousRibbons, hit)
                #expect(CanvasVisualizerTests.drift(calmHit, bloomed) > 0.4)

                let calm = Self.shaped(bass: 0.8, mids: 0.5, highs: 0.3, calm: true, kick: true, frames: 48)
                #expect(calm.calm)
                #expect(calm.kick > 0.5)
                #expect(
                    SoundVisualizers.lissajousBloom(beatPulse: calm.beatPulse, kick: calm.kick, calm: calm.calm) == 0)
                let picture = try CanvasVisualizerTests.grid(.lissajousRibbons, calm)
                #expect(picture.count == CanvasVisualizerTests.columns * CanvasVisualizerTests.rows)
                #expect(Self.region(picture, rows: 3..<6, cols: 5..<11) > Double(picture[0]) + 6)
                let moving = Self.shaped(bass: 0.8, mids: 0.5, highs: 0.3, calm: false, kick: true, frames: 48)
                let movingGrid = try CanvasVisualizerTests.grid(.lissajousRibbons, moving)
                #expect(CanvasVisualizerTests.drift(picture, movingGrid) > 1)
            }
        #endif

        #if canImport(Darwin)
            @Test(
                .enabled(if: SoundVisualStateAllocationTests.optimized, "allocation counts need swift test -c release"))
            func ribbonMathNeverAllocates() throws {
                let state = SoundVisualState(seed: 3)
                state.update(SoundVisualInput(frame: Script.frame(1), music: Script.music(step: 0, kicks: 1)), now: 1)
                state.update(
                    SoundVisualInput(frame: Script.frame(2), music: Script.music(step: 1, kicks: 1)), now: 1.02)
                // Warm the helpers before arming the counter.
                _ = Self.fold(state)
                var sink: Float = 0
                let count = try SoundVisualStateAllocationTests.countAllocations {
                    for _ in 0..<2_000 { sink += Self.fold(state) }
                }
                #expect(count == 0, "ribbon math allocated \(count) times")
                #expect(sink.isFinite)
            }
        #endif

        private static func fold(_ state: SoundVisualState) -> Float {
            let bass = SoundVisualizers.lissajousBandMean(state.spectrum, from: 0, to: 10)
            let mids = SoundVisualizers.lissajousBandMean(state.spectrum, from: 10, to: 36)
            let highs = SoundVisualizers.lissajousBandMean(state.spectrum, from: 36, to: 64)
            let motion = SoundVisualizers.lissajousMotion(state.calm)
            let bloom = SoundVisualizers.lissajousBloom(beatPulse: state.beatPulse, kick: state.kick, calm: state.calm)
            var sink = bass + mids + highs + Float(motion) + bloom + state.level
            var ribbon = 0
            while ribbon < SoundVisualizers.lissajousRibbonCount {
                let freq = SoundVisualizers.lissajousFrequencies(bass: bass, ribbon: ribbon)
                var age = 0
                while age <= SoundVisualizers.lissajousTrailCount {
                    let phase = SoundVisualizers.lissajousPhase(
                        time: state.time, beatPhase: state.beatPhase, ribbon: ribbon, age: age, motion: motion)
                    let points = age == 0 ? SoundVisualizers.lissajousLivePoints : SoundVisualizers.lissajousTrailPoints
                    var index = 0
                    while index < points {
                        let wave = SoundVisualizers.lissajousSample(
                            state.waveform, state.history, historyHead: state.historyHead,
                            historyCount: state.historyCount, age: age, index: index, count: points)
                        let amplitude = SoundVisualizers.lissajousAmplitude(
                            level: state.level, wave: wave, ribbonScale: SoundVisualizers.lissajousRibbonScale(ribbon))
                        let point = SoundVisualizers.lissajousPoint(
                            index: index, count: points, a: freq.a, b: freq.b, phase: phase, amplitude: amplitude,
                            width: SoundVisualizers.lissajousWidth(mids: mids),
                            shimmer: SoundVisualizers.lissajousShimmer(highs: highs))
                        sink += Float(point.x + point.y)
                        index += 1
                    }
                    age += 1
                }
                ribbon += 1
            }
            return sink
        }

        #if canImport(AppKit)
            private static func shaped(
                bass: Float, mids: Float, highs: Float, calm: Bool = false, kick: Bool = false, running: Bool = true,
                frames: Int = 24
            ) -> SoundVisualState {
                let state = SoundVisualState(seed: 9)
                var now = 20.0
                var counts = HitCounters()
                for index in 0..<frames {
                    var spectrum = [Float](repeating: 0, count: SoundFrame.spectrumCount)
                    for band in 0..<10 { spectrum[band] = bass }
                    for band in 10..<36 { spectrum[band] = mids }
                    for band in 36..<spectrum.count { spectrum[band] = highs }
                    var waveform = [Float](repeating: 0, count: SoundFrame.waveformCount)
                    for sample in 0..<waveform.count { waveform[sample] = sin(Float(sample) / 16) * 0.65 }
                    if kick, index == frames - 1 { counts.record(.kick) }
                    let frame = SoundFrame(
                        sequence: UInt64(index + 1), time: Double(index) / 60, spectrum: spectrum, waveform: waveform,
                        peakDB: -6, rmsDB: -12)
                    let music = MusicContext(
                        hitCounts: counts, step: index / 4, section: .drop, energy: 0.7, isRunning: running)
                    state.update(
                        SoundVisualInput(frame: frame, music: music), now: now, options: SoundVisualOptions(calm: calm))
                    now += 1.0 / 60
                }
                return state
            }

            private static func region(_ grid: [Int], rows: Range<Int>, cols: Range<Int>) -> Double {
                var sum = 0.0
                var count = 0
                for row in rows {
                    for col in cols {
                        sum += Double(grid[row * CanvasVisualizerTests.columns + col])
                        count += 1
                    }
                }
                return count > 0 ? sum / Double(count) : 0
            }

            /// Mean distance of luma from the center column, so a wider figure scores higher.
            private static func horizontalMoment(_ grid: [Int]) -> Double {
                var moment = 0.0
                var weight = 0.0
                let columns = CanvasVisualizerTests.columns
                for row in 0..<CanvasVisualizerTests.rows {
                    for col in 0..<columns {
                        let luma = Double(grid[row * columns + col])
                        moment += luma * abs(Double(col) - Double(columns - 1) / 2)
                        weight += luma
                    }
                }
                return weight > 0 ? moment / weight : 0
            }
        #endif
    }
#endif
