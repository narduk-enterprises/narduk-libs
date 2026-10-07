import Foundation
import NardukMusicCore

/// What a child's words say about the song they want. Built without any model, so it works on every iPad: the iPads
/// this app is for (9th and 10th generation) have no Apple Intelligence, so keywords and synonyms are the main path
/// and the on-device model (`Dreamer`) only refines the result where it exists.
struct SongIdea: Equatable {
    var style: BlasterStyle
    var mood: Mood
    var speed: Speed
    /// Key root as a pitch class, 0 (C) ... 11 (B).
    var keyPitchClass: Int
    /// A small tempo nudge on the speed (0.96 ... 1.04).
    var tempoNudge: Double
    /// How the chords are played and voiced, from the words' hash, so two ideas rarely share a chord feel.
    var comping: CompingPattern
    var voicing: ChordVoicing
    var seed: UInt64
    var title: String
    /// The words that decided something, for tests and the "because you said ..." line.
    var matched: [String]
}

enum IdeaParser {
    /// Lowercased words, with a plural "s" or "es" removed so "dragons" finds "dragon".
    static func words(_ text: String) -> [String] {
        text.lowercased().split { !$0.isLetter }.map { word in
            let w = String(word)
            if w.count > 4, w.hasSuffix("es") { return String(w.dropLast(2)) }
            if w.count > 3, w.hasSuffix("s"), !w.hasSuffix("ss") { return String(w.dropLast()) }
            return w
        }
    }

    // Kid vocabulary by style. Each word is one vote for its style; the most votes win, ties go to the hash.
    static let styleWords: [(BlasterStyle, [String])] = [
        (
            .genre(.dubstep),
            [
                "dragon", "monster", "wub", "bass", "giant", "zombie", "beast", "troll", "ogre", "volcano", "dinosaur",
                "dino", "godzilla", "kraken", "yeti", "bigfoot", "shark", "scary",
            ]
        ),
        (
            .genre(.riddim),
            ["robot", "machine", "android", "mech", "computer", "glitch", "stomp", "cyborg", "transformer", "tank"]
        ),
        (
            .genre(.drumAndBass),
            [
                "race", "racing", "car", "fast", "speed", "zoom", "chase", "jet", "run", "rush", "cheetah", "truck",
                "motorcycle", "airplane", "plane", "rollercoaster", "escape",
            ]
        ),
        (
            .genre(.trap),
            [
                "boom", "battle", "ninja", "boss", "explosion", "superhero", "fight", "hero", "villain", "pirate",
                "wrestling", "tiger", "lion", "bomb", "dragonfight", "samurai", "knight", "war",
            ]
        ),
        (
            .genre(.house),
            [
                "dance", "party", "disco", "birthday", "happy", "celebrate", "confetti", "pizza", "cake", "balloon",
                "sing", "fun", "candy", "ice", "cream", "carnival", "circus", "clown",
            ]
        ),
        (
            .genre(.chill),
            [
                "cloud", "calm", "ocean", "beach", "float", "dream", "relax", "mermaid", "unicorn", "rainbow",
                "fairy", "butterfly", "whale", "dolphin", "sky", "bubble", "garden", "flower",
            ]
        ),
        (
            .genre(.techno),
            [
                "laser", "factory", "electric", "lightning", "neon", "thunder", "storm", "power", "circuit",
                "battery", "lab", "science", "volt", "spark",
            ]
        ),
        (
            .genre(.ukGarage),
            [
                "skate", "skateboard", "cool", "street", "bike", "scooter", "park", "basketball", "soccer",
                "playground", "jump", "trampoline", "parkour", "swing", "slide",
            ]
        ),
        (
            .genre(.synthwave),
            [
                "space", "star", "rocket", "alien", "planet", "galaxy", "moon", "astronaut", "ufo", "comet",
                "retro", "sunset", "arcade", "game", "video", "future", "cosmic", "mars", "orbit",
            ]
        ),
        (
            .genre(.lofi),
            [
                "rain", "sleep", "night", "cozy", "cat", "study", "snow", "bed", "bedtime", "kitten", "puppy",
                "tea", "quiet", "book", "pajama", "sleepy", "homework", "blanket", "cocoa", "nap", "rainy",
            ]
        ),
        (
            .genre(.rock),
            ["rock", "concert", "stage", "drum", "loud", "punk", "metal", "mosh", "stadium", "amp"]
        ),
        (
            .genre(.folk),
            [
                "camp", "campfire", "cowboy", "farm", "forest", "tent", "picnic", "horse", "barn", "hike", "country",
                "tractor", "cow", "pig", "chicken", "duck", "marshmallow",
            ]
        ),
        (
            .genre(.funk),
            [
                "funk", "funky", "groove", "banana", "jello", "silly", "wiggle", "slime", "bounce", "jungle",
                "monkey", "goofy", "pancake", "waffle", "noodle", "sparkle",
            ]
        ),
        (.guitars, ["guitar", "band", "rockstar", "ukulele", "strum", "acoustic"]),
    ]

