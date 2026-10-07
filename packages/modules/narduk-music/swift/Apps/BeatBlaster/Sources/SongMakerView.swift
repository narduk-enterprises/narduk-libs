import SwiftUI

/// The guided song maker: 1 vibe, 2 speed, 3 band, 4 sounds, 5 lights and a name, then "Play my song".
struct SongMakerView: View {
    let audio: BlasterAudio
    let home: () -> Void
    let done: (SongRecipe) -> Void
    /// The layout tests host a later step directly; the app always starts at 1.
    var startStep = 1
    @State private var step = 1
    @State private var recipe = SongRecipe(style: .genre(.house))
    @State private var pickedVibe = false
    @FocusState private var naming: Bool

    private let titles = ["Pick a vibe", "How fast?", "Pick your band", "Pick your sounds", "Pick your lights"]
    private let helps = [
        "Tap a card to hear a taste. Pick the one you like!",
        "Tap one to hear it.",
        "Tap to turn players on or off. Lit up = playing.",
        "Tap a sound to hear it. 🎲 mixes them all up!",
        "Pick the lights for your song, and give it a name.",
    ]

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            let short = geometry.size.height < 500
            VStack(spacing: short ? 6 : (compact ? 10 : 16)) {
                header(compact: compact, short: short)
                if !short {
                    VStack(spacing: 4) {
                        Text("Step \(step): \(titles[step - 1])")
                            .blasterFont(size: compact ? 32 : 52, weight: .black)
                            .foregroundStyle(stepGradient)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                            .probe("maker.title")
                        Text(helps[step - 1])
                            .blasterFont(size: compact ? 16 : 22, weight: .bold)
                            .foregroundStyle(.white.opacity(0.85))
                            .multilineTextAlignment(.center)
                    }
                }
                ScrollView {
                    Group {
                        switch step {
                        case 1: vibeStep(compact: compact)
                        case 2: speedStep(compact: compact)
                        case 3: bandStep(compact: compact)
                        case 4: soundsStep(compact: compact)
                        default: lightsStep(compact: compact)
                        }
                    }
                    .padding(.vertical, 12)
                    .padding(.horizontal, 4)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.immediately)
                navigation(compact: compact)
            }
            .padding(short ? 10 : (compact ? 14 : 28))
            .background(
                LinearGradient(
                    colors: [Neon.night, Color(red: 0.16, green: 0.04, blue: 0.3)], startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
            )
        }
        .onAppear {
            step = startStep
            pickedVibe = startStep > 1
            recipe = SongRecipe(style: BlasterStyle.all.randomElement() ?? .genre(.house))
            audio.stop()
            if let raw = UserDefaults.standard.string(forKey: "makerStep"), let n = Int(raw), (1...5).contains(n) {
                pickedVibe = true
                step = n
                if n == 5 { audio.play(recipe) }
            }
        }
    }

    private var stepGradient: LinearGradient {
        LinearGradient(colors: [Neon.yellow, Neon.pink], startPoint: .leading, endPoint: .trailing)
    }

    /// Home and the step dots; the title goes on its own line on a phone held upright (it used to be squeezed into a
    /// one-letter column between them), and the step's name takes its place in a short landscape window.
    @ViewBuilder private func header(compact: Bool, short: Bool) -> some View {
        if short {
            HStack(spacing: 10) {
                HomeButton(action: home).probe("maker.home")
                Text("Step \(step): \(titles[step - 1])")
                    .blasterFont(size: 22, weight: .black)
                    .foregroundStyle(stepGradient)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .probe("maker.title")
                Spacer(minLength: 0)
                StepDots(step: step, titles: titles, compact: true)
            }
        } else if compact {
            VStack(spacing: 6) {
                HStack {
                    HomeButton(action: home).probe("maker.home")
                    Spacer(minLength: 8)
                    StepDots(step: step, titles: titles, compact: true)
                }
                Text("🎵 Make a Song")
                    .blasterFont(size: 22, weight: .black)
                    .foregroundStyle(.white)
            }
        } else {
            HStack(spacing: 14) {
                HomeButton(action: home).probe("maker.home")
                Spacer()
                Text("🎵 Make a Song")
                    .blasterFont(size: 30, weight: .black)
                    .foregroundStyle(.white)
                Spacer()
                StepDots(step: step, titles: titles, compact: false)
            }
        }
    }

    // MARK: Steps

    private func vibeStep(compact: Bool) -> some View {
        MusicGrid(selectedID: pickedVibe ? recipe.styleID : nil, compact: compact) { style in
            let wasGuitars = recipe.style == .guitars
            recipe.styleID = style.id
            if style == .guitars { recipe.band = [.drums, .bass, .guitar] }
            if wasGuitars, style != .guitars { recipe.band = BandPart.everyone }
            pickedVibe = true
            audio.preview(recipe)
        }
    }

    private func speedStep(compact: Bool) -> some View {
        HStack(spacing: compact ? 12 : 24) {
            ForEach(Speed.allCases) { speed in
                let selected = recipe.speed == speed
                Button {
                    Haptics.tap()
                    recipe.speed = speed
                    audio.preview(recipe)
                } label: {
                    VStack(spacing: 8) {
                        Glyph(speed.emoji, size: compact ? 54 : 96)
                        Text(speed.word)
                            .blasterFont(size: compact ? 22 : 36, weight: .black)
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: compact ? 160 : 260)
                    .background(
                        Neon.yellow.opacity(selected ? 0.75 : 0.18),
                        in: RoundedRectangle(cornerRadius: 30, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 30, style: .continuous)
                            .stroke(.white.opacity(selected ? 1 : 0.4), lineWidth: selected ? 5 : 2)
                    )
                    .shadow(color: selected ? Neon.yellow : .clear, radius: 18)
                    .overlay(alignment: .topTrailing) {
                        if selected { Glyph("✅", size: 34).offset(x: 8, y: -12) }
                    }
                }
                .buttonStyle(Squish())
            }
        }
        .frame(maxWidth: 900)
    }

    private func bandStep(compact: Bool) -> some View {
        VStack(spacing: 22) {
            BandToggles(band: recipe.band, compact: compact) { part in
                if recipe.band.contains(part) { recipe.band.remove(part) } else { recipe.band.insert(part) }
            }
            Button {
                Haptics.tap()
                audio.preview(recipe)
            } label: {
                Pill(icon: "🔊", word: "Listen to my band", color: Neon.green.opacity(0.7), size: compact ? 20 : 26)
            }
            .buttonStyle(Squish())
        }
    }

    private func soundsStep(compact: Bool) -> some View {
        VStack(spacing: compact ? 12 : 18) {
            SoundRow(title: "Mood", options: Mood.allCases, selected: recipe.mood, compact: compact) { mood in
                recipe.mood = mood
                audio.preview(recipe)
            }
            SoundRow(title: "Bass", options: BassSound.allCases, selected: recipe.sounds.bass, compact: compact) {
                bass in
                recipe.sounds.bass = bass
                recipe.sounds.bassPatch = Int.random(in: 0..<48)
                audio.preview(recipe)
            }
            SoundRow(title: "Keys", options: KeysSound.allCases, selected: recipe.sounds.keys, compact: compact) {
                keys in
                recipe.sounds.keys = keys
                if !recipe.band.contains(.keys) { recipe.band.insert(.keys) }
                audio.preview(recipe)
            }
            SoundRow(title: "Drums", options: DrumKit.allCases, selected: recipe.sounds.drums, compact: compact) {
                kit in
                recipe.sounds.drums = kit
                audio.preview(recipe)
            }
            SoundRow(title: "Guitar", options: GuitarSound.allCases, selected: recipe.sounds.guitar, compact: compact) {
                guitar in
                recipe.sounds.guitar = guitar
                if !recipe.band.contains(.guitar) { recipe.band.insert(.guitar) }
                audio.preview(recipe)
            }
            SoundRow(title: "Pads", options: PadSound.allCases, selected: recipe.sounds.pads, compact: compact) {
                pads in
                recipe.sounds.pads = pads
                if !recipe.band.contains(.pads) { recipe.band.insert(.pads) }
                audio.preview(recipe)
            }
            Button {
                Haptics.success()
                recipe.sounds = SoundProfile.random()
                recipe.mood = Mood.allCases.randomElement()
                recipe.keyRoot = Int.random(in: 60...71)
                recipe.comping = [.stabs, .arpeggio, .strum, .folk].randomElement()!
                audio.preview(recipe)
            } label: {
                Pill(icon: "🎲", word: "Mix up my sounds", color: Neon.orange.opacity(0.8), size: compact ? 20 : 26)
            }
            .buttonStyle(Squish())
        }
        .frame(maxWidth: 900)
    }

    private func lightsStep(compact: Bool) -> some View {
        VStack(spacing: 18) {
            HStack(spacing: 10) {
                Text("✏️ Song name:")
                    .blasterFont(size: compact ? 18 : 24, weight: .black)
                    .foregroundStyle(.white)
                TextField("Name your song", text: $recipe.name)
                    .blasterFont(size: compact ? 20 : 26, weight: .bold)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 18)
                    .frame(height: 58)
                    .background(.white.opacity(0.1), in: Capsule())
                    .overlay(Capsule().stroke(Neon.yellow, lineWidth: 3))
                    .focused($naming)
                    .submitLabel(.done)
                Button {
                    Haptics.tap()
                    recipe.name = FunNames.random()
                } label: {
                    Pill(icon: "🎲", word: compact ? "New" : "New name", color: Neon.orange.opacity(0.75), size: 18)
                }
                .buttonStyle(Squish())
            }
            .frame(maxWidth: 900)
            LightsGrid(audio: audio, selectedID: recipe.lightsID, compact: compact) { id in
                recipe.lightsID = id
            }
        }
        .onAppear { if !audio.isRunning { audio.play(recipe) } }
    }

    // MARK: Navigation

    private func navigation(compact: Bool) -> some View {
        HStack(spacing: 14) {
            if step > 1 {
                Button {
                    Haptics.tap()
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { step -= 1 }
                } label: {
                    Pill(icon: "◀︎", word: "Back", color: .white.opacity(0.18), size: compact ? 20 : 26)
                }
                .buttonStyle(Squish())
            }
            Spacer()
            if step == 1, !pickedVibe {
                Text("👆 Pick a vibe first!")
                    .blasterFont(size: compact ? 18 : 24, weight: .black)
                    .foregroundStyle(Neon.yellow)
            } else if step < titles.count {
                Button {
                    Haptics.tap()
                    if step == titles.count - 1 { audio.play(recipe) }
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) { step += 1 }
                } label: {
                    Pill(icon: "▶︎", word: "Next", color: Neon.pink.opacity(0.85), size: compact ? 22 : 30)
                }
                .buttonStyle(Squish())
            } else {
                Button {
                    Haptics.success()
                    naming = false
                    if recipe.name.trimmingCharacters(in: .whitespaces).isEmpty { recipe.name = FunNames.random() }
                    done(recipe)
                } label: {
                    Pill(icon: "▶︎", word: "Play my song!", color: Neon.green.opacity(0.85), size: compact ? 24 : 34)
                }
                .buttonStyle(Squish())
            }
        }
    }
}

