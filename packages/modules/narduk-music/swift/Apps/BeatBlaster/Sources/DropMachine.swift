import Foundation

/// The DROP button's state machine, in steps (16ths) of the engine's clock. It is pure so it can be unit tested.
///
/// Press: the build starts at the first step not yet scheduled (the engine schedules ~0.25 s ahead, so that is as soon
/// as a note can sound). Release: the drop lands on the first step not yet scheduled, never later, and the groove
/// restarts there (bar 1 of the drop). The drop lasts two bars, or four after a long hold, then the song carries on.
/// A press while a drop plays starts a new build; a second press while building is ignored.
struct DropMachine: Equatable {
    enum Phase: Equatable {
        case idle
        case building(start: Int)
        case dropping(start: Int, end: Int, power: Double)
    }

    private(set) var phase: Phase = .idle
    static let fullChargeSeconds = 4.0

    /// Returns true when a build started.
    @discardableResult
    mutating func press(at step: Int) -> Bool {
        if case .building = phase { return false }
        phase = .building(start: step)
        return true
    }

    /// Lands the drop at `step`. Returns the drop's (start, end), or nil when nothing was building.
    @discardableResult
    mutating func release(at step: Int, secondsPerStep: Double) -> (start: Int, end: Int)? {
        guard case .building(let start) = phase else { return nil }
        let charge = Self.charge(heldSteps: step - start, secondsPerStep: secondsPerStep)
        let bars = charge > 0.6 ? 4 : 2
        let end = step + bars * 16
        phase = .dropping(start: step, end: end, power: 0.8 + 0.2 * charge)
        return (step, end)
    }

    /// Moves to idle once the drop is over.
    mutating func advance(to step: Int) {
        if case .dropping(_, let end, _) = phase, step >= end { phase = .idle }
    }

    /// Abandons a build or drop (the song stopped).
    mutating func cancel() { phase = .idle }

    /// 0 ... 1: how long the build has run, full at `fullChargeSeconds`.
    static func charge(heldSteps: Int, secondsPerStep: Double) -> Double {
        min(1, max(0, Double(heldSteps) * secondsPerStep / fullChargeSeconds))
    }

    /// What plays at `step` in the current phase.
    enum Layer: Equatable {
        /// The song as written.
        case song
        /// Kick and bass muted, a snare roll that speeds up: every `rollEvery` steps at `intensity` 0 ... 1.
        case build(rollEvery: Int, intensity: Double, isFirstStep: Bool)
        /// The app's drop pattern replaces the song's drums and bass; `position` is the step within the drop.
        case drop(position: Int, power: Double)
    }

    func layer(at step: Int, secondsPerStep: Double) -> Layer {
        switch phase {
        case .idle:
            return .song
        case .building(let start):
            guard step >= start else { return .song }
            let held = Double(step - start) * secondsPerStep
            let every = held < 1 ? 4 : (held < 2 ? 2 : 1)
            return .build(
                rollEvery: every, intensity: Self.charge(heldSteps: step - start, secondsPerStep: secondsPerStep),
                isFirstStep: step == start)
        case .dropping(let start, let end, let power):
            guard step >= start, step < end else { return .song }
            return .drop(position: step - start, power: power)
        }
    }
}