    static let moodWords: [(Mood, [String])] = [
        (
            .spooky,
            [
                "spooky", "ghost", "haunted", "scary", "witch", "vampire", "skeleton", "halloween", "creepy",
                "zombie", "mummy", "graveyard", "bat", "spider",
            ]
        ),
        (.dark, ["dark", "night", "shadow", "villain", "storm", "evil", "cave", "black", "midnight", "sad", "lonely"]),
        (
            .dreamy,
            [
                "dream", "cloud", "float", "fairy", "unicorn", "magic", "rainbow", "sparkle", "mermaid", "star",
                "sleepy", "sleep", "moon", "bubble", "castle",
            ]
        ),
        (
            .happy,
            [
                "happy", "party", "birthday", "fun", "sunny", "smile", "silly", "celebrate", "joy", "sun", "summer",
                "candy", "pizza", "cake", "balloon", "puppy", "beach",
            ]
        ),
        (.cool, ["cool", "chill", "street", "skate", "awesome", "swag", "smooth", "ninja", "robot", "laser", "space"]),
    ]

    static let fastWords: Set<String> = [
        "fast", "speed", "race", "racing", "zoom", "quick", "rush", "rocket", "cheetah", "run", "chase", "hurry",
        "turbo",
        "crazy", "wild", "jump", "boom",
    ]
    static let slowWords: Set<String> = [
        "slow", "sleepy", "sleep", "calm", "lazy", "float", "turtle", "snail", "relax", "quiet", "cozy", "chill", "nap",
        "bedtime", "gentle", "soft", "rain", "rainy",
    ]

    static let endings = ["Anthem", "Groove", "Blast", "Jam", "Party", "Stomp", "Boogie", "Adventure"]

    /// FNV-1a leaves similar words with similar bits; a finalizer spreads them so every field of the idea is independent.
    static func scramble(_ value: UInt64) -> UInt64 {
        var x = value &+ 0x9E37_79B9_7F4A_7C15
        x = (x ^ (x >> 30)) &* 0xBF58_476D_1CE4_E5B9
        x = (x ^ (x >> 27)) &* 0x94D0_49BB_1331_11EB
        return x ^ (x >> 31)
    }

    static func parse(_ text: String) -> SongIdea {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let tokens = words(clean)
        let hash = scramble(StableHash.fnv1a(clean.lowercased().isEmpty ? "beat blaster" : clean.lowercased()))
        var matched: [String] = []

        var votes: [Int: Int] = [:]
        for (index, rule) in styleWords.enumerated() {
            for token in tokens where rule.1.contains(token) {
                votes[index, default: 0] += 1
                matched.append(token)
            }
        }
        let styles = BlasterStyle.all
        let style: BlasterStyle
        if let best = votes.values.max() {
            let top = votes.filter { $0.value == best }.keys.sorted()
            style = styleWords[top[Int(hash % UInt64(top.count))]].0
        } else {
            style = styles[Int(hash % UInt64(styles.count))]
        }

        var moodVotes: [Mood: Int] = [:]
        for (mood, list) in moodWords {
            for token in tokens where list.contains(token) { moodVotes[mood, default: 0] += 1 }
        }
        let mood: Mood
        if let best = moodVotes.values.max() {
            // Order of `moodWords` decides ties, so "spooky" beats "dark" beats "dreamy".
            mood = moodWords.first { moodVotes[$0.0] == best }!.0
        } else {
            mood = Mood.allCases[Int((hash >> 12) % UInt64(Mood.allCases.count))]
        }

        let fast = tokens.contains { fastWords.contains($0) }
        let slow = tokens.contains { slowWords.contains($0) }
        let speed: Speed = fast && !slow ? .fast : (slow && !fast ? .slow : .medium)

        let key = Int((hash >> 20) % 12)
        let nudge = 0.96 + Double((hash >> 28) % 9) / 100  // 0.96 ... 1.04
        let comping = [CompingPattern.stabs, .arpeggio, .strum, .folk][Int((hash >> 36) % 4)]
        let voicings = ChordVoicing.allCases
        let voicing = voicings[Int((hash >> 40) % UInt64(voicings.count))]
        let seed = hash &* 0x9E37_79B9_7F4A_7C15 | 1

        let titleWords = clean.split(separator: " ").prefix(4).map { $0.prefix(1).uppercased() + $0.dropFirst() }
        let ending = endings[Int((hash >> 8) % UInt64(endings.count))]
        let title = titleWords.isEmpty ? "Mystery \(ending)" : "\(titleWords.joined(separator: " ")) \(ending)"
        return SongIdea(
            style: style, mood: mood, speed: speed, keyPitchClass: key, tempoNudge: nudge, comping: comping,
            voicing: voicing, seed: seed, title: title, matched: matched)
    }
}

/// Kid-safe song premises: a subject doing a silly thing, mixed and matched ("Space dragons at a pizza party").
enum Premises {
    static let subjects = [
        "Space dragons", "Robot ninjas", "A sleepy kitten", "Dancing dinosaurs", "Pirate penguins", "A giant pizza",
        "Disco unicorns", "Racing llamas", "Funky monkeys", "A friendly ghost", "Cowboy cats", "Super hamsters",
        "Laser sharks", "A dragon band",
    ]
    static let situations = [
        "at a pizza party", "on the moon", "in a race", "at the beach", "in a haunted castle", "on a rainy day",
        "at the skate park", "in a big battle", "around the campfire", "at a birthday party", "in the jungle",
        "on a rollercoaster",
    ]

    static var count: Int { subjects.count * situations.count }

    static func random<G: RandomNumberGenerator>(using generator: inout G) -> String {
        "\(subjects.randomElement(using: &generator)!) \(situations.randomElement(using: &generator)!)"
    }

    static func random() -> String {
        var generator = SystemRandomNumberGenerator()
        return random(using: &generator)
    }
}
