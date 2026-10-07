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
            case .rock: "Loud Guitars"
            case .folk: "Campfire"
            case .funk: "Funky Fresh"
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
            case .rock: "🤘"
            case .folk: "🪕"
            case .funk: "🕺"
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

    /// The genre a Beat Lab beat sounds like, from its speed and its groove: a kick on every beat is house or techno, a
    /// lone snare on beat 3 is half-time (lo-fi, dubstep, drum and bass), a wobbly bass line is dubstep or riddim.
    static func fitting(_ beat: BeatLab.Saved) -> BlasterStyle {
        func row(_ row: LabRow) -> [Int] {
            row.rawValue < beat.grid.count ? beat.grid[row.rawValue] : Array(repeating: 0, count: BeatLab.steps)
        }
        let kick = row(.kick)
        let snare = row(.snare)
        let fourOnFloor = [0, 4, 8, 12].allSatisfy { kick[$0] > 0 }
        let halfTime = snare[8] > 0 && snare[4] == 0 && snare[12] == 0
        let bassSound = LabRow.bass.rawValue < beat.sounds.count ? beat.sounds[LabRow.bass.rawValue] : 0
        let wobbly =
            row(.bass).contains { $0 > 0 }
            && [BassSound.wobble, .growl, .squelch].contains(
                BassSound.allCases[max(0, bassSound) % BassSound.allCases.count])
        switch beat.speed {
        case .slow: return .genre(halfTime ? .lofi : (fourOnFloor ? .chill : .funk))
        case .medium: return .genre(fourOnFloor ? .house : (wobbly || halfTime ? .dubstep : .trap))
        case .fast: return .genre(fourOnFloor ? .techno : (wobbly ? .riddim : (halfTime ? .drumAndBass : .ukGarage)))
        }
    }

    /// Vibes whose sound is a guitar: mashed in, they bring the guitar into the band.
    var hasGuitar: Bool { [.guitars, .genre(.rock), .genre(.folk), .genre(.funk)].contains(self) }

    /// Vibes whose sound is a held pad: mashed in, they bring the pads into the band.
    var hasPads: Bool { [.genre(.chill), .genre(.synthwave), .genre(.lofi)].contains(self) }
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
    /// A small tempo nudge on top of the speed choice (Mash it up: 0.94 ... 1.06).
    var tempoNudge = 1.0
    /// How much the library writes fresh material for this seed (progressions, drums, timbre, motifs); nil is the
    /// everyday default and Mash it up asks for the most. Optional so songs saved before it existed still load.
    var variety: Double?
    /// A Beat Lab beat the song is built around: it plays the drums (and the bass and keys, moved onto the song's
    /// chords) in place of the vibe's own. Nil for every other song, and for songs saved before it existed.
    var beat: BeatLab.Saved?

    static let defaultVariety = 0.75
    static let mashVariety = 1.0

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
        settings.variety = variety ?? Self.defaultVariety
        return settings
    }

    mutating func reroll() { seed = SongSettings.sessionSeed() &+ seed &* 0x9E37_79B9_7F4A_7C15 }

    /// A song built around a Beat Lab beat: the beat is the vibe (Logan 2026-10-07), so the genre is the one that fits
    /// it (`BlasterStyle.fitting`) and the song plays at the beat's own tempo, in its key, in a minor mode (the Lab's
    /// notes are written in F minor), named after the beat.
    static func around(_ beat: BeatLab.Saved, name: String) -> SongRecipe {
        let style = BlasterStyle.fitting(beat)
        var recipe = SongRecipe(style: style, name: name)
        recipe.beat = beat
        recipe.speed = beat.speed
        recipe.tempoNudge = BeatLab.bpm(beat.speed) / (style.baseBPM * beat.speed.scale)
        recipe.keyRoot = 60 + min(max(beat.key, 0), 11)
        recipe.mood = .dark
        // The beat's own sounds: its bass and keys sounds become the song's, and the plain kit leaves its drums as built.
        func sound(_ row: LabRow) -> Int { row.rawValue < beat.sounds.count ? max(0, beat.sounds[row.rawValue]) : 0 }
        recipe.sounds.drums = .classic
        recipe.sounds.bass = BassSound.allCases[sound(.bass) % BassSound.allCases.count]
        recipe.sounds.bassPatch = beat.bassPatch
        recipe.sounds.keys = [KeysSound.bell, .synth, .piano, .pad][sound(.keys) % 4]
        if recipe.sounds.keys == .pad { recipe.band.insert(.pads) }
        return recipe
    }

    /// "Mash it up": two different vibes in one song. The beat (genre, drums, chords and tempo) comes from one vibe
    /// and the sounds (bass, keys, drum kit, swing, guitar and pads) from the other, with a random light, speed and
    /// key, named from both: the sound vibe's first word and the beat vibe's last ("Wub" + "Campfire"). The beat
    /// vibe is never the one playing now, so a second tap always changes the song.
    static func mashUp(lightIDs: [String], after current: SongRecipe? = nil) -> SongRecipe {
        let beats = BlasterStyle.all.filter { $0 != current?.style }
        let beat = beats.randomElement() ?? .guitars
        let sound = BlasterStyle.all.filter { $0 != beat }.randomElement() ?? .genre(.dubstep)
        var next = SongRecipe(style: beat, name: mashName(beat: beat, sound: sound))
        next.lightsID = lightIDs.randomElement() ?? current?.lightsID ?? next.lightsID
        next.variety = Self.mashVariety
        next.speed = Speed.allCases.randomElement()!
        next.tempoNudge = Double.random(in: 0.94...1.06)
        next.keyRoot = Int.random(in: 60...71)
        next.sounds = SoundProfile.signature(of: sound)
        next.comping = [.stabs, .arpeggio, .strum, .folk].randomElement()!
        if sound.hasGuitar || beat.hasGuitar { next.band.insert(.guitar) }
        if sound.hasPads { next.band.insert(.pads) }
        return next
    }

    /// "Wub Campfire": the sound vibe's first word, then the beat vibe's last.
    static func mashName(beat: BlasterStyle, sound: BlasterStyle) -> String {
        let first = sound.funName.split(separator: " ").first.map(String.init) ?? sound.funName
        let last = beat.funName.split(separator: " ").last.map(String.init) ?? beat.funName
        return first == last ? beat.funName : "\(first) \(last)"
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
        persist()
    }

    /// Takes a song off the Play again row (its recordings stay in My Songs).
    func forget(_ id: SongRecipe.ID) {
        songs.removeAll { $0.id == id }
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(songs) { UserDefaults.standard.set(data, forKey: Self.key) }
    }
}

/// One-time hints: each is shown until the child first uses that control, then never again.
@MainActor enum Hints {
    static func seen(_ id: String) -> Bool { UserDefaults.standard.bool(forKey: "hint.\(id)") }
    static func markSeen(_ id: String) { UserDefaults.standard.set(true, forKey: "hint.\(id)") }

    /// A hint that nobody acts on still retires: it shows at most `limit` times, then counts as seen.
    static let limit = 3
    static func noteShown(_ id: String) {
        guard !seen(id) else { return }
        let key = "hint.shown.\(id)"
        let count = UserDefaults.standard.integer(forKey: key) + 1
        UserDefaults.standard.set(count, forKey: key)
        if count >= limit { markSeen(id) }
    }
}
