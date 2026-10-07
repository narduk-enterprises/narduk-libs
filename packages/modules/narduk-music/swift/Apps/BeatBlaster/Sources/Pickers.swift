import NardukSoundVisuals
import SwiftUI

/// A music (style) card with the 🎵 badge.
struct MusicCard: View {
    let style: BlasterStyle
    var selected = false
    var compact = false

    var body: some View {
        VStack(spacing: 6) {
            KindBadge(kind: .music, size: compact ? 10 : 12)
            VibeArt(style: style, size: compact ? 64 : 92)
            Text(style.funName)
                .blasterFont(size: compact ? 15 : 20, weight: .black)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(style.genreName)
                .blasterFont(size: compact ? 11 : 14, weight: .bold)
                .opacity(0.8)
        }
        .foregroundStyle(.white)
        .padding(10)
        .frame(width: compact ? 120 : 168, height: compact ? 150 : 196)
        .background(
            style.color.opacity(selected ? 0.95 : 0.45), in: RoundedRectangle(cornerRadius: 26, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(.white.opacity(selected ? 1 : 0.35), lineWidth: selected ? 5 : 2)
        )
        .overlay(alignment: .topTrailing) {
            if selected {
                Glyph("✅", size: 30).offset(x: 10, y: -12)
            }
        }
        .shadow(color: style.color.opacity(selected ? 1 : 0.35), radius: selected ? 20 : 6)
        .scaleEffect(selected ? 1.05 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.55), value: selected)
    }
}

/// A light card: a live preview thumbnail, the 💡 badge and the light's name.
struct LightCard: View {
    let audio: BlasterAudio
    let tile: VisualTile
    var selected = false
    var compact = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: 6) {
            LiveVisual(
                audio: audio, tile: tile, drawing: scenePhase == .active, framesPerSecond: SoundRenderBudget.reduced
            )
            .frame(width: compact ? 120 : 176, height: compact ? 80 : 112)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .allowsHitTesting(false)
            HStack(spacing: 6) {
                Glyph("💡", size: compact ? 14 : 18)
                Text(tile.name)
                    .blasterFont(size: compact ? 14 : 18, weight: .black)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .foregroundStyle(.white)
        }
        .padding(8)
        .background(
            Neon.cyan.opacity(selected ? 0.55 : 0.15), in: RoundedRectangle(cornerRadius: 22, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(selected ? Neon.cyan : .white.opacity(0.3), lineWidth: selected ? 5 : 2)
        )
        .overlay(alignment: .topTrailing) {
            if selected { Glyph("✅", size: 28).offset(x: 8, y: -10) }
        }
        .shadow(color: selected ? Neon.cyan : .clear, radius: 16)
    }
}

/// A grid of light cards (the song maker's step 4 and the Lights picker).
struct LightsGrid: View {
    let audio: BlasterAudio
    let selectedID: String
    let pick: (String) -> Void

    var body: some View {
        FitGrid(items: VisualTile.all, cell: CGSize(width: 192, height: 150)) { tile in
            Button {
                Haptics.tap()
                pick(tile.id)
            } label: {
                LightCard(audio: audio, tile: tile, selected: tile.id == selectedID)
            }
            .buttonStyle(Squish())
        }
    }
}

/// A grid of music cards.
struct MusicGrid: View {
    let selectedID: String?
    let pick: (BlasterStyle) -> Void

    var body: some View {
        FitGrid(items: BlasterStyle.all, cell: CGSize(width: 168, height: 196)) { style in
            Button {
                Haptics.tap()
                pick(style)
            } label: {
                MusicCard(style: style, selected: style.id == selectedID)
            }
            .buttonStyle(Squish())
        }
    }
}

/// A pull-up panel with a title and a big Done button, over whatever is playing.
struct PickerPanel<Content: View>: View {
    let title: String
    let badge: KindBadge.Kind
    let close: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                KindBadge(kind: badge, size: 16)
                Text(title)
                    .blasterFont(size: 30, weight: .black)
                    .foregroundStyle(.white)
                Spacer()
                Button(action: close) {
                    Pill(icon: "✅", word: "Done", color: Neon.green.opacity(0.8), size: 22)
                }
                .buttonStyle(Squish())
            }
            // The grids size their cards to the panel, so it never scrolls.
            content.padding(.vertical, 8).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(20)
        .background(Neon.night.opacity(0.94), in: RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous).stroke(.white.opacity(0.3), lineWidth: 2))
        .padding(.horizontal, 12)
        .padding(.top, 70)
    }
}

/// The persistent bottom bar: MUSIC (what's playing, change it) and LIGHTS (which light, change it).
struct MusicLightsBar: View {
    let audio: BlasterAudio
    var musicTitle: String?
    var musicEmoji: String?
    var showMusicChange = true
    /// A short (landscape phone) window puts the two sections side by side in a slimmer bar.
    var short = false
    let changeMusic: () -> Void
    let changeLights: () -> Void

    var body: some View {
        let tile = VisualTile.with(id: audio.lightsID)
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                music(compact: short)
                lights(tile, compact: short)
            }
            VStack(spacing: 8) {
                music(compact: true)
                lights(tile, compact: true)
            }
        }
    }

    private func music(compact: Bool) -> some View {
        section(
            badge: .music, emoji: musicEmoji ?? audio.recipe.style.emoji,
            style: musicEmoji == nil ? audio.recipe.style : nil,
            title: musicTitle ?? audio.recipe.name, color: Neon.yellow, compact: compact, showChange: showMusicChange,
            change: changeMusic)
    }

    private func lights(_ tile: VisualTile, compact: Bool) -> some View {
        section(
            badge: .lights, emoji: nil, title: tile.name, color: Neon.cyan, compact: compact, showChange: true,
            change: changeLights)
    }

    private func section(
        badge: KindBadge.Kind, emoji: String?, style: BlasterStyle? = nil, title: String, color: Color, compact: Bool,
        showChange: Bool, change: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 10) {
            KindBadge(kind: badge, size: 13)
            if let style, Art.vibe(for: style) != nil {
                VibeArt(style: style, size: compact ? 30 : 36)
            } else if let emoji {
                Glyph(emoji, size: compact ? 22 : 26)
            }
            Text(title)
                .blasterFont(size: compact ? 17 : 20, weight: .black)
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Spacer(minLength: 4)
            if showChange {
                Button(action: change) {
                    Pill(icon: "🔄", word: "Change", color: color.opacity(0.6), size: compact ? 15 : 18)
                }
                .buttonStyle(Squish())
            }
        }
        .padding(.horizontal, compact ? 10 : 14)
        .padding(.vertical, compact ? 5 : 8)
        .frame(minWidth: compact ? nil : 340)
        .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(color.opacity(0.8), lineWidth: 2))
    }
}
