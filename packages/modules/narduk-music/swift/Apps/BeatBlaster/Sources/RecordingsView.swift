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

/// One take for the share sheet: sent as a copy named for the song, so a friend gets "Rocket Party.m4a".
struct SharedTake: Transferable {
    let recording: Recording

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .mpeg4Audio) { take in
            SentTransferredFile(try RecordingStore.shareCopy(of: take.recording))
        }
    }
}

/// My Songs (recordings): everything the player recorded, with play, rename, delete and Share, a sort and a search, and
/// Select to share or delete many at once.
struct RecordingsView: View {
    let audio: BlasterAudio
    let home: () -> Void
    @State private var recordings: [Recording] = []
    @State private var player = RecordingPlayer()
    @State private var renaming: Recording?
    @State private var newName = ""
    @State private var deleting: [Recording] = []
    @AppStorage("mySongs.sort") private var sort = RecordingSort.newest
    @State private var search = ""
    @State private var selecting = false
    @State private var selected: Set<URL> = []
    /// Bumped by every reload so a slow, older listing never lands over a newer one.
    @State private var loads = 0
    @State private var loaded = false

    private var shown: [Recording] { sort.apply(recordings, search: search) }
    private var picked: [Recording] { shown.filter { selected.contains($0.url) } }

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 500 || geometry.size.height < 500
            VStack(spacing: compact ? 10 : 16) {
                header(compact: compact)
                if !loaded {
                    Spacer()
                } else if recordings.isEmpty {
                    Spacer()
                    note("Nothing recorded yet.\nEvery song you play gets recorded!", compact: compact)
                    Spacer()
                } else {
                    if recordings.count > 5 { searchField }
                    if shown.isEmpty {
                        Spacer()
                        note("No song called “\(search)”", compact: compact)
                        Spacer()
                    } else {
                        list(width: geometry.size.width, compact: compact)
                    }
                    if selecting { selectionBar(compact: compact) }
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
            RecordingStore.clearShareCopies()
            reload(sweep: true)
        }
        .onDisappear { player.stop() }
        .alert("Rename your song", isPresented: renamingBinding) {
            TextField("Song name", text: $newName).accessibilityIdentifier("mysongs.renameField")
            Button("Save") { commitRename() }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog(deleteTitle, isPresented: deletingBinding, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { commitDelete() }
            Button("Keep", role: .cancel) {}
        }
    }

    private func header(compact: Bool) -> some View {
        HStack(spacing: 12) {
            HomeButton(action: home).probe("mysongs.home")
            VStack(alignment: .leading, spacing: 0) {
                Text("My Songs")
                    .blasterFont(size: compact ? 26 : 40, weight: .black)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .probe("mysongs.title")
                if !recordings.isEmpty {
                    Text(libraryText(recordings))
                        .blasterFont(size: compact ? 13 : 15, weight: .bold)
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                        .probe("mysongs.summary")
                }
            }
            Spacer(minLength: 0)
            if !recordings.isEmpty {
                sortMenu(compact: compact)
                headerButton(selecting ? "Done" : "Select", id: "mysongs.select") {
                    selecting.toggle()
                    selected = []
                }
            }
        }
    }

    private func sortMenu(compact: Bool) -> some View {
        Menu {
            Picker("Order", selection: $sort) {
                ForEach(RecordingSort.allCases) { Text($0.rawValue).tag($0) }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "arrow.up.arrow.down")
                if !compact { Text(sort.rawValue) }
            }
            .modifier(HeaderPill())
        }
        .accessibilityLabel("Order: \(sort.rawValue)")
        .accessibilityIdentifier("mysongs.sort")
    }

