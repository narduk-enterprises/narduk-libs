import Foundation
import NardukMusicCore
import SwiftUI

#if canImport(FoundationModels)
    import FoundationModels
#endif

/// A song idea from a prompt: the style, a seed, a tempo nudge and a title.
struct DreamedSong: Equatable {
    var style: BlasterStyle
    var seed: UInt64
    var tempoScale: Double
    var title: String
}

/// Turns "space dragons" into a song. Uses the on-device model (iOS 26 Apple Intelligence) when it is available and
/// falls back to keywords and a hash of the prompt otherwise, so it always works offline and never fails.
enum Dreamer {
    static func dream(_ prompt: String) async -> DreamedSong {
        let fallback = keywordDream(prompt)
        #if canImport(FoundationModels)
            if #available(iOS 26, *), let idea = await modelDream(prompt) {
                let style = BlasterStyle.all.first { $0.funName == idea.style } ?? fallback.style
                let base = style.baseBPM
                let scale = [0.8, 1.0, 1.2].min {
                    abs($0 * base - Double(idea.bpm)) < abs($1 * base - Double(idea.bpm))
                }
                let title = idea.title.trimmingCharacters(in: .whitespacesAndNewlines)
                return DreamedSong(
                    style: style, seed: fallback.seed, tempoScale: scale ?? 1,
                    title: title.isEmpty ? fallback.title : String(title.prefix(40)))
            }
        #endif
        return fallback
    }

    /// Keyword matching plus a hash-seeded pick; deterministic for a given prompt.
    static func keywordDream(_ prompt: String) -> DreamedSong {
        let text = prompt.lowercased()
        let hash = StableHash.fnv1a(text.isEmpty ? "beat blaster" : text)
        let rules: [([String], BlasterStyle, Double)] = [
            (["space", "star", "rocket", "alien", "planet", "galaxy", "moon"], .genre(.synthwave), 1),
            (["dragon", "monster", "dinosaur", "dino", "giant", "zombie"], .genre(.dubstep), 1),
            (["rain", "sleep", "night", "cozy", "cat", "study", "snow"], .genre(.lofi), 1),
            (["cloud", "calm", "ocean", "beach", "float", "dream"], .genre(.chill), 1),
            (["robot", "machine", "computer", "glitch"], .genre(.riddim), 1),
            (["dance", "party", "disco", "birthday", "happy"], .genre(.house), 1),
            (["race", "fast", "car", "speed", "run", "chase", "zoom"], .genre(.drumAndBass), 1.2),
            (["guitar", "rock", "band", "cowboy", "camp"], .guitars, 1),
            (["laser", "factory", "electric", "lightning", "neon"], .genre(.techno), 1),
            (["skate", "cool", "street", "bike"], .genre(.ukGarage), 1),
            (["boom", "battle", "ninja", "boss", "explosion", "superhero"], .genre(.trap), 1),
        ]
        let match = rules.first { rule in rule.0.contains { text.contains($0) } }
        let styles = BlasterStyle.all
        let style = match?.1 ?? styles[Int(hash % UInt64(styles.count))]
        let endings = ["Anthem", "Groove", "Blast", "Jam", "Party", "Stomp", "Boogie", "Adventure"]
        let words = prompt.split(separator: " ").prefix(4).map { $0.prefix(1).uppercased() + $0.dropFirst() }
        let title =
            words.isEmpty
            ? "Mystery \(endings[Int((hash >> 8) % 8)])"
            : "\(words.joined(separator: " ")) \(endings[Int((hash >> 8) % 8)])"
        return DreamedSong(style: style, seed: hash, tempoScale: match?.2 ?? 1, title: title)
    }

    #if canImport(FoundationModels)
        @available(iOS 26, *)
        @Generable
        struct SongIdea {
            @Guide(description: "A fun, silly, kid-friendly song title of two to five words")
            var title: String
            @Guide(.anyOf(BlasterStyle.all.map(\.funName)))
            var style: String
            @Guide(description: "Beats per minute", .range(70...180))
            var bpm: Int
        }

        @available(iOS 26, *)
        static func modelDream(_ prompt: String) async -> SongIdea? {
            guard case .available = SystemLanguageModel.default.availability else { return nil }
            let styles = BlasterStyle.all.map { "\($0.funName) (\($0.genreName))" }.joined(separator: ", ")
            let session = LanguageModelSession(
                instructions: """
                    You pick music for a kids' music toy. Given a child's idea for a song, choose the music style that \
                    fits best, a tempo, and a short, fun, kid-friendly title. Styles: \(styles).
                    """)
            do {
                let response = try await session.respond(
                    to: "Song idea: \(prompt)", generating: SongIdea.self)
                return response.content
            } catch {
                return nil
            }
        }
    #endif
}

/// Dream a Song: type (or tap) an idea, get a song with a title, then play it.
struct DreamView: View {
    let audio: BlasterAudio
    let home: () -> Void
    let play: (SongRecipe) -> Void
    @State private var prompt = ""
    @State private var dreaming = false
    @State private var result: DreamedSong?
    @FocusState private var typing: Bool

