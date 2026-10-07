import Foundation
import NardukMusicCore

/// One sampled singer: reads a clip from the `SampleBank` at a rate that pitches it to the note (a sustain loops
/// between its loop points until the gate ends; a chop or a run plays once), with Hermite interpolation, a short attack
/// and a release. No allocation: plain value state over the bank's immutable memory.
struct SampleVoice: @unchecked Sendable {
    private(set) var active = false
    private var bank: UnsafeMutablePointer<Float>?
    private var offset = 0
    private var count = 0
    private var loopStart = 0
    private var loopEnd = 0
    private var looping = false
    private var position = 0.0
    private var rate = 1.0
    private var gain: Float = 0
    private var panL: Float = 0.7071
    private var panR: Float = 0.7071
    private var gateLeft = 0
    private var envelope: Float = 0
    private var attackStep: Float = 0.01
    private var releaseStep: Float = 0.001
    private var stealStep: Float = 0
    private(set) var age = 0

    /// Starts `clip` for `gateSamples`. `rate` is source samples per output sample (pitch and sample-rate ratio).
    mutating func trigger(
        bank samples: SampleBank, clip: Int, rate: Double, gateSamples: Int, velocity: Float, gain trim: Float,
        pan: Float, engineRate: Float
    ) {
        let c = samples.clips[clip]
        bank = samples.pcm
        offset = c.offset
        count = c.count
        loopStart = c.loopStart
        loopEnd = c.loopEnd
        looping = c.kind == .sustain
        position = 0
        self.rate = rate
        gain = (0.35 + 0.65 * velocity) * trim * 1.6
        let angle = (min(max(pan, -1), 1) + 1) * Float.pi / 4
        panL = cosf(angle)
        panR = sinf(angle)
        gateLeft = max(gateSamples, 1)
        envelope = 0
        let attack: Float = c.kind == .sustain ? 0.03 : (c.kind == .chop ? 0.002 : 0.004)
        let release: Float = c.kind == .sustain ? 0.14 : (c.kind == .chop ? 0.03 : 0.05)
        attackStep = 1 / max(attack * engineRate, 1)
        releaseStep = 1 / max(release * engineRate, 1)
        stealStep = 0
        age = 0
        active = true
    }

    /// Fades out quickly so a new note can take the slot without a click.
    mutating func steal(engineRate: Float) { stealStep = 1 / max(0.004 * engineRate, 1) }

    private func read(_ i: Int) -> Float {
        guard let bank else { return 0 }
        var j = i
        if looping && j >= loopEnd { j = loopStart + (j - loopEnd) % (loopEnd - loopStart) }
        return bank[offset + min(max(j, 0), count - 1)]
    }

    mutating func next() -> (Float, Float) {
        guard active else { return (0, 0) }
        age += 1
        let i = Int(position)
        let t = Float(position - Double(i))
        let p0 = read(i - 1)
        let p1 = read(i)
        let p2 = read(i + 1)
        let p3 = read(i + 2)
        // Catmull-Rom between p1 and p2.
        let a = -0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3
        let b = p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3
        let c = -0.5 * p0 + 0.5 * p2
        let s = ((a * t + b) * t + c) * t + p1
        position += rate
        if looping {
            if position >= Double(loopEnd) { position -= Double(loopEnd - loopStart) }
        } else if position >= Double(count - 1) {
            active = false
        }
        if gateLeft > 0 {
            gateLeft -= 1
            envelope = min(envelope + attackStep, 1)
        } else {
            envelope -= releaseStep
        }
        if stealStep > 0 { envelope -= stealStep }
        if envelope <= 0 && gateLeft <= 0 { active = false }
        let out = s * gain * max(envelope, 0)
        return (out * panL, out * panR)
    }
}
