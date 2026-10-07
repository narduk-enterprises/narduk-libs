import AVFoundation
import SwiftUI

/// Plays one saved take at a time.
@MainActor @Observable final class RecordingPlayer {
    private(set) var playing: URL?
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var watcher: Task<Void, Never>?

    func toggle(_ recording: Recording) {
        if playing == recording.url { return stop() }
        stop()
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback)
            try AVAudioSession.sharedInstance().setActive(true)
            let next = try AVAudioPlayer(contentsOf: recording.url)
            next.play()
            player = next
            playing = recording.url
            watcher = Task { [weak self] in
                while !Task.isCancelled, self?.player?.isPlaying == true {
                    try? await Task.sleep(for: .milliseconds(300))
                }
                if !Task.isCancelled { self?.stop() }
            }
        } catch {
            stop()
        }
    }

    func stop() {
        watcher?.cancel()
        player?.stop()
        player = nil
        playing = nil
    }
}

/// My Songs (recordings): everything the player recorded, newest first, with play, rename, delete and Share.
struct RecordingsView: View {
    let audio: BlasterAudio
    let home: () -> Void
    @State private var recordings: [Recording] = []
    @State private var player = RecordingPlayer()
    @State private var renaming: Recording?
    @State private var newName = ""
    @State private var deleting: Recording?

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500
            VStack(spacing: compact ? 10 : 16) {
                HStack(spacing: 12) {
                    HomeButton(action: home).probe("mysongs.home")
                    Text("My Songs")
                        .blasterFont(size: compact ? 26 : 40, weight: .black)
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .probe("mysongs.title")
                    Spacer(minLength: 0)
                }
                if recordings.isEmpty {
                    Spacer()
                    Text("Nothing recorded yet.\nEvery song you play gets recorded!")
                        .blasterFont(size: compact ? 20 : 28, weight: .heavy)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.85))
                    Spacer()
                } else {
                    ScrollView {
                        // Two columns once there is room for two full rows side by side (an iPad, a Mac window).
                        LazyVGrid(
                            columns: Array(
                                repeating: GridItem(.flexible(), spacing: 12, alignment: .top),
                                count: geometry.size.width >= 900 ? 2 : 1),
                            spacing: 10
                        ) {
                            ForEach(recordings) { recording in
                                // The row id must not replace the controls' own (#1664).
                                row(recording, compact: compact)
                                    .accessibilityElement(children: .contain)
                                    .accessibilityIdentifier("mysongs.row")
                            }
                        }
                        .frame(maxWidth: 1200)
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(compact ? 14 : 28)
            .frame(width: geometry.size.width, height: geometry.size.height)
            .background(
                LinearGradient(
                    colors: [Neon.night, Color(red: 0.16, green: 0.04, blue: 0.3)], startPoint: .top, endPoint: .bottom
                ).ignoresSafeArea())
        }
        .onAppear {
            audio.stop()
            reload()
        }
        .onDisappear { player.stop() }
        .alert("Rename your song", isPresented: renamingBinding) {
            TextField("Song name", text: $newName).accessibilityIdentifier("mysongs.renameField")
            Button("Save") { commitRename() }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Delete this recording?", isPresented: deletingBinding, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let deleting {
                    if player.playing == deleting.url { player.stop() }
                    audio.store.delete(deleting)
                    reload()
                }
            }
            Button("Keep it", role: .cancel) {}
        }
    }

    private func row(_ recording: Recording, compact: Bool) -> some View {
        let isPlaying = player.playing == recording.url
        return HStack(spacing: 10) {
            Button {
                Haptics.tap()
                player.toggle(recording)
            } label: {
                Glyph(isPlaying ? "icon-stop" : "icon-play", size: 26)
                    .frame(width: 52, height: 52)
                    .background(Neon.green.opacity(0.55), in: Circle())
            }
            .buttonStyle(Squish())
            .accessibilityLabel(isPlaying ? "Stop" : "Play \(recording.title)")
            .accessibilityIdentifier("mysongs.play")
            VStack(alignment: .leading, spacing: 2) {
                Text(recording.title)
                    .blasterFont(size: compact ? 16 : 20, weight: .black)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                Text(recording.detail)
                    .blasterFont(size: compact ? 13 : 14, weight: .bold)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .foregroundStyle(.white.opacity(0.7))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            iconButton("✏️", label: "Rename") {
                newName = recording.title
                renaming = recording
            }
            ShareLink(item: recording.url) {
                Glyph("📤", size: 24)
                    .frame(width: 48, height: 48)
                    .background(Neon.cyan.opacity(0.5), in: Circle())
            }
            .accessibilityLabel("Share \(recording.title)")
            .accessibilityIdentifier("mysongs.share")
            iconButton("🗑", label: "Delete") { deleting = recording }
        }
        .padding(10)
        .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func iconButton(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Glyph(icon, size: 24)
                .frame(width: 48, height: 48)
                .background(.white.opacity(0.18), in: Circle())
        }
        .buttonStyle(Squish())
        .accessibilityLabel(label)
        .accessibilityIdentifier("mysongs.\(label.lowercased())")
    }

    private var renamingBinding: Binding<Bool> {
        Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })
    }

    private var deletingBinding: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
    }

    private func commitRename() {
        if let renaming { try? audio.store.rename(renaming, to: newName) }
        renaming = nil
        reload()
    }

    private func reload() { recordings = audio.store.list() }
}
