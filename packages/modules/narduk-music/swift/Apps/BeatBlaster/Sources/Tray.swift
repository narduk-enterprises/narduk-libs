import SwiftUI

/// Where a control sits on screen, reported in window coordinates so the layout tests can check the safe area, overlaps
/// and tap-target sizes without launching the app. It also sets the control's accessibility identifier.
struct ProbeKey: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}

extension View {
    /// Reports this view's frame under `id` and names it for accessibility. Pass `container: true` for a view that
    /// wraps controls: its id then labels the group and the controls inside keep their own (#1664).
    @ViewBuilder func probe(_ id: String, container: Bool = false) -> some View {
        let framed = background(
            GeometryReader { proxy in
                Color.clear.preference(key: ProbeKey.self, value: [id: proxy.frame(in: .global)])
            }
        )
        if container {
            framed.accessibilityElement(children: .contain).accessibilityIdentifier(id)
        } else {
            framed.accessibilityIdentifier(id)
        }
    }
}

/// The pull-up controls tray: which page is showing, whether it is open and when a finger last touched it.
/// DROP never lives in here, and closing the tray never touches the music.
struct TrayState: Equatable {
    enum Page: String, CaseIterable, Identifiable {
        case play, effects, more
        var id: String { rawValue }
        var icon: String {
            switch self {
            case .play: "icon-energy"
            case .effects: "icon-pads"
            case .more: "icon-music"
            }
        }
        var word: String {
            switch self {
            case .play: "Play"
            case .effects: "Effects"
            case .more: "Music & Lights"
            }
        }
    }

    /// An open tray folds itself away after this long without a touch.
    static let idleSeconds: Double = 8

    private(set) var isOpen = false
    var page: Page = .play
    private(set) var touched = Date.distantPast

    mutating func open(at now: Date = Date()) {
        isOpen = true
        touched = now
    }

    mutating func close() { isOpen = false }

    mutating func toggle(at now: Date = Date()) {
        if isOpen { close() } else { open(at: now) }
    }

    /// Any touch inside the open tray restarts the idle clock (throttled so a drag is not a state change per frame).
    mutating func touch(at now: Date = Date()) {
        guard isOpen, now.timeIntervalSince(touched) > 1 else { return }
        touched = now
    }

    func isIdle(at now: Date) -> Bool { isOpen && now.timeIntervalSince(touched) >= Self.idleSeconds }
}

/// A translucent bottom sheet. Collapsed it is one slim "🎛 Controls" handle; swipe it up or tap it to open it.
struct ControlsTray<Content: View>: View {
    @Binding var state: TrayState
    /// The tallest the open pages may grow, so the lights always stay visible above it.
    let maxPageHeight: CGFloat
    let short: Bool
    @ViewBuilder let content: (TrayState.Page) -> Content

    var body: some View {
        VStack(spacing: 0) {
            handle
            if state.isOpen {
                tabs
                ScrollView(.vertical, showsIndicators: false) {
                    content(state.page)
                        .padding(.horizontal, short ? 8 : 12)
                        .padding(.bottom, 12)
                        .frame(maxWidth: .infinity)
                }
                .frame(maxHeight: maxPageHeight)
                .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in state.touch() })
            }
        }
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous).fill(.ultraThinMaterial)
            RoundedRectangle(cornerRadius: 24, style: .continuous).fill(.black.opacity(state.isOpen ? 0.3 : 0.2))
        }
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(.white.opacity(0.25), lineWidth: 1.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .probe("player.tray", container: true)
        .animation(.spring(response: 0.38, dampingFraction: 0.85), value: state.isOpen)
        .task(id: state) {
            guard state.isOpen else { return }
            try? await Task.sleep(for: .seconds(TrayState.idleSeconds))
            if !Task.isCancelled, state.isIdle(at: Date()) { state.close() }
        }
    }

    private var handle: some View {
        Button {
            Haptics.tap()
            state.toggle()
        } label: {
            HStack(spacing: 8) {
                Capsule().fill(.white.opacity(0.7)).frame(width: 36, height: 5)
                Glyph("icon-pads", size: 22)
                Text("Controls")
                    .font(.system(size: short ? 15 : 18, weight: .black, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Image(systemName: state.isOpen ? "chevron.down" : "chevron.up")
                    .font(.system(size: 14, weight: .black))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(state.isOpen ? "Close the controls" : "Open the controls")
        .probe("player.tray.handle")
        .simultaneousGesture(
            DragGesture(minimumDistance: 14).onEnded { drag in
                if drag.translation.height < -20 {
                    state.open()
                } else if drag.translation.height > 20 {
                    state.close()
                }
            }
        )
    }

    private var tabs: some View {
        HStack(spacing: 6) {
            ForEach(TrayState.Page.allCases) { which in
                Button {
                    Haptics.tap()
                    state.page = which
                    state.touch()
                } label: {
                    HStack(spacing: 4) {
                        Glyph(which.icon, size: 18)
                        Text(which.word)
                            .font(.system(size: short ? 12 : 14, weight: .black, design: .rounded))
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(
                        Neon.cyan.opacity(state.page == which ? 0.6 : 0.12), in: Capsule()
                    )
                    .overlay(Capsule().stroke(.white.opacity(state.page == which ? 0.95 : 0.3), lineWidth: 2))
                }
                .buttonStyle(Squish())
                .accessibilityLabel(which.word)
                .accessibilityAddTraits(state.page == which ? .isSelected : [])
                .accessibilityIdentifier("player.tray.tab.\(which.rawValue)")
            }
        }
        .padding(.horizontal, short ? 8 : 12)
        .padding(.bottom, 8)
    }
}