    private let ideas = [
        "🐉 space dragons", "🌧️ rainy day", "🤖 robot dance party", "🦖 dinosaur race", "🍕 pizza party",
        "🥷 ninja battle", "🌊 ocean float", "🐱 sleepy cat",
    ]

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            ZStack(alignment: .topLeading) {
                LinearGradient(
                    colors: [Neon.night, Color(red: 0.2, green: 0.05, blue: 0.35)], startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
                .onTapGesture { typing = false }
                ScrollView {
                    VStack(spacing: compact ? 18 : 28) {
                        Text("✨ Dream a Song ✨")
                            .font(.system(size: compact ? 36 : 64, weight: .black, design: .rounded))
                            .foregroundStyle(
                                LinearGradient(
                                    colors: [Neon.cyan, Neon.purple, Neon.pink], startPoint: .leading,
                                    endPoint: .trailing)
                            )
                            .shadow(color: Neon.purple, radius: 16)
                            .padding(.top, compact ? 70 : 60)
                        TextField("What should your song be about?", text: $prompt)
                            .font(.system(size: compact ? 22 : 30, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 24)
                            .frame(height: compact ? 64 : 84)
                            .background(.white.opacity(0.1), in: Capsule())
                            .overlay(Capsule().stroke(Neon.cyan, lineWidth: 3))
                            .shadow(color: Neon.cyan.opacity(0.6), radius: 12)
                            .focused($typing)
                            .submitLabel(.go)
                            .onSubmit(dream)
                            .frame(maxWidth: 760)
                        FlowChips(ideas: ideas) { idea in
                            Haptics.tap()
                            prompt = String(idea.drop { $0 != " " }.dropFirst())
                            dream()
                        }
                        .frame(maxWidth: 860)
                        Button(action: dream) {
                            Pill(
                                icon: dreaming ? "💭" : "🪄", word: dreaming ? "Dreaming…" : "Dream it!",
                                color: Neon.pink.opacity(0.85), size: compact ? 24 : 32)
                        }
                        .buttonStyle(Squish())
                        .disabled(dreaming)
                        if let result {
                            resultCard(result, compact: compact)
                                .transition(.scale(scale: 0.5).combined(with: .opacity))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(compact ? 16 : 32)
                }
                HomeButton(action: home).padding(compact ? 14 : 24)
            }
        }
        .animation(.spring(response: 0.5, dampingFraction: 0.6), value: result)
        .task {
            // `-dream "<idea>"` dreams at launch, for smoke runs and screenshots.
            if let idea = UserDefaults.standard.string(forKey: "dream") {
                prompt = idea
                dream()
            }
        }
    }

    private func dream() {
        guard !dreaming else { return }
        typing = false
        dreaming = true
        let text = prompt
        Task {
            let song = await Dreamer.dream(text)
            dreaming = false
            result = song
            Haptics.success()
        }
    }

    private func resultCard(_ song: DreamedSong, compact: Bool) -> some View {
        VStack(spacing: 14) {
            Text(song.style.emoji).font(.system(size: compact ? 70 : 100))
            Text(song.title)
                .font(.system(size: compact ? 28 : 44, weight: .black, design: .rounded))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            Text(song.style.funName + " • " + song.style.genreName)
                .font(.system(size: compact ? 16 : 22, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.8))
            Button {
                var recipe = SongRecipe(style: song.style, name: song.title, seed: song.seed)
                recipe.speed = song.tempoScale < 0.95 ? .slow : (song.tempoScale > 1.05 ? .fast : .medium)
                play(recipe)
            } label: {
                Pill(icon: "▶︎", word: "Play it!", color: Neon.green.opacity(0.85), size: compact ? 24 : 32)
            }
            .buttonStyle(Squish())
        }
        .padding(compact ? 20 : 32)
        .frame(maxWidth: 640)
        .background(song.style.color.opacity(0.35), in: RoundedRectangle(cornerRadius: 36, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 36, style: .continuous).stroke(.white.opacity(0.6), lineWidth: 3))
        .shadow(color: song.style.color, radius: 24)
    }
}

/// Idea chips that wrap onto as many rows as they need.
struct FlowChips: View {
    let ideas: [String]
    let tap: (String) -> Void

    var body: some View {
        ChipLayout(spacing: 12) {
            ForEach(ideas, id: \.self) { idea in
                Button {
                    tap(idea)
                } label: {
                    Text(idea)
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .frame(height: 54)
                        .background(Neon.purple.opacity(0.45), in: Capsule())
                        .overlay(Capsule().stroke(.white.opacity(0.5), lineWidth: 2))
                }
                .buttonStyle(Squish())
            }
        }
    }
}

/// A simple centred wrapping layout.
struct ChipLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX + (bounds.width - row.width) / 2
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let added =
                rows[rows.count - 1].items.isEmpty ? size.width : rows[rows.count - 1].width + spacing + size.width
            if added > width, !rows[rows.count - 1].items.isEmpty {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width = row.items.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.items.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}
