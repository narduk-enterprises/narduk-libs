import Foundation
import NardukMusicCore

/// Formant frequencies, bandwidths and levels for one vowel at one register (narduk-libs#1641). Three formants carry
/// the vowel; a fixed fourth adds the "air" of a voice. Values follow the classic alto and soprano tables.
struct VocalFormants: Sendable, Hashable, BitwiseCopyable {
    var f1: Float
    var f2: Float
    var f3: Float
    /// Linear levels of F1 ... F3, relative to F1 at 1.
    var a2: Float
    var a3: Float
    var bw1: Float
    var bw2: Float
    var bw3: Float

    private static func db(_ x: Float) -> Float { powf(10, x / 20) }

    private static let alto: [VocalFormants] = [
        VocalFormants(f1: 800, f2: 1150, f3: 2800, a2: db(-4), a3: db(-20), bw1: 80, bw2: 90, bw3: 120),  // ah
        VocalFormants(f1: 450, f2: 800, f3: 2830, a2: db(-9), a3: db(-16), bw1: 70, bw2: 80, bw3: 100),  // oh
        VocalFormants(f1: 325, f2: 700, f3: 2530, a2: db(-12), a3: db(-30), bw1: 50, bw2: 60, bw3: 170),  // oo
        VocalFormants(f1: 400, f2: 1600, f3: 2700, a2: db(-11), a3: db(-30), bw1: 60, bw2: 80, bw3: 120),  // eh
        VocalFormants(f1: 350, f2: 1700, f3: 2700, a2: db(-8), a3: db(-30), bw1: 50, bw2: 100, bw3: 120),  // ee
        VocalFormants(f1: 280, f2: 1000, f3: 2500, a2: db(-18), a3: db(-30), bw1: 90, bw2: 130, bw3: 150),  // mm
    ]

    private static let soprano: [VocalFormants] = [
        VocalFormants(f1: 800, f2: 1150, f3: 2900, a2: db(-6), a3: db(-32), bw1: 80, bw2: 90, bw3: 120),
        VocalFormants(f1: 450, f2: 800, f3: 2830, a2: db(-11), a3: db(-22), bw1: 70, bw2: 80, bw3: 100),
        VocalFormants(f1: 325, f2: 700, f3: 2700, a2: db(-16), a3: db(-35), bw1: 50, bw2: 60, bw3: 170),
        VocalFormants(f1: 350, f2: 2000, f3: 2800, a2: db(-8), a3: db(-15), bw1: 60, bw2: 100, bw3: 120),
        VocalFormants(f1: 270, f2: 2140, f3: 2950, a2: db(-5), a3: db(-26), bw1: 60, bw2: 90, bw3: 100),
        VocalFormants(f1: 280, f2: 1000, f3: 2500, a2: db(-18), a3: db(-30), bw1: 90, bw2: 130, bw3: 150),
    ]

    static func table(vowel: Int, register: Float) -> VocalFormants {
        let i = ((vowel % alto.count) + alto.count) % alto.count
        let a = alto[i]
        let s = soprano[i]
        let t = min(max(register, 0), 1)
        func mix(_ x: Float, _ y: Float) -> Float { x + (y - x) * t }
        return VocalFormants(
            f1: mix(a.f1, s.f1), f2: mix(a.f2, s.f2), f3: mix(a.f3, s.f3), a2: mix(a.a2, s.a2), a3: mix(a.a3, s.a3),
            bw1: mix(a.bw1, s.bw1), bw2: mix(a.bw2, s.bw2), bw3: mix(a.bw3, s.bw3))
    }

    static func mix(_ a: VocalFormants, _ b: VocalFormants, _ t: Float) -> VocalFormants {
        func m(_ x: Float, _ y: Float) -> Float { x + (y - x) * t }
        return VocalFormants(
            f1: m(a.f1, b.f1), f2: m(a.f2, b.f2), f3: m(a.f3, b.f3), a2: m(a.a2, b.a2), a3: m(a.a3, b.a3),
            bw1: m(a.bw1, b.bw1), bw2: m(a.bw2, b.bw2), bw3: m(a.bw3, b.bw3))
    }
}

/// How a `VocalVoice` is shaped: envelope times, vibrato and scoop. A value built by a switch.
struct VocalPatch: Sendable, Hashable, BitwiseCopyable {
    var attack: Float
    var release: Float
    /// Seconds before the vibrato starts, and the seconds it takes to reach full depth.
    var vibratoDelay: Float
    var vibratoRamp: Float
    /// Vibrato depth in semitones (peak).
    var vibratoDepth: Float
    /// Semitones below the note the voice starts, and the seconds it takes to arrive.
    var scoop: Float
    var scoopTime: Float
    /// Seconds a chop takes to glide from a closed "oo" to its vowel (0 for none).
    var onset: Float

