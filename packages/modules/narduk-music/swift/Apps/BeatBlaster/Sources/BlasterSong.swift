import Foundation
import NardukMusicCore
import NardukMusicEngine
import SwiftUI

/// A music style ("vibe"): a genre written live by the conductor, or the hand-written guitar band.
enum BlasterStyle: Hashable, Identifiable, Codable {
    case genre(Genre)
    case guitars

    var id: String {
        switch self {
        case .genre(let genre): "genre-\(genre.rawValue)"
        case .guitars: "guitars"
        }
    }

    static var all: [BlasterStyle] { Genre.allCases.map(BlasterStyle.genre) + [.guitars] }

    static func with(id: String) -> BlasterStyle? { all.first { $0.id == id } }

    /// The kid-facing name.
    var funName: String {
        switch self {
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
        case .guitars: "Guitar band"
        case .genre(let genre): genre.shortName
        }
    }

    var color: Color {
        let index = BlasterStyle.all.firstIndex(of: self) ?? 0
        return Neon.cycle[index % Neon.cycle.count]
    }

    /// The style's own tempo before the speed choice.
    var baseBPM: Double {
        switch self {
        case .genre(let genre): SongSettings(genre: genre).bpm
        case .guitars: 96
        }
    }
}

/// How fast: a nudge on the style's own tempo.
enum Speed: String, CaseIterable, Identifiable, Codable {
    case slow, medium, fast

    var id: String { rawValue }
    var scale: Double {
        switch self {
        case .slow: 0.82
        case .medium: 1
        case .fast: 1.18
        }
    }
    var emoji: String {
        switch self {
        case .slow: "🐢"
        case .medium: "🚶"
        case .fast: "🐇"
        }
    }
    var word: String { rawValue.capitalized }
}

/// The band: which instrument groups play. The player filters the conductor's notes by these and adds the chord
/// layers (pads and keys through the conductor's comping, guitar as power-chord strums on the bass line's root).
enum BandPart: String, CaseIterable, Identifiable, Codable {
    case drums, bass, guitar, keys, pads

    var id: String { rawValue }
    var word: String { rawValue.capitalized }
    var emoji: String {
        switch self {
        case .drums: "🥁"
        case .bass: "🔊"
        case .guitar: "🎸"
        case .keys: "🎹"
        case .pads: "🌌"
        }
    }

    /// The group a note belongs to; nil for the effects, which always play.
    static func of(_ note: ScheduledNote) -> BandPart? {
        switch note.instrument {
        case .kick, .snare, .hat, .openHat: .drums
        case .wobble, .sub, .bassGuitar: .bass
        case .acousticGuitar, .electricGuitar, .strum, .electricStrum: .guitar
        case .keys: note.params.voice == 3 ? .pads : .keys
        default: nil
        }
    }

    static let everyone: Set<BandPart> = [.drums, .bass, .keys]
}

/// Everything that makes one song: what the guided maker produces and "My Songs" keeps.
struct SongRecipe: Codable, Hashable, Identifiable {
    var id = UUID()
    var name: String
    var styleID: String
    var seed: UInt64
    var speed: Speed = .medium
    var band: Set<BandPart> = BandPart.everyone
    var lightsID: String = "tunnel"
    /// MIDI root of the key, 60 ... 71 (65 = F, the engine's default).
    var keyRoot = 65
    /// nil lets the genre pick its own mode per track.
    var mood: Mood?
    var sounds = SoundProfile()
    /// The keys' chord pattern when Keys plays (Pads always hold chords).
    var comping: CompingPattern = .arpeggio
    var voicing: ChordVoicing?
    /// A small tempo nudge on top of the speed choice (Surprise me: 0.94 ... 1.06).
    var tempoNudge = 1.0

    var style: BlasterStyle { BlasterStyle.with(id: styleID) ?? .genre(.dubstep) }

    init(style: BlasterStyle, name: String? = nil, seed: UInt64 = SongSettings.sessionSeed()) {
        styleID = style.id
        self.seed = seed
        self.name = name ?? FunNames.random()
        if style == .guitars {
            band = [.drums, .bass, .guitar]
            sounds.bass = .pluck
        }
    }

    var settings: SongSettings {
        var settings: SongSettings
        switch style {
        case .genre(let genre): settings = SongSettings(genre: genre)
        case .guitars: settings = SongSettings(genre: .chill)
        }
        settings.bpm = style.baseBPM * speed.scale * tempoNudge
        settings.seed = seed
        settings.keyRoot = keyRoot
        settings.mode = mood?.mode
        settings.voicing = voicing
        return settings
    }

    mutating func reroll() { seed = SongSettings.sessionSeed() &+ seed &* 0x9E37_79B9_7F4A_7C15 }

    /// A whole new song: another style (never the same one twice in a row), speed, key, mood, band, chord pattern and
    /// voicing, every sound, and a new seed. The lights stay.
    func surprise() -> SongRecipe {
        let styles = BlasterStyle.all.filter { $0 != style }
        var next = SongRecipe(style: styles.randomElement() ?? .guitars)
        next.lightsID = lightsID
        next.speed = Speed.allCases.randomElement()!
        next.tempoNudge = Double.random(in: 0.94...1.06)
        next.keyRoot = Int.random(in: 60...71)
        next.mood = Mood.allCases.randomElement()
        next.sounds = SoundProfile.random()
        next.comping = [.stabs, .arpeggio, .strum, .folk].randomElement()!
        next.voicing = ChordVoicing.allCases.randomElement()
        var band: Set<BandPart> = [.drums, .bass]
        let extras: [BandPart] = [.guitar, .keys, .pads].shuffled()
        for part in extras.prefix(Int.random(in: 1...2)) { band.insert(part) }
        if next.style == .guitars { band.insert(.guitar) }
        next.band = band
        return next
    }
}

/// Silly song names.
enum FunNames {
    static let first = [
        "Turbo", "Cosmic", "Wiggly", "Mega", "Sneaky", "Bouncy", "Laser", "Sparkly", "Thunder", "Funky", "Rocket",
        "Pickle", "Disco", "Ninja", "Fuzzy", "Galaxy",
    ]
    static let second = [
        "Llama", "Robot", "Taco", "Dragon", "Penguin", "Banana", "Unicorn", "Volcano", "Hamster", "Waffle", "Comet",
        "Octopus", "Pizza", "Dino", "Monkey", "Noodle",
    ]
    static let third = ["Party", "Groove", "Jam", "Stomp", "Blast", "Boogie", "Anthem", "Dance"]

    static func random() -> String {
        "\(first.randomElement()!) \(second.randomElement()!) \(third.randomElement()!)"
    }
}

/// The last few songs, newest first, kept on this device only (UserDefaults; nothing leaves the iPad).
@MainActor @Observable final class MySongs {
    private(set) var songs: [SongRecipe] = []
    private static let key = "mySongs.v2"
    static let limit = 8

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
            let decoded = try? JSONDecoder().decode([SongRecipe].self, from: data)
        {
            songs = decoded
        }
    }

    func save(_ recipe: SongRecipe) {
        songs.removeAll { $0.id == recipe.id }
        songs.insert(recipe, at: 0)
        songs = Array(songs.prefix(Self.limit))
        if let data = try? JSONEncoder().encode(songs) { UserDefaults.standard.set(data, forKey: Self.key) }
    }
}

/// One-time hints: each is shown until the child first uses that control, then never again.
@MainActor enum Hints {
    static func seen(_ id: String) -> Bool { UserDefaults.standard.bool(forKey: "hint.\(id)") }
    static func markSeen(_ id: String) { UserDefaults.standard.set(true, forKey: "hint.\(id)") }
}
