import SwiftUI

/// Where the app says whose work it uses. Sits on Home as a small "Credits" button (there is no grown-ups area or
/// settings screen to put it behind) and opens a sheet.
enum Credits {
    /// The attribution CC BY 4.0 asks for, verbatim as Logan wrote it.
    static let vocalSet = "Vocal samples from VocalSet by Wilkins, Seetharaman, Wahl and Pardo (CC BY 4.0), modified."
}

struct CreditsView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Credits")
                    .font(.system(size: 34, weight: .black, design: .rounded))
                Text(Credits.vocalSet)
                    .font(.system(size: 18, weight: .medium, design: .rounded))
                    .accessibilityIdentifier("credits.vocalSet")
                Spacer()
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityIdentifier("credits.done")
                }
            }
        }
    }
}
