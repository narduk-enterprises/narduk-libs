#if os(macOS)
    import AppKit
    import SwiftUI

    /// Records how an app is used, only on this Mac and only while recording is on.
    /// Pointer handling never publishes to SwiftUI: samples land in plain buffers that a slow loop writes out.
    /// Keystrokes are never observed; shortcuts reach the log through the commands they run.
    ///
    /// An app owns one, in an extension of its own: `extension ActivityRecorder { static let shared = … }`.
    @MainActor
    public final class ActivityRecorder {
        public let log: ActivityLog
        public private(set) var isRecording = false
        /// Pointer samples per second at most; enough for dwell, heat and a coarse path.
        public static let sampleInterval: TimeInterval = 0.25
        /// Samples this close together in one panel extend one dwell; a longer pause starts a new one. A parked
        /// pointer sends nothing, so a dwell runs from its first sample to its last.
        public static let stillness: TimeInterval = 60
        public static let flushInterval: Duration = .seconds(15)

        private struct Dwell {
            var region: String
            var subject: String?
            var since: Date
            var last: Date
        }
        private struct WindowTrace {
            var dwell: Dwell?
            var pathStart: Date?
            var points: [Int] = []
            var heat: [String: Int] = [:]
            var layout: [String: [Double]] = [:]
        }

        private let regionViews = NSHashTable<ActivityRegionView>.weakObjects()
        private var traces: [Int: WindowTrace] = [:]
        private var levels: [String: [String: Int]] = [:]
        private var buffer: [ActivityEvent] = []
        private var monitor: Any?
        private var observers: [NSObjectProtocol] = []
        private var loop: Task<Void, Never>?
        private var writes: Task<Void, Never>?
        private var lastSample: TimeInterval = 0
        private var lastLevel: TimeInterval = 0
        private var lastVisible: Date?

        public init(log: ActivityLog) { self.log = log }

        public func setRecording(_ on: Bool) {
            guard on != isRecording else { return }
            if on {
                isRecording = true
                lastVisible = .now
                record(ActivityEvent(t: .now, kind: .session, name: "start"))
                monitor = NSEvent.addLocalMonitorForEvents(
                    matching: [.mouseMoved, .leftMouseDragged, .scrollWheel, .leftMouseDown, .rightMouseDown]
                ) { [weak self] event in
                    self?.handle(event)
                    return event
                }
                let center = NotificationCenter.default
                observers = [
                    center.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) {
                        [weak self] _ in
                        MainActor.assumeIsolated { self?.becameActive() }
                    },
                    center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) {
                        [weak self] _ in
                        MainActor.assumeIsolated { self?.resignedActive() }
                    },
                ]
                loop = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(for: Self.flushInterval)
                        self?.flush()
                    }
                }
                Task { try? await log.prune() }
            } else {
                resignedActive()
                isRecording = false
                if let monitor { NSEvent.removeMonitor(monitor) }
                monitor = nil
                observers.forEach(NotificationCenter.default.removeObserver)
                observers = []
                loop?.cancel()
                loop = nil
                traces = [:]
                levels = [:]
            }
        }

        /// Counts one use of a feature from the app's taxonomy.
        public func record(feature: some ActivityTaxonomy, detail: String? = nil) {
            guard isRecording else { return }
            record(ActivityEvent(t: .now, kind: .feature, name: feature.rawValue, detail: detail))
        }

        /// The thing the app is about came into view, such as a document or an item.
        public func subjectShown(_ subject: String) {
            guard isRecording, !subject.isEmpty else { return }
            record(ActivityEvent(t: .now, kind: .subject, subject: subject))
        }

        /// A hovered value, counted for the subject of that window's `region` panel. Called from a view's own hover
        /// handling, so it only adds to a dictionary, and `level` is built only for a sample that is kept.
        public func hover(level: @autoclosure () -> String, region: some ActivityTaxonomy, in window: NSWindow?) {
            guard isRecording, let window else { return }
            let uptime = ProcessInfo.processInfo.systemUptime
            guard uptime - lastLevel >= Self.sampleInterval else { return }
            lastLevel = uptime
            let panel = regionViews.allObjects.first { $0.region == region.rawValue && $0.window === window }
            guard let subject = panel?.subject else { return }
            levels[subject, default: [:]][level(), default: 0] += 1
        }

        /// Everything still in memory goes to disk; the Activity window calls this before it reads.
        public func flush() {
            guard isRecording else { return }
            let now = Date.now
            recordVisible(until: now)
            for (number, var trace) in traces {
                if let start = trace.pathStart, !trace.points.isEmpty {
                    record(ActivityEvent(t: start, kind: .path, window: number, points: trace.points))
                }
                if !trace.heat.isEmpty { record(ActivityEvent(t: now, kind: .heat, window: number, cells: trace.heat)) }
                let layout = layout(window: number)
                if !layout.isEmpty, layout != trace.layout {
                    record(ActivityEvent(t: now, kind: .layout, window: number, regions: layout))
                    trace.layout = layout
                }
                trace.pathStart = nil
                trace.points = []
                trace.heat = [:]
                traces[number] = trace
            }
            for (subject, cells) in levels {
                record(ActivityEvent(t: now, kind: .levels, subject: subject, cells: cells))
            }
            levels = [:]
            let batch = buffer
            buffer = []
            guard !batch.isEmpty else { return }
            let previous = writes
            let log = log
            writes = Task {
                await previous?.value
                try? await log.append(batch)
            }
        }

        /// Close open dwells and the session, then write everything; called before quitting.
        public func finish() async {
            resignedActive()
            await written()
        }

        /// Wait for every queued write, so a reader sees all of it.
        public func written() async {
            flush()
            await writes?.value
        }

        func register(_ view: ActivityRegionView) { regionViews.add(view) }
        func unregister(_ view: ActivityRegionView) { regionViews.remove(view) }

        private func record(_ event: ActivityEvent) { buffer.append(event) }

        func handle(_ event: NSEvent) {
            guard let window = event.window, let content = window.contentView, content.bounds.width > 0,
                content.bounds.height > 0
            else { return }
            let click = event.type == .leftMouseDown || event.type == .rightMouseDown
            if !click {
                guard event.timestamp - lastSample >= Self.sampleInterval else { return }
                lastSample = event.timestamp
            }
            let now = Date.now
            let location = event.locationInWindow
            let x = min(1, max(0, location.x / content.bounds.width))
            let y = min(1, max(0, 1 - location.y / content.bounds.height))
            let number = window.windowNumber
            var trace = traces[number] ?? WindowTrace()
            let start = trace.pathStart ?? now
            trace.pathStart = start
            trace.points += [Int(now.timeIntervalSince(start) * 1000), Int(x * 1000), Int(y * 1000)]
            trace.heat["\(min(31, Int(x * 32))),\(min(19, Int(y * 20)))", default: 0] += 1
            let hit = region(at: location, in: window)
            if var dwell = trace.dwell, dwell.region == hit?.region, dwell.subject == hit?.subject,
                now.timeIntervalSince(dwell.last) <= Self.stillness
            {
                dwell.last = now
                trace.dwell = dwell
            } else {
                close(trace.dwell, window: number)
                trace.dwell = hit.map { Dwell(region: $0.region, subject: $0.subject, since: now, last: now) }
            }
            traces[number] = trace
            if click {
                record(
                    ActivityEvent(
                        t: now, kind: .click, window: number, name: hit?.region, subject: hit?.subject,
                        x: (x * 1000).rounded() / 1000, y: (y * 1000).rounded() / 1000))
            }
        }

        /// The innermost panel under a point in AppKit window coordinates.
        private func region(at location: NSPoint, in window: NSWindow) -> ActivityRegionView? {
            guard let height = window.contentView?.bounds.height else { return nil }
            let point = CGPoint(x: location.x, y: height - location.y)
            var best: (view: ActivityRegionView, area: CGFloat)?
            for view in regionViews.allObjects where view.window === window && !view.isHiddenOrHasHiddenAncestor {
                let frame = view.frame(in: window)
                guard frame.contains(point) else { continue }
                let area = frame.width * frame.height
                if let current = best, current.area <= area { continue }
                best = (view, area)
            }
            return best?.view
        }

        private func layout(window number: Int) -> [String: [Double]] {
            var result: [String: [Double]] = [:]
            for view in regionViews.allObjects
            where view.window?.windowNumber == number && !view.isHiddenOrHasHiddenAncestor {
                guard let content = view.window?.contentView, content.bounds.width > 0, content.bounds.height > 0
                else { continue }
                let frame = view.frame(in: view.window)
                guard frame.width > 0, frame.height > 0 else { continue }
                let size = content.bounds.size
                let parts: [CGFloat] = [
                    frame.minX / size.width, frame.minY / size.height, frame.width / size.width,
                    frame.height / size.height,
                ]
                result[view.region] = parts.map { Double(($0 * 1000).rounded() / 1000) }
            }
            return result
        }

        /// Seconds each panel spent on screen in the front window since the last count, while the app was active.
        /// Counted up to two flushes at a time, so a sleep or a stalled loop never claims hours.
        private func recordVisible(until now: Date) {
            defer { lastVisible = NSApp.isActive ? now : nil }
            guard let since = lastVisible, let window = NSApp.keyWindow ?? NSApp.mainWindow, window.isVisible,
                !window.isMiniaturized
            else { return }
            let seconds = min(now.timeIntervalSince(since), 30)
            guard seconds > 0 else { return }
            var cells: [String: Int] = [:]
            for view in regionViews.allObjects where view.window === window && !view.isHiddenOrHasHiddenAncestor {
                guard !view.frame(in: window).isEmpty else { continue }
                cells[view.region] = Int(seconds.rounded())
            }
            guard !cells.isEmpty else { return }
            record(ActivityEvent(t: now, kind: .visible, window: window.windowNumber, cells: cells))
        }

        private func close(_ dwell: Dwell?, window: Int) {
            guard let dwell else { return }
            let seconds = dwell.last.timeIntervalSince(dwell.since)
            guard seconds >= 1 else { return }
            record(
                ActivityEvent(
                    t: dwell.since, kind: .dwell, window: window, name: dwell.region, subject: dwell.subject,
                    duration: (seconds * 10).rounded() / 10))
        }

        private func becameActive() {
            lastVisible = .now
            record(ActivityEvent(t: .now, kind: .session, name: "start"))
        }

        private func resignedActive() {
            guard isRecording else { return }
            recordVisible(until: .now)
            for (number, trace) in traces {
                close(trace.dwell, window: number)
                traces[number]?.dwell = nil
            }
            record(ActivityEvent(t: .now, kind: .session, name: "end"))
            flush()
        }
    }

    /// The panel's frame in window space (top-left origin). SwiftUI does not size a background AppKit view to its panel,
    /// so it arrives through `onGeometryChange`, which runs on layout and scrolling, never on pointer movement.
    @MainActor
    final class ActivityRegionFrame {
        var value: CGRect = .zero
    }

    /// An invisible AppKit view behind a panel, so the recorder can find the panel under the pointer without SwiftUI
    /// reporting geometry. It never takes clicks.
    final class ActivityRegionView: NSView {
        var region: String
        var subject: String?
        var panel = ActivityRegionFrame()
        private let recorder: ActivityRecorder

        /// The panel's part inside the window's content, top-left origin; empty when scrolled out of view.
        func frame(in window: NSWindow?) -> CGRect {
            guard let bounds = window?.contentView?.bounds else { return .zero }
            return panel.value.intersection(CGRect(origin: .zero, size: bounds.size))
        }

        init(region: String, recorder: ActivityRecorder) {
            self.region = region
            self.recorder = recorder
            super.init(frame: .zero)
        }
        @available(*, unavailable) required init?(coder: NSCoder) { nil }

        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if window == nil { recorder.unregister(self) } else { recorder.register(self) }
        }
    }

    private struct ActivityRegionMarker: NSViewRepresentable {
        let region: String
        let subject: String?
        let panel: ActivityRegionFrame
        let recorder: ActivityRecorder

        func makeNSView(context: Context) -> ActivityRegionView {
            let view = ActivityRegionView(region: region, recorder: recorder)
            view.subject = subject
            view.panel = panel
            return view
        }
        func updateNSView(_ view: ActivityRegionView, context: Context) {
            view.region = region
            view.subject = subject
            view.panel = panel
        }
    }

    private struct ActivityRegionModifier: ViewModifier {
        let region: String
        let subject: String?
        let recorder: ActivityRecorder
        @State private var panel = ActivityRegionFrame()

        func body(content: Content) -> some View {
            content
                .background(ActivityRegionMarker(region: region, subject: subject, panel: panel, recorder: recorder))
                .onGeometryChange(for: CGRect.self) {
                    $0.frame(in: .global)
                } action: {
                    panel.value = $0
                }
        }
    }

    extension View {
        /// Count the pointer's time over this panel, and its clicks, while recording is on.
        public func activityRegion(
            _ region: some ActivityTaxonomy, subject: String? = nil, recorder: ActivityRecorder
        ) -> some View {
            modifier(ActivityRegionModifier(region: region.rawValue, subject: subject, recorder: recorder))
        }
    }
#endif
