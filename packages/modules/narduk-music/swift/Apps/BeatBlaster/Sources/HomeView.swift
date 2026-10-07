import SwiftUI

/// The neon home screen: a title that pumps with the music over a dimmed visualizer, and four huge cards.
struct HomeView: View {
    let audio: BlasterAudio
    let go: (Screen) -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var appeared = false

    private struct Card: Identifiable {
        let screen: Screen
        let emoji: String
        let title: String
        let subtitle: String
        let color: Color
        var id: Screen { screen }
    }

    private let cards = [
        Card(screen: .beat, emoji: "🥁", title: "Make a Beat", subtitle: "Pick a song. Hit DROP!", color: Neon.pink),
        Card(screen: .lights, emoji: "🌈", title: "Light Show", subtitle: "Swipe the lights", color: Neon.cyan),
        Card(screen: .mic, emoji: "🎤", title: "Mic Mode", subtitle: "Clap, sing, yell!", color: Neon.green),
        Card(screen: .dream, emoji: "✨", title: "Dream a Song", subtitle: "Make up a song", color: Neon.purple),
    ]

    var body: some View {
        GeometryReader { geometry in
            let wide = geometry.size.width > geometry.size.height
            let compact = geometry.size.width < 500
            ZStack {
                LiveVisual(audio: audio, tile: VisualTile.all[1], drawing: scenePhase == .active)
                    .opacity(0.45)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                Vignette()
                VStack(spacing: compact ? 20 : 36) {
                    Spacer(minLength: 0)
                    PulsingTitle(audio: audio, size: compact ? 50 : (wide ? 96 : 104))
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: compact ? 14 : 24), count: wide ? 4 : 2),
                        spacing: compact ? 14 : 24
                    ) {
                        ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                            Button {
                                go(card.screen)
                            } label: {
                                cardView(card, compact: compact)
                            }
                            .buttonStyle(Squish())
                            .scaleEffect(appeared ? 1 : 0.3)
                            .opacity(appeared ? 1 : 0)
                            .animation(
                                .spring(response: 0.55, dampingFraction: 0.6).delay(0.08 * Double(index)),
                                value: appeared)
                        }
                    }
                    .frame(maxWidth: wide ? 1100 : 760)
                    Spacer(minLength: 0)
                }
                .padding(compact ? 16 : 40)
            }
        }
        .onAppear {
            audio.playIfIdle()
            appeared = true
        }
    }

    private func cardView(_ card: Card, compact: Bool) -> some View {
        VStack(spacing: compact ? 6 : 12) {
            Text(card.emoji).font(.system(size: compact ? 48 : 84))
            Text(card.title)
                .font(.system(size: compact ? 20 : 30, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(card.subtitle)
                .font(.system(size: compact ? 13 : 17, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
        .frame(height: compact ? 150 : 240)
        .background(
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [card.color.opacity(0.85), card.color.opacity(0.35)], startPoint: .topLeading,
                        endPoint: .bottomTrailing))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 32, style: .continuous).stroke(.white.opacity(0.7), lineWidth: 3)
        )
        .shadow(color: card.color.opacity(0.9), radius: 24)
        .contentShape(RoundedRectangle(cornerRadius: 32))
    }
}

/// "BEAT BLASTER" in a moving rainbow that swells with the music's loudness. It reads the latest frame on its own
/// clock (the background visual polls), so it never polls the analyzer a second time.
struct PulsingTitle: View {
    let audio: BlasterAudio
    let size: CGFloat

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            let level = audio.level
            let idle = 0.5 + 0.5 * sin(t * 2.4)
            let pump = audio.isRunning ? level : idle * 0.3
            let shift = t.truncatingRemainder(dividingBy: 6) / 6
            VStack(spacing: -size * 0.22) {
                word("BEAT", shift: shift)
                word("BLASTER", shift: shift + 0.3)
            }
            .scaleEffect(1 + 0.12 * pump)
            .rotationEffect(.degrees(sin(t * 1.3) * 2))
            .shadow(color: Neon.pink.opacity(0.4 + 0.6 * pump), radius: 10 + 30 * pump)
            .shadow(color: Neon.cyan.opacity(0.5), radius: 4)
        }
        .accessibilityElement()
        .accessibilityLabel("Beat Blaster")
        .accessibilityAddTraits(.isHeader)
    }

    private func word(_ text: String, shift: Double) -> some View {
        let colors = (0..<7).map { Neon.cycle[($0 + Int(shift * 6)) % Neon.cycle.count] }
        return Text(text)
            .font(.system(size: size, weight: .black, design: .rounded))
            .italic()
            .foregroundStyle(
                LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing)
            )
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}