    private func headerButton(_ word: String, id: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Text(word).modifier(HeaderPill())
        }
        .buttonStyle(Squish())
        .accessibilityIdentifier(id)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.white.opacity(0.7))
            TextField("", text: $search, prompt: Text("Find a song").foregroundStyle(.white.opacity(0.5)))
                .foregroundStyle(.white)
                .autocorrectionDisabled()
                .accessibilityIdentifier("mysongs.search")
            if !search.isEmpty {
                Button {
                    search = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.white.opacity(0.7))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Clear search")
            }
        }
        .font(.system(size: 17, weight: .semibold, design: .rounded))
        .padding(.leading, 16)
        .frame(maxWidth: 600, minHeight: 44)
        .background(.white.opacity(0.12), in: Capsule())
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func list(width: CGFloat, compact: Bool) -> some View {
        ScrollView {
            // Two columns once there is room for two full rows side by side (an iPad, a Mac window).
            LazyVGrid(
                columns: Array(
                    repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: width >= 900 ? 2 : 1),
                spacing: 10
            ) {
                ForEach(shown) { recording in
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

    private func note(_ text: String, compact: Bool) -> some View {
        Text(text)
            .blasterFont(size: compact ? 20 : 28, weight: .heavy)
            .multilineTextAlignment(.center)
            .foregroundStyle(.white.opacity(0.85))
    }

    @ViewBuilder private func row(_ recording: Recording, compact: Bool) -> some View {
        if selecting {
            let on = selected.contains(recording.url)
            Button {
                Haptics.tap()
                if on { selected.remove(recording.url) } else { selected.insert(recording.url) }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: on ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(on ? Neon.green : .white.opacity(0.6))
                        .frame(width: 52, height: 52)
                    titles(recording, compact: compact)
                }
                .padding(10)
                .background(.white.opacity(on ? 0.2 : 0.1), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
            .buttonStyle(Squish())
            .accessibilityLabel(recording.title)
            .accessibilityAddTraits(on ? .isSelected : [])
            .accessibilityIdentifier("mysongs.pick")
        } else {
            playRow(recording, compact: compact)
        }
    }

    private func playRow(_ recording: Recording, compact: Bool) -> some View {
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
            titles(recording, compact: compact)
            iconButton("✏️", label: "Rename") {
                newName = recording.title
                renaming = recording
            }
            ShareLink(item: SharedTake(recording: recording), preview: SharePreview(recording.title)) {
                Glyph("📤", size: 24)
                    .frame(width: 48, height: 48)
                    .background(Neon.cyan.opacity(0.5), in: Circle())
            }
            .accessibilityLabel("Share \(recording.title)")
            .accessibilityIdentifier("mysongs.share")
            iconButton("🗑", label: "Delete") { deleting = [recording] }
        }
        .padding(10)
        .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func titles(_ recording: Recording, compact: Bool) -> some View {
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
        .multilineTextAlignment(.leading)
    }

    /// Select's actions: all or none, then share or delete the picked songs together.
    private func selectionBar(compact: Bool) -> some View {
        let count = picked.count
        let everything = count == shown.count
        return HStack(spacing: 10) {
            headerButton(everything ? "None" : "All", id: "mysongs.selectAll") {
                selected = everything ? [] : Set(shown.map(\.url))
            }
            Spacer(minLength: 0)
            ShareLink(items: picked.map(SharedTake.init), preview: { SharePreview($0.recording.title) }) {
                Label("Share \(count)", systemImage: "square.and.arrow.up").modifier(
                    HeaderPill(color: Neon.cyan.opacity(0.5)))
            }
            .disabled(count == 0)
            .accessibilityIdentifier("mysongs.shareSelected")
            headerButton("Delete \(count)", id: "mysongs.deleteSelected") { deleting = picked }
                .disabled(count == 0)
        }
        .padding(.top, 4)
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
        Binding(get: { !deleting.isEmpty }, set: { if !$0 { deleting = [] } })
    }

    private var deleteTitle: String {
        deleting.count == 1 ? "Delete “\(deleting[0].title)”?" : "Delete \(deleting.count) songs?"
    }

    private func commitRename() {
        if let renaming { try? audio.store.rename(renaming, to: newName) }
        renaming = nil
        reload()
    }

    private func commitDelete() {
        for recording in deleting {
            if player.playing == recording.url { player.stop() }
            audio.store.delete(recording)
            selected.remove(recording.url)
        }
        deleting = []
        reload()
    }

    private func reload(sweep: Bool = false) {
        loads += 1
        let load = loads
        Task {
            let listed = await audio.store.load(sweep: sweep)
            guard load == loads else { return }
            (recordings, loaded) = (listed, true)
            if listed.isEmpty { selecting = false }
        }
    }
}

/// The header's small capsule buttons: Select, the order menu, All, Share and Delete in Select.
private struct HeaderPill: ViewModifier {
    var color: Color = .white.opacity(0.18)

    func body(content: Content) -> some View {
        content
            .font(.system(size: 17, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 16)
            .frame(minWidth: 52, minHeight: 48)
            .background(color, in: Capsule())
    }
}
