#if canImport(SwiftUI)
    import SwiftUI

    // Lissajous ribbons: three smooth closed curves, one per palette color, each with three fading copies behind it.
    // Bass picks the slow frequency, mids the width, highs a shimmer along the edge, and the waveform and level the
    // size. A beat blooms the stroke and the glow; calm slows the spin and drops that bloom. Not the phosphor scope,
    // which plots the waveform against itself.

    @MainActor extension SoundVisualizers {
        static let lissajousRibbonCount = 3
        static let lissajousTrailCount = 3
        static let lissajousLivePoints = 40
        static let lissajousTrailPoints = 30

        /// Mean of `spectrum[start..<end]`, or 0 when the range is empty. A fold, no array.
        static func lissajousBandMean(_ spectrum: UnsafeBufferPointer<Float>, from start: Int, to end: Int) -> Float {
            let upper = min(end, spectrum.count)
            guard start < upper else { return 0 }
            var sum: Float = 0
            var index = start
            while index < upper {
                sum += spectrum[index]
                index += 1
            }
            return sum / Float(upper - start)
        }

        /// The two integer frequencies of one ribbon. Bass (0...1) sets the slower one: 1 when the bass is quiet,
        /// 2 when it is loud. Each ribbon keeps its own pairing, and neither frequency goes above 3.
        static func lissajousFrequencies(bass: Float, ribbon: Int) -> (a: Int, b: Int) {
            let clamped = min(max(bass, 0), 1)
            let slow = 1 + Int((clamped * 1.999).rounded(.down))
            switch min(max(ribbon, 0), lissajousRibbonCount - 1) {
            case 0: return (slow, slow + 1)
            case 1: return (slow + 1, slow)
            default: return slow == 1 ? (1, 3) : (3, 1)
            }
        }

        static func lissajousMotion(_ calm: Bool) -> Double { calm ? 0.4 : 1 }

        /// How far the beat opens the ribbon. Calm removes the peak, so the stroke stays at its resting width.
        static func lissajousBloom(beatPulse: Float, kick: Float, calm: Bool) -> Float {
            if calm { return 0 }
            return min(1, max(0, max(beatPulse, kick)))
        }

        /// Spin, the twist through the beat, and how far the older copies lag. The per-ribbon offset is fixed.
        static func lissajousPhase(time: Double, beatPhase: Float, ribbon: Int, age: Int, motion: Double) -> Double {
            let moving = (time * 0.45 + Double(beatPhase) * 1.1 - Double(max(age, 0)) * 0.26) * motion
            return moving + Double(ribbon) * (2 * Double.pi / 3)
        }

        /// Horizontal scale of the figure, from the mids.
        static func lissajousWidth(mids: Float) -> Float {
            0.66 + min(max(mids, 0), 1) * 0.48
        }

        /// How far the edge leaves the curve, from the highs. 0 when the top bands are quiet.
        static func lissajousShimmer(highs: Float) -> Float {
            min(max(highs, 0), 1) * 0.075
        }

        static func lissajousRibbonScale(_ ribbon: Int) -> Float {
            switch min(max(ribbon, 0), lissajousRibbonCount - 1) {
            case 0: 1
            case 1: 0.86
            default: 0.74
            }
        }

        /// Size of the curve from the level, with the waveform pulling a single point in or out. Never collapses.
        static func lissajousAmplitude(level: Float, wave: Float, ribbonScale: Float) -> Float {
            let loud = min(max(level, 0), 1)
            let sample = min(max(wave, -1), 1)
            return (0.62 + 0.38 * loud) * (0.88 + 0.12 * sample) * ribbonScale
        }

        static func lissajousRibbonColor(_ ribbon: Int, _ palette: SoundPalette) -> SIMD3<Float> {
            switch min(max(ribbon, 0), lissajousRibbonCount - 1) {
            case 0: palette.c0
            case 1: palette.c1
            default: palette.c2
            }
        }

        static func lissajousStrokeWidth(bloom: Float, age: Int) -> CGFloat {
            if age > 0 { return 1.8 }
            return 2.4 + CGFloat(min(max(bloom, 0), 1)) * 2.0
        }

        static func lissajousGlow(bloom: Float) -> CGFloat {
            0.55 + CGFloat(min(max(bloom, 0), 1)) * 0.7
        }

        static func lissajousTrailOpacity(_ age: Int) -> Double {
            switch age {
            case 1: 0.38
            case 2: 0.2
            default: 0.1
            }
        }

        /// Half-extent of the figure. The beat adds a few percent; it does not fill the stage.
        static func lissajousRadius(minSide: CGFloat, bloom: Float) -> CGFloat {
            minSide * 0.35 * (1 + 0.06 * CGFloat(min(max(bloom, 0), 1)))
        }

        /// A wide or tall stage stretches the figure along the long axis so the knot fills the card.
        static func lissajousStretch(_ size: CGSize) -> CGSize {
            let width = max(size.width, 1)
            let height = max(size.height, 1)
            return CGSize(width: min(max(width / height, 1), 1.48), height: min(max(height / width, 1), 1.15))
        }

        static func lissajousScreen(_ unit: CGPoint, center: CGPoint, radius: CGFloat, stretch: CGSize) -> CGPoint {
            CGPoint(
                x: center.x + unit.x * radius * stretch.width, y: center.y + unit.y * radius * stretch.height)
        }

        /// One sample of `x = sin(a t + phase)`, `y = sin(b t)`, widened by `width` and nudged along the normal by
        /// `shimmer`. Unit space, before the stage radius.
        static func lissajousPoint(
            index: Int, count: Int, a: Int, b: Int, phase: Double, amplitude: Float, width: Float, shimmer: Float
        ) -> CGPoint {
            let steps = max(count, 1)
            let t = Double(index) / Double(steps) * 2 * Double.pi
            let ax = Double(a) * t + phase
            let by = Double(b) * t
            let dx = cos(ax) * Double(a)
            let dy = cos(by) * Double(b)
            let len = (dx * dx + dy * dy).squareRoot()
            let edge = sin(Double(b + 5) * t + phase) * Double(shimmer)
            let nx = len > 1e-3 ? -dy / len * edge : 0
            let ny = len > 1e-3 ? dx / len * edge : 0
            let scale = Double(amplitude)
            return CGPoint(x: (sin(ax) * Double(width) + nx) * scale, y: (sin(by) + ny) * scale)
        }

        /// Waveform sample for this point. Age 0 is the live wave; older copies read the history ring.
        static func lissajousSample(
            _ waveform: UnsafeBufferPointer<Float>, _ history: UnsafeBufferPointer<Float>, historyHead: Int,
            historyCount: Int, age: Int, index: Int, count: Int
        ) -> Float {
            let liveCount = waveform.count
            guard liveCount > 0, count > 0 else { return 0 }
            let at = min(liveCount - 1, index * liveCount / count)
            let depth = SoundVisualState.historyDepth
            let lag = min(max(age, 0), max(historyCount, 0))
            let stored = SoundVisualState.sampleCount
            guard lag > 0, history.count >= depth * stored, at < stored else { return waveform[at] }
            let slot = ((historyHead - lag) % depth + depth) % depth
            let base = slot * stored
            guard base + at < history.count else { return waveform[at] }
            return history[base + at]
        }

        static func lissajousRibbons(
            _ ctx: inout GraphicsContext, _ size: CGSize, _ s: SoundVisualState, _ style: SoundVisualizerStyle
        ) {
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let rect = CGRect(origin: .zero, size: size)
            ctx.fill(Path(rect), with: .color(style.stage))
            ctx.fill(
                Path(rect),
                with: .radialGradient(
                    Gradient(colors: [
                        SoundCanvas.color(s.palette.c1, 0.045 + 0.07 * Double(s.energy)), .clear,
                    ]), center: center, startRadius: 0, endRadius: max(size.width, size.height) * 0.62))

            let motion = lissajousMotion(s.calm)
            let bloom = lissajousBloom(beatPulse: s.beatPulse, kick: s.kick, calm: s.calm)
            let bass = lissajousBandMean(s.spectrum, from: 0, to: 10)
            let mids = lissajousBandMean(s.spectrum, from: 10, to: 36)
            let highs = lissajousBandMean(s.spectrum, from: 36, to: 64)
            let width = lissajousWidth(mids: mids)
            let shimmer = lissajousShimmer(highs: highs)
            let radius = lissajousRadius(minSide: min(size.width, size.height), bloom: bloom)
            let stretch = lissajousStretch(size)
            let waveform = s.waveform
            let history = s.history

            var age = lissajousTrailCount
            while age >= 0 {
                let steps = age == 0 ? lissajousLivePoints : lissajousTrailPoints
                var ribbon = 0
                while ribbon < lissajousRibbonCount {
                    let freq = lissajousFrequencies(bass: bass, ribbon: ribbon)
                    let phase = lissajousPhase(
                        time: s.time, beatPhase: s.beatPhase, ribbon: ribbon, age: age, motion: motion)
                    let path = lissajousRibbonPath(
                        steps: steps, a: freq.a, b: freq.b, phase: phase, level: s.level,
                        ribbonScale: lissajousRibbonScale(ribbon), width: width, shimmer: shimmer,
                        waveform: waveform, history: history, historyHead: s.historyHead,
                        historyCount: s.historyCount, age: age, center: center, radius: radius, stretch: stretch)
                    let rgb = lissajousRibbonColor(ribbon, s.palette)
                    if age == 0 {
                        ctx.soundGlowStroke(
                            path, color: SoundCanvas.color(rgb), width: lissajousStrokeWidth(bloom: bloom, age: 0),
                            glow: lissajousGlow(bloom: bloom), opacity: 0.72, hot: 0.14 + Double(bloom) * 0.08)
                    } else {
                        var trail = ctx
                        trail.blendMode = .plusLighter
                        trail.stroke(
                            path, with: .color(SoundCanvas.color(rgb, lissajousTrailOpacity(age))),
                            style: StrokeStyle(
                                lineWidth: lissajousStrokeWidth(bloom: bloom, age: age), lineCap: .round,
                                lineJoin: .round))
                    }
                    ribbon += 1
                }
                age -= 1
            }
        }

        private static func lissajousRibbonPath(
            steps: Int, a: Int, b: Int, phase: Double, level: Float, ribbonScale: Float, width: Float,
            shimmer: Float, waveform: UnsafeBufferPointer<Float>, history: UnsafeBufferPointer<Float>,
            historyHead: Int, historyCount: Int, age: Int, center: CGPoint, radius: CGFloat, stretch: CGSize
        ) -> Path {
            var path = Path()
            let count = max(steps, 1)
            var index = 0
            while index < count {
                let wave = lissajousSample(
                    waveform, history, historyHead: historyHead, historyCount: historyCount, age: age, index: index,
                    count: count)
                let unit = lissajousPoint(
                    index: index, count: count, a: a, b: b, phase: phase,
                    amplitude: lissajousAmplitude(level: level, wave: wave, ribbonScale: ribbonScale), width: width,
                    shimmer: shimmer)
                let screen = lissajousScreen(unit, center: center, radius: radius, stretch: stretch)
                if index == 0 { path.move(to: screen) } else { path.addLine(to: screen) }
                index += 1
            }
            path.closeSubpath()
            return path
        }
    }
#endif