/// The step indicator: four numbered dots, the current one lit, done ones ticked.
struct StepDots: View {
    let step: Int
    let titles: [String]
    let compact: Bool

    var body: some View {
        HStack(spacing: compact ? 6 : 10) {
            ForEach(1...titles.count, id: \.self) { n in
                Text(n < step ? "✓" : "\(n)")
                    .blasterFont(size: compact ? 16 : 22, weight: .black)
                    .foregroundStyle(n == step ? .black : .white)
                    .frame(width: compact ? 32 : 44, height: compact ? 32 : 44)
                    .background(
                        n == step ? Neon.yellow : (n < step ? Neon.green.opacity(0.7) : .white.opacity(0.15)),
                        in: Circle()
                    )
                    .overlay(Circle().stroke(.white.opacity(0.6), lineWidth: 2))
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Step \(step) of \(titles.count)")
    }
}

/// The band: one big toggle per instrument group, lit when it plays.
struct BandToggles: View {
    let band: Set<BandPart>
    var compact = false
    let toggle: (BandPart) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: compact ? 100 : 150), spacing: 12)], spacing: 12) {
            ForEach(BandPart.allCases) { part in
                let on = band.contains(part)
                Button {
                    Haptics.tap()
                    toggle(part)
                } label: {
                    VStack(spacing: 4) {
                        Glyph(part.emoji, size: compact ? 34 : 50)
                            .grayscale(on ? 0 : 1)
                        Text(part.word)
                            .blasterFont(size: compact ? 18 : 24, weight: .black)
                        Text(on ? "ON" : "off")
                            .blasterFont(size: compact ? 13 : 16, weight: .heavy)
                            .padding(.horizontal, 10)
                            .background(on ? Neon.green : .white.opacity(0.2), in: Capsule())
                            .foregroundStyle(on ? .black : .white)
                    }
                    .foregroundStyle(.white.opacity(on ? 1 : 0.6))
                    .frame(maxWidth: .infinity)
                    .frame(height: compact ? 118 : 160)
                    .background(
                        Neon.green.opacity(on ? 0.35 : 0.06), in: RoundedRectangle(cornerRadius: 24, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .stroke(on ? Neon.green : .white.opacity(0.25), lineWidth: on ? 4 : 2)
                    )
                    .shadow(color: on ? Neon.green.opacity(0.7) : .clear, radius: 12)
                }
                .buttonStyle(Squish())
                .accessibilityLabel("\(part.word) \(on ? "on" : "off")")
            }
        }
        .frame(maxWidth: 900)
    }
}

