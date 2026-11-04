import Foundation
import Observation

/// One Codable preferences value in `UserDefaults` under `<keyPrefix>.preferences.v1`. Every change is written at once
/// and is undoable, except `restore`, `update(withoutUndo:)` and the clean-up at load.
///
/// A value that does not decode falls back to `initialValue`, so a damaged setting never stops the app.
@MainActor @Observable
public final class PreferencesStore<Value: Codable & Equatable> {
    public let history = UndoHistory()
    /// The `UserDefaults` key of the value.
    public let key: String
    /// Keeps an app's other keys beside the value, such as `<keyPrefix>.backup.v1`.
    public let keyPrefix: String
    public let defaults: UserDefaults

    @ObservationIgnored private let undoName: String
    /// Called on every real change, before it is written and on undo too, with the old and the new value.
    @ObservationIgnored private let onChange: @MainActor (_ old: Value, _ new: Value) -> Void
    @ObservationIgnored private var restoring = false

    public var value: Value {
        didSet {
            guard value != oldValue else { return }
            onChange(oldValue, value)
            if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
            guard !restoring else { return }
            let before = oldValue
            let after = value
            history.record(
                undoName, undo: { [weak self] in self?.restore(before) },
                redo: { [weak self] in self?.restore(after) })
        }
    }

    /// - Parameters:
    ///   - normalize: Repairs a loaded value. A repair that changes it is written back and is not undoable.
    public init(
        defaults: UserDefaults = .standard, keyPrefix: String, undoName: String = "Settings",
        initialValue: @autoclosure () -> Value, normalize: (inout Value) -> Void = { _ in },
        onChange: @escaping @MainActor (_ old: Value, _ new: Value) -> Void = { _, _ in }
    ) {
        self.defaults = defaults
        self.keyPrefix = keyPrefix
        self.undoName = undoName
        self.onChange = onChange
        let key = "\(keyPrefix).preferences.v1"
        self.key = key
        value =
            defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(Value.self, from: $0) } ?? initialValue()
        restoring = true
        normalize(&value)
        restoring = false
    }

    /// Replaces the value without recording an undo step.
    public func restore(_ value: Value) {
        restoring = true
        self.value = value
        restoring = false
    }

    /// A change too small or too frequent to be an undo step, such as dragging a divider.
    public func update(withoutUndo change: (inout Value) -> Void) {
        restoring = true
        change(&value)
        restoring = false
    }
}
