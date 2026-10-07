import Foundation
import NardukMusicCore
import NardukMusicEngine
import SwiftUI

/// What the beat player plays (adapted from the SoundGallery's `GallerySongStyle`): the built-in demo loop, a genre
/// written live by the conductor, or the hand-written guitar part.
enum BlasterStyle: Hashable, Identifiable {
    case demo
    case genre(Genre)
    case guitars

    var id: String {
        switch self {
        case .demo: "demo"
        case .genre(let genre): "genre-\(genre.rawValue)"
        case .guitars: "guitars"
        }
    }

    static var all: [BlasterStyle] {
        [.demo] + Genre.allCases.map(BlasterStyle.genre) + [.guitars]
    }

    /// The kid-facing name.
    var funName: String {
        switch self {
        case .demo: "Classic Blast"
        case .guitars: "Rock Star"
        case .genre(let genre):
            switch genre {
            case .dubstep: "Wub Monster"
            case .riddim: "Robot Stomp"
            case .drumAndBass: "Speed Racer"
            case .trap: "Big Boom"
            case .house: "Dance Party"
            case .chill: "Cloud Float"
            case .techno: "Laser Factory"
            case .ukGarage: "Skate Park"
            case .synthwave: "Neon Drive"
            case .lofi: "Sleepy Cat"
            }
        }
    }

    var emoji: String {
        switch self {
        case .demo: "🎮"
        case .guitars: "🎸"
        case .genre(let genre):
            switch genre {
            case .dubstep: "👾"
            case .riddim: "🤖"
            case .drumAndBass: "🏎️"
            case .trap: "💥"
            case .house: "🪩"
            case .chill: "☁️"
            case .techno: "⚡️"
            case .ukGarage: "🛹"
            case .synthwave: "🌆"
            case .lofi: "🐱"
            }
        }
    }

    /// The real genre name, small under the fun one.
    var genreName: String {
        switch self {
        case .demo: "Demo loop"
        case .guitars: "Guitars"
        case .genre(let genre): genre.shortName
        }
    }

    var color: Color {
        let index = BlasterStyle.all.firstIndex(of: self) ?? 0
        return Neon.cycle[index % Neon.cycle.count]
    }
}

/// One song: a style, the seed that makes it different from the next one, and a tempo nudge.
struct BlasterSong: Hashable {
    var style: BlasterStyle = .demo
    var seed: UInt64 = SongSettings.sessionSeed()
    /// A title from Dream a Song; nil shows the style's fun name.
    var title: String?

    var displayTitle: String { title ?? style.funName }

    /// The song settings the engine runs. Each genre plays at its own tempo; the guitars sit at a relaxed 96.
    var settings: SongSettings {
        switch style {
        case .genre(let genre):
            var settings = SongSettings(genre: genre)
            settings.seed = seed
            return settings
        case .guitars:
            var settings = SongSettings(genre: .chill)
            settings.bpm = 96
            settings.seed = seed
            return settings
        case .demo:
            return SongSettings()
        }
    }

    mutating func reroll() { seed = SongSettings.sessionSeed() &+ seed &* 0x9E37_79B9_7F4A_7C15 }
}
