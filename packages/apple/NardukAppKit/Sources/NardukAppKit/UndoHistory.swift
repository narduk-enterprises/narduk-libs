import Foundation
import Observation

/// An `UndoManager` SwiftUI can observe: `revision` moves on every change, so menu titles and enabled states follow.
@MainActor @Observable
public final class UndoHistory {
    public let manager = UndoManager()
    public var revision = 0

    public init(levelsOfUndo: Int = 50) { manager.levelsOfUndo = levelsOfUndo }

    public var canUndo: Bool {
        _ = revision
        return manager.canUndo
    }
    public var canRedo: Bool {
        _ = revision
        return manager.canRedo
    }
    public var undoTitle: String {
        _ = revision
        return manager.undoActionName
    }

    /// Registers one undoable step. Undoing it registers the reverse, so undo and redo keep alternating.
    public func record(
        _ name: String, undo: @escaping @MainActor () -> Void, redo: @escaping @MainActor () -> Void
    ) {
        manager.registerUndo(withTarget: self) { history in
            MainActor.assumeIsolated {
                history.record(name, undo: redo, redo: undo)
                undo()
                history.revision += 1
            }
        }
        manager.setActionName(name)
        revision += 1
    }

    public func undo() {
        manager.undo()
        revision += 1
    }

    public func redo() {
        manager.redo()
        revision += 1
    }
}
