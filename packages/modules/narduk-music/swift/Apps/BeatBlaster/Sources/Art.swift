import NardukMusicCore
import SwiftUI

/// The neon art kit (`design/assets/ios/Images.xcassets`): full-colour icons and vibe cards, never tinted or redrawn.
enum Art {
    /// Emoji used in the UI's labels, mapped to their kit icon (an `icon-` name passes through unchanged).
    static let icons: [String: String] = [
        "🏠": "icon-home", "🎲": "icon-surprise", "➕": "icon-new-song", "💣": "icon-drop", "🎵": "icon-music",
        "💡": "icon-lights", "👁": "icon-hide", "🙈": "icon-hide", "🙉": "icon-show", "🎙": "icon-record",
        "🎤": "icon-mic", "✨": "icon-dream", "✏️": "icon-rename", "📤": "icon-share", "🗑": "icon-trash",
        "⚡️": "icon-energy", "😌": "icon-chill", "🔥": "icon-hype", "🥁": "icon-drums", "🔊": "icon-bass",
        "🎸": "icon-guitar", "🎹": "icon-keys", "🌌": "icon-pads", "🎛": "icon-pads", "🎛️": "icon-pads",
        "✅": "icon-check", "🌊": "icon-wobble", "🔁": "icon-echo", "🐢": "icon-slow", "🚶": "icon-medium", "🐇": "icon-fast",
        "🦶": "icon-kick", "🎩": "icon-hat", "📯": "icon-air-horn",
        "🔫": "icon-laser", "💿": "icon-scratch", "💥": "icon-boom", "🚨": "icon-siren", "👏": "icon-clap",
        "🗣": "icon-shout", "🔔": "icon-bell",
    ]

    static func icon(for emoji: String) -> String? {
        let trimmed = emoji.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("icon-") { return trimmed }
        return icons[trimmed]
    }

    /// The vibe-card illustration for a style (nil: no art, show the emoji).
    static func vibe(for style: BlasterStyle) -> String? {
        switch style {
        case .guitars: "vibe-rock-star"
        case .genre(let genre):
            switch genre {
            case .dubstep: "vibe-dubstep"
            case .riddim: "vibe-riddim"
            case .drumAndBass: "vibe-drum-and-bass"
            case .trap: "vibe-trap"
            case .house: "vibe-house"
            case .chill: "vibe-chill"
            case .techno: "vibe-techno"
            case .ukGarage: "vibe-uk-garage"
            case .synthwave: "vibe-synthwave"
            case .lofi: "vibe-lofi"
            case .rock: "vibe-rock"
            case .folk: "vibe-folk"
            case .funk: "vibe-funk"
            }
        }
    }
}

/// An icon from the kit when there is one for `emoji`, else the emoji itself at the same size.
struct Glyph: View {
    let emoji: String
    let size: CGFloat

    init(_ emoji: String, size: CGFloat) {
        self.emoji = emoji
        self.size = size
    }

    var body: some View {
        if let name = Art.icon(for: emoji) {
            Image(name)
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(width: size * 1.15, height: size * 1.15)
                .accessibilityHidden(true)
        } else {
            Text(emoji).font(.system(size: size))
        }
    }
}

/// A style's vibe card (or, without art, its emoji).
struct VibeArt: View {
    let style: BlasterStyle
    let size: CGFloat

    var body: some View {
        if let name = Art.vibe(for: style) {
            Image(name)
                .renderingMode(.original)
                .resizable()
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size * 0.18, style: .continuous))
                .accessibilityHidden(true)
        } else {
            Text(style.emoji).font(.system(size: size * 0.7))
        }
    }
}
