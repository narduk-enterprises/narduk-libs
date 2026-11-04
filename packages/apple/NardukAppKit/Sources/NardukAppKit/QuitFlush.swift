#if os(macOS)
    import AppKit

    /// Finishes an app's save before a normal quit. When the save fails, the person chooses: stay open with their
    /// changes, or quit without saving.
    @MainActor
    public struct QuitFlush {
        public var failureTitle: String
        public var keepOpenTitle: String
        public var quitTitle: String
        /// Read after the save fails, so it can name what went wrong.
        public var failureDetail: @MainActor () -> String

        public init(
            failureTitle: String, failureDetail: @escaping @MainActor () -> String, keepOpenTitle: String = "Keep Open",
            quitTitle: String = "Quit Without Saving"
        ) {
            self.failureTitle = failureTitle
            self.failureDetail = failureDetail
            self.keepOpenTitle = keepOpenTitle
            self.quitTitle = quitTitle
        }

        /// Return this from `applicationShouldTerminate(_:)`. `save` returns whether the data is safe on disk.
        public func terminate(
            _ sender: NSApplication, save: @escaping @MainActor () async -> Bool
        ) -> NSApplication.TerminateReply {
            Task {
                if await save() {
                    sender.reply(toApplicationShouldTerminate: true)
                } else {
                    let alert = NSAlert()
                    alert.messageText = failureTitle
                    alert.informativeText = failureDetail()
                    alert.addButton(withTitle: keepOpenTitle)
                    alert.addButton(withTitle: quitTitle)
                    sender.reply(toApplicationShouldTerminate: alert.runModal() == .alertSecondButtonReturn)
                }
            }
            return .terminateLater
        }
    }
#endif