/// One sound choice: a word on the left and a big chip per option; the picked one glows.
protocol SoundChoice: Identifiable, Hashable {
    var word: String { get }
    var emoji: String { get }
}

extension Mood: SoundChoice {}
extension BassSound: SoundChoice {}
extension KeysSound: SoundChoice {}
extension DrumKit: SoundChoice {}
extension GuitarSound: SoundChoice {}
extension PadSound: SoundChoice {}

struct SoundRow<Option: SoundChoice>: View {
    let title: String
    let options: [Option]
    let selected: Option?
    let compact: Bool
    let pick: (Option) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .blasterFont(size: compact ? 18 : 24, weight: .black)
                .foregroundStyle(.white)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: compact ? 6 : 12) {
                    ForEach(options) { option in
                        let on = option == selected
                        Button {
                            Haptics.tap()
                            pick(option)
                        } label: {
                            VStack(spacing: 2) {
                                Glyph(option.emoji, size: compact ? 24 : 36)
                                Text(option.word)
                                    .blasterFont(size: compact ? 13 : 20, weight: .black)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.6)
                            }
                            .foregroundStyle(.white)
                            .frame(width: compact ? 84 : 118, height: compact ? 68 : 96)
                            .background(
                                Neon.cyan.opacity(on ? 0.6 : 0.12),
                                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(on ? .white : .white.opacity(0.3), lineWidth: on ? 4 : 2)
                            )
                            .shadow(color: on ? Neon.cyan : .clear, radius: 12)
                        }
                        .buttonStyle(Squish())
                        .accessibilityLabel("\(title) \(option.word)\(on ? ", picked" : "")")
                    }
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 2)
            }
        }
    }
}