    static func patch(chop: Bool, style: VocalStyle) -> VocalPatch {
        if chop {
            return VocalPatch(
                attack: 0.006, release: 0.07, vibratoDelay: 0.12, vibratoRamp: 0.1, vibratoDepth: 0.2, scoop: 0.5,
                scoopTime: 0.04, onset: 0.035)
        }
        switch style {
        case .choir:
            return VocalPatch(
                attack: 0.22, release: 0.55, vibratoDelay: 0.35, vibratoRamp: 0.5, vibratoDepth: 0.3, scoop: 0.25,
                scoopTime: 0.12, onset: 0)
        case .lead:
            return VocalPatch(
                attack: 0.05, release: 0.16, vibratoDelay: 0.3, vibratoRamp: 0.35, vibratoDepth: 0.4, scoop: 1.1,
                scoopTime: 0.08, onset: 0)
        case .solo:
            return VocalPatch(
                attack: 0.2, release: 0.45, vibratoDelay: 0.3, vibratoRamp: 0.45, vibratoDepth: 0.35, scoop: 0.4,
                scoopTime: 0.1, onset: 0)
        }
    }
}

/// One wordless singer: a band-limited sawtooth (the glottal pulse's slope) with breath noise, through three formant
/// filters, with a delayed vibrato and a scoop up to the pitch. A choir is three of these, detuned and spread by the
/// core. No allocation: plain value state.
public struct VocalVoice: Sendable, Hashable {
    public private(set) var active = false
    public private(set) var age = 0
    public private(set) var isLead = false

    private var phase: Float = 0
    private var noise: NoiseSource
    private var filter1 = SVF()
    private var filter2 = SVF()
    private var filter3 = SVF()
    private var k1: Float = 1
    private var k2: Float = 1
    private var k3: Float = 1
    private var target = VocalFormants.table(vowel: 0, register: 0.5)
    private var start = VocalFormants.table(vowel: 2, register: 0.5)
    private var current = VocalFormants.table(vowel: 0, register: 0.5)
    private var morph: Float = 1
    private var morphStep: Float = 0
    private var coefficientCountdown = 0

    private var baseHz: Float = 220
    private var detune: Float = 1
    private var patch = VocalPatch.patch(chop: false, style: .choir)
    private var vibratoPhase: Float = 0
    private var vibratoRate: Float = 5.4
    private var breath: Float = 0.2
    private var tilt = OnePole()

    private var gateEnd = 0
    private var releasing = false
    private var level: Float = 0
    private var attackStep: Float = 0.001
    private var releaseMultiplier: Float = 0.999
    private var gain: Float = 1
    private var fade: Float = 1
    private var fadeStep: Float = 0
    private var left: Float = 0.707
    private var right: Float = 0.707
    private var sampleRate: Float = 48_000

    public init(seed: UInt32 = 0x7F4A_7C15) {
        noise = NoiseSource(seed: seed)
    }

    /// Starts a note. `pitch` is MIDI, `vowel` 0 ... 5, `register` 0 (alto) ... 1 (soprano), `breath` 0 ... 1,
    /// `detuneCents` and `phaseOffset` (0 ... 1 of a vibrato cycle) tell choir voices apart.
    mutating func trigger(
        pitch: Float, velocity: Float, gateSamples: Int, vowel: Int, register: Float, breath noteBreath: Float,
        style: VocalStyle, chop: Bool, pan: Float, detuneCents: Float, phaseOffset: Float, level voiceLevel: Float,
        _ c: SynthCoefficients
    ) {
        sampleRate = c.sampleRate
        patch = VocalPatch.patch(chop: chop, style: style)
        isLead = !chop && style == .lead
        target = VocalFormants.table(vowel: vowel, register: register)
        start = VocalFormants.table(vowel: VocalVowel.oo.index, register: register)
        current = chop ? start : target
        morph = chop ? 0 : 1
        morphStep = chop ? 1 / max(patch.onset * sampleRate, 1) : 0
        coefficientCountdown = 0

        let p = min(max(pitch.isFinite ? pitch : 60, 36), 96)
        baseHz = DSP.midiToHz(p)
        detune = exp2f(detuneCents / 1200)
        breath = min(max(noteBreath, 0), 1)
        vibratoPhase = phaseOffset
        vibratoRate = 5.1 + 0.9 * phaseOffset
        phase = phaseOffset
        tilt.setCutoff(2_600, sampleRate: sampleRate)
        tilt.z = 0
        filter1.reset()
        filter2.reset()
        filter3.reset()

        age = 0
        gateEnd = max(gateSamples, 1)
        releasing = false
        level = 0
        attackStep = 1 / max(patch.attack * sampleRate, 1)
        releaseMultiplier = expf(-6.9 / max(patch.release * sampleRate, 1))  // ~60 dB
        gain = voiceLevel * (0.35 + 0.65 * min(max(velocity, 0), 1))
        fade = 1
        fadeStep = 0
        let angle = (min(max(pan, -1), 1) + 1) * Float.pi / 4
        left = cosf(angle)
        right = sinf(angle)
        active = true
    }

