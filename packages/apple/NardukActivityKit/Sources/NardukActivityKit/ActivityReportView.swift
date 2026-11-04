#if os(macOS)
    import AppKit
    import SwiftUI
    import UniformTypeIdentifiers

    /// The colours of the report. An app with its own palette passes it; `.system` follows the system.
    public struct ActivityReportStyle: Sendable {
        public var ink: Color
        public var secondary: Color
        public var muted: Color
        public var background: Color
        public var panel: Color
        public var line: Color
        public var raised: Color
        public var accent: Color

        public init(
            ink: Color, secondary: Color, muted: Color, background: Color, panel: Color, line: Color, raised: Color,
            accent: Color
        ) {
            self.ink = ink
            self.secondary = secondary
            self.muted = muted
            self.background = background
            self.panel = panel
            self.line = line
            self.raised = raised
            self.accent = accent
        }

        public static let system = ActivityReportStyle(
            ink: .primary, secondary: .secondary, muted: Color(nsColor: .tertiaryLabelColor),
            background: Color(nsColor: .windowBackgroundColor), panel: Color(nsColor: .controlBackgroundColor),
            line: Color(nsColor: .separatorColor), raised: Color(nsColor: .quaternaryLabelColor), accent: .accentColor)
    }

    /// What you use most, kept short on purpose: the features you reach for and the panels you spend time on.
    /// The full record stays on this Mac; Export hands it over only when the person chooses.
    ///
    /// Put it in a `Window` titled `windowTitle`: the report refreshes when that window comes forward.
    public struct ActivityReportView<Feature: ActivityTaxonomy, Region: ActivityTaxonomy>: View {
        private let recorder: ActivityRecorder
        @Binding private var recording: Bool
        private let appName: String
        private let windowTitle: String
        private let days: Int
        private let style: ActivityReportStyle
        @State private var summary: ActivitySummary<Feature, Region>?
        @State private var confirmClear = false
        @State private var status: String?
        /// Bumped whenever this window comes forward, so returning to it shows what was just recorded.
        @State private var refreshes = 0

        public init(
            recorder: ActivityRecorder, recording: Binding<Bool>, appName: String,
            windowTitle: String = "Your Activity",
            days: Int = 30, style: ActivityReportStyle = .system
        ) {
            self.recorder = recorder
            _recording = recording
            self.appName = appName
            self.windowTitle = windowTitle
            self.days = days
            self.style = style
        }

        public var body: some View {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 14) {
                    overview
                    if let summary, !(summary.features.isEmpty && summary.regions.isEmpty) {
                        if !summary.features.isEmpty {
                            section("Most used", icon: "hand.tap", rows: Array(summary.features.prefix(5))) {
                                "\(Int($0))×"
                            }
                        }
                        if !summary.regions.isEmpty {
                            section("Where your time goes", icon: "clock", rows: Array(summary.regions.prefix(5))) {
                                activityDuration($0)
                            }
                        }
                    } else if summary != nil {
                        panel {
                            Text(
                                recording
                                    ? "Nothing yet. Use \(appName) as usual and this fills in."
                                    : "Recording is off. Turn it on to see which features and panels you use most."
                            )
                            .font(.callout).foregroundStyle(style.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        }
                    } else {
                        ProgressView().controlSize(.small).frame(maxWidth: .infinity, minHeight: 80)
                    }
                }
                .padding(20)
                Divider()
                footer.padding(.horizontal, 20).padding(.vertical, 12)
            }
            // Sized by its content, so the whole summary and its controls always show without scrolling.
            .frame(width: 440).fixedSize(horizontal: false, vertical: true).background(style.background)
            .task(id: "\(recording)-\(refreshes)") { await load() }
            .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { note in
                if (note.object as? NSWindow)?.title == windowTitle { refreshes += 1 }
            }
            .confirmationDialog("Clear all recorded activity?", isPresented: $confirmClear) {
                Button("Clear Activity", role: .destructive) { Task { await clear() } }
            } message: {
                Text("This removes every day kept on this Mac. It can’t be undone.")
            }
        }

        /// The two totals worth a glance, then where the record lives.
        private var overview: some View {
            HStack(alignment: .firstTextBaseline, spacing: 20) {
                if let summary, summary.sessions > 0 {
                    stat(summary.sessions == 1 ? "session" : "sessions", value: "\(summary.sessions)")
                    stat("active", value: activityDuration(summary.activeSeconds))
                }
                Spacer(minLength: 8)
                Label("Last \(days) days · this Mac", systemImage: "lock")
                    .font(.caption).foregroundStyle(style.muted)
            }
        }

        private func stat(_ label: String, value: String) -> some View {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(value).font(.title2.weight(.semibold)).monospacedDigit().foregroundStyle(style.ink)
                Text(label).font(.callout).foregroundStyle(style.muted)
            }
            .accessibilityElement(children: .combine)
        }

        private func panel<Content: View>(@ViewBuilder content: () -> Content) -> some View {
            content().padding(16)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .background(style.panel, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(style.line))
        }

        private func section(
            _ title: String, icon: String, rows: [ActivitySummary<Feature, Region>.Count],
            value: @escaping (Double) -> String
        ) -> some View {
            let top = rows.first?.value ?? 1
            return panel {
                VStack(alignment: .leading, spacing: 10) {
                    Label(title, systemImage: icon).font(.headline).foregroundStyle(style.ink)
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 9) {
                        ForEach(rows, id: \.id) { row in
                            GridRow {
                                Text(row.title).font(.callout).foregroundStyle(style.secondary).lineLimit(1)
                                    // One label width in both cards, so their bars start on the same line.
                                    .frame(width: 150, alignment: .leading)
                                    // The row is read once, from its label cell.
                                    .accessibilityLabel("\(row.title), \(value(row.value))")
                                Capsule().fill(style.raised).frame(height: 6)
                                    .overlay(alignment: .leading) {
                                        GeometryReader { proxy in
                                            Capsule().fill(style.accent.opacity(0.8))
                                                .frame(width: max(6, proxy.size.width * row.value / max(top, 1)))
                                        }
                                    }
                                    .frame(minWidth: 60).accessibilityHidden(true)
                                Text(value(row.value)).font(.callout).monospacedDigit().foregroundStyle(style.muted)
                                    // Wide enough for "1h 12m", so both cards' bars also end together.
                                    .frame(minWidth: 52, alignment: .trailing).gridColumnAlignment(.trailing)
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                }
            }
        }

        private var footer: some View {
            VStack(alignment: .leading, spacing: 6) {
                if let status { Text(status).font(.caption).foregroundStyle(style.muted) }
                HStack(spacing: 10) {
                    Toggle("Recording", isOn: $recording)
                        .toggleStyle(.switch).controlSize(.small)
                    Spacer(minLength: 0)
                    Button("Export…") { Task { await export() } }.disabled(summary?.isEmpty ?? true)
                    Button("Clear…") { confirmClear = true }.disabled(summary?.isEmpty ?? true)
                }
                .controlSize(.small)
            }
        }

        private func load() async {
            await recorder.written()
            let events = await recorder.log.events(days: days)
            summary = await Task.detached { ActivitySummary<Feature, Region>(events: events) }.value
        }

        private func clear() async {
            await recorder.written()
            do {
                try await recorder.log.clear()
                status = "Cleared."
            } catch {
                status = error.localizedDescription
            }
            await load()
        }

        private func export() async {
            await recorder.written()
            let panel = NSSavePanel()
            panel.nameFieldStringValue = "\(appName) Activity.jsonl"
            panel.allowedContentTypes = [UTType(filenameExtension: "jsonl") ?? .json]
            guard panel.runModal() == .OK, let url = panel.url else { return }
            do {
                try await recorder.log.export(to: url)
                status = "Exported \(url.lastPathComponent)."
            } catch {
                status = error.localizedDescription
            }
        }
    }

    /// "45s", "12m" or "1h 12m".
    public func activityDuration(_ seconds: Double) -> String {
        let minutes = Int(seconds / 60)
        if minutes < 1 { return "\(Int(seconds))s" }
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }
#endif
