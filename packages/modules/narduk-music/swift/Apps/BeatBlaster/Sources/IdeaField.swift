import SwiftUI

/// "Tell me your song idea": a text field and a 🎲 "Give me an idea" button that fills a kid-safe premise. The caller
/// gets the words (a premise becomes the song's name) when the child taps Go or presses return.
struct IdeaField: View {
    @Binding var text: String
    let compact: Bool
    var isBusy = false
    let submit: (_ words: String, _ isPremise: Bool) -> Void
    @State private var premise: String?
    @FocusState private var typing: Bool

    var body: some View {
        VStack(spacing: 10) {
            TextField("Tell me your song idea…", text: $text)
                .blasterFont(size: compact ? 20 : 28, weight: .bold)
                .foregroundStyle(.white)
                .padding(.horizontal, 20)
                .frame(minHeight: compact ? 56 : 76)
                .background(.white.opacity(0.1), in: Capsule())
                .overlay(Capsule().stroke(Neon.cyan, lineWidth: 3))
                .focused($typing)
                .submitLabel(.go)
                .onSubmit(go)
                .accessibilityLabel("Your song idea")
            HStack(spacing: 10) {
                Button {
                    Haptics.tap()
                    let idea = Premises.random()
                    premise = idea
                    text = idea
                    typing = false
                } label: {
                    Pill(icon: "🎲", word: "Give me an idea", color: Neon.orange.opacity(0.8), size: compact ? 16 : 22)
                }
                .buttonStyle(Squish())
                Button(action: go) {
                    Pill(
                        icon: isBusy ? "💭" : "🪄", word: isBusy ? "Dreaming…" : "Go",
                        color: Neon.pink.opacity(0.85), size: compact ? 16 : 22)
                }
                .buttonStyle(Squish())
                .disabled(isBusy || text.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func go() {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else { return }
        typing = false
        submit(words, words == premise)
    }
}
