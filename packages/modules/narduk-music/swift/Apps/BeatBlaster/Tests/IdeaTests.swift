import XCTest

@testable import BeatBlaster

final class IdeaTests: XCTestCase {
    func testThereAreAtLeastFiftyPremisesAndTheyAreKidSafe() {
        XCTAssertGreaterThanOrEqual(Premises.count, 50)
        let banned = ["kill", "dead", "gun", "blood", "beer", "wine", "drug", "sex", "hate"]
        for subject in Premises.subjects {
            for situation in Premises.situations {
                let text = "\(subject) \(situation)".lowercased()
                XCTAssertFalse(banned.contains { text.contains($0) }, text)
            }
        }
        var generator = SystemRandomNumberGenerator()
        XCTAssertFalse(Premises.random(using: &generator).isEmpty)
    }

    func testKidWordsPickTheMoodGenreAndSpeed() {
        let spooky = IdeaParser.parse("a spooky ghost story")
        XCTAssertEqual(spooky.mood, .spooky)
        let race = IdeaParser.parse("fast race cars")
        XCTAssertEqual(race.style, .genre(.drumAndBass))
        XCTAssertEqual(race.speed, .fast)
        let nap = IdeaParser.parse("a sleepy cat nap")
        XCTAssertEqual(nap.style, .genre(.lofi))
        XCTAssertEqual(nap.speed, .slow)
        XCTAssertEqual(IdeaParser.parse("chill beach party").speed, .slow)
        XCTAssertEqual(IdeaParser.parse("Dragons!!").style, .genre(.dubstep), "plurals and punctuation still match")
        XCTAssertEqual(IdeaParser.parse("robot dance party").matched.count, 3)
    }

    func testTheSameIdeaAlwaysWritesTheSameSong() {
        XCTAssertEqual(IdeaParser.parse("pizza party"), IdeaParser.parse("pizza party"))
    }

    func testTwoDifferentIdeasAlwaysSoundClearlyDifferent() {
        let ideas = [
            "space dragons", "rainy day", "robot dance party", "dinosaur race", "pizza party", "ninja battle",
            "ocean float", "sleepy cat", "haunted castle", "skate park", "campfire", "funky monkey",
        ]
        let songs = ideas.map(IdeaParser.parse)
        for i in 0..<songs.count {
            for j in (i + 1)..<songs.count {
                let a = songs[i]
                let b = songs[j]
                let differing = [
                    a.style != b.style, a.mood != b.mood, a.keyPitchClass != b.keyPitchClass, a.speed != b.speed,
                    a.tempoNudge != b.tempoNudge, a.comping != b.comping, a.voicing != b.voicing,
                ]
                .filter { $0 }.count
                XCTAssertGreaterThanOrEqual(differing, 2, "\(ideas[i]) vs \(ideas[j])")
                XCTAssertNotEqual(a.seed, b.seed)
            }
        }
    }

    func testNothingTypedStillWritesASong() {
        let idea = IdeaParser.parse("   ")
        XCTAssertFalse(idea.title.isEmpty)
        XCTAssertEqual(Dreamer.keywordDream("").title, idea.title)
    }

    func testAPremiseBecomesTheSongName() {
        let song = Dreamer.keywordDream("Robot ninjas on the moon")
        var recipe = SongRecipe(from: song.recipe, style: song.style)
        recipe.name = "Robot ninjas on the moon"
        XCTAssertEqual(recipe.name, "Robot ninjas on the moon")
        XCTAssertEqual(recipe.mood, song.mood)
        XCTAssertEqual(recipe.keyRoot, 60 + song.keyPitchClass)
    }
}