    /// Fades the voice out over ~25 ms (a new lead takes over, or the pool ran dry).
    mutating func steal() {
        guard active else { return }
        fadeStep = 1 / max(0.025 * sampleRate, 1)
    }

    @inline(__always) private mutating func setFilters() {
        let sr = sampleRate
        // Singers tune F1 up toward a high note so the voice does not thin out.
        let f1 = max(current.f1, min(baseHz * 1.08, current.f1 * 1.5))
        let f2 = max(current.f2, f1 * 1.4)
        filter1.set(cutoff: f1, resonance: Self.resonance(f1 / current.bw1), sampleRate: sr)
        filter2.set(cutoff: f2, resonance: Self.resonance(f2 / current.bw2), sampleRate: sr)
        filter3.set(cutoff: current.f3, resonance: Self.resonance(current.f3 / current.bw3), sampleRate: sr)
        k1 = 1 / max(f1 / current.bw1, 1)
        k2 = 1 / max(f2 / current.bw2, 1)
        k3 = 1 / max(current.f3 / current.bw3, 1)
    }

    /// SVF resonance for a quality factor: damping `2 - 2r` equals `1/Q`.
    @inline(__always) static func resonance(_ q: Float) -> Float { 1 - 0.5 / max(q, 0.5) }

    @inline(__always) public mutating func next(_ c: SynthCoefficients) -> (Float, Float) {
        guard active else { return (0, 0) }
        let dt = 1 / sampleRate
        let seconds = Float(age) * dt

        // Pitch: the scoop up to the note, then a vibrato that fades in after a pause.
        let scoop = seconds < patch.scoopTime ? -patch.scoop * (1 - seconds / patch.scoopTime) : 0
        let vibratoRise = min(max((seconds - patch.vibratoDelay) / patch.vibratoRamp, 0), 1)
        vibratoPhase += vibratoRate * dt
        if vibratoPhase >= 1 { vibratoPhase -= 1 }
        let vibrato = sinf(vibratoPhase * DSP.twoPi) * patch.vibratoDepth * vibratoRise
        let hz = baseHz * detune * exp2f((scoop + vibrato) / 12)

        // Source: a band-limited saw softened by a gentle slope, plus breath noise (both pass the formants).
        let step = min(hz * dt, 0.45)
        phase += step
        if phase >= 1 { phase -= 1 }
        let voiced = tilt.lowpass(DSP.saw(phase, step))
        let source = voiced * (1 - 0.6 * breath) + noise.next() * (0.05 + 0.45 * breath) * 0.5

        // The vowel (a chop opens from a closed "oo"), refreshed every 16 samples while it moves.
        if morph < 1 {
            morph = min(morph + morphStep, 1)
            if coefficientCountdown <= 0 {
                current = VocalFormants.mix(start, target, morph)
                setFilters()
                coefficientCountdown = 16
            }
            coefficientCountdown -= 1
        } else if coefficientCountdown >= 0 {
            current = target
            setFilters()
            coefficientCountdown = -1
        }
        let b1 = filter1.process(source).band * k1
        let b2 = filter2.process(source).band * k2 * current.a2
        let b3 = filter3.process(source).band * k3 * current.a3
        var out = (b1 + b2 + b3) * 3.2

        // Envelope: attack to the gate's end, then release.
        if age >= gateEnd { releasing = true }
        if releasing {
            level *= releaseMultiplier
        } else if level < 1 {
            level = min(level + attackStep, 1)
        }
        if fadeStep > 0 { fade -= fadeStep }
        out *= level * gain * max(fade, 0)
        age += 1
        if level < 1e-4 && releasing || fade <= 0 {
            active = false
        }
        out = DSP.softClip(out)
        return (out * left * 1.414, out * right * 1.414)
    }
}
