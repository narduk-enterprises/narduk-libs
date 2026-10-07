import SwiftUI

/// Card grids that fit their space instead of scrolling: every card keeps its designed size and the whole grid
/// shrinks evenly, with the column count picked to give the biggest cards. Below `minScale` the cards would be too
/// small to tap, so the grid scrolls at that scale instead.
struct FitGrid<Item: Identifiable, Cell: View>: View {
    let items: [Item]
    let cell: CGSize
    var spacing: CGFloat = 14
    var minScale: CGFloat = 0.4
    @ViewBuilder let content: (Item) -> Cell

    struct Fit: Equatable {
        let columns: Int
        let scale: CGFloat
    }

    /// The column count whose cards come out biggest in `space`, never above their designed size.
    nonisolated static func fit(count: Int, cell: CGSize, spacing: CGFloat, in space: CGSize) -> Fit {
        guard count > 0, cell.width > 0, cell.height > 0 else { return Fit(columns: 1, scale: 1) }
        var best = Fit(columns: 1, scale: 0)
        for columns in 1...count {
            let rows = (count + columns - 1) / columns
            let byWidth = (space.width - spacing * CGFloat(columns - 1)) / (cell.width * CGFloat(columns))
            let byHeight = (space.height - spacing * CGFloat(rows - 1)) / (cell.height * CGFloat(rows))
            let scale = min(1, byWidth, byHeight)
            if scale > best.scale + 0.001 { best = Fit(columns: columns, scale: scale) }
        }
        return best
    }

    var body: some View {
        GeometryReader { geometry in
            let fit = Self.fit(count: items.count, cell: cell, spacing: spacing, in: geometry.size)
            if fit.scale >= minScale {
                grid(fit).frame(width: geometry.size.width, height: geometry.size.height)
            } else {
                let columns = max(1, Int((geometry.size.width + spacing) / (cell.width * minScale + spacing)))
                ScrollView { grid(Fit(columns: columns, scale: minScale)).frame(maxWidth: .infinity) }
            }
        }
    }

    private func grid(_ fit: Fit) -> some View {
        let size = CGSize(width: cell.width * fit.scale, height: cell.height * fit.scale)
        return LazyVGrid(
            columns: Array(repeating: GridItem(.fixed(size.width), spacing: spacing), count: fit.columns),
            spacing: spacing
        ) {
            ForEach(items) { item in
                content(item)
                    .frame(width: cell.width, height: cell.height)
                    .scaleEffect(fit.scale)
                    .frame(width: size.width, height: size.height)
            }
        }
    }
}

/// Shows its content at its natural size, shrunk evenly when the space is smaller, so a step never scrolls.
struct ScaleToFit<Content: View>: View {
    @ViewBuilder let content: Content
    @State private var natural: CGFloat = 0

    var body: some View {
        GeometryReader { geometry in
            // Laid out at the full width and its own height, then shrunk; the width never depends on the scale, so
            // the measurement cannot feed back into itself.
            let scale = natural > 0 ? min(1, geometry.size.height / natural) : 1
            content
                .frame(width: geometry.size.width)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self, of: \.size.height) { natural = $0 }
                .scaleEffect(scale)
                .frame(width: geometry.size.width, height: geometry.size.height)
        }
    }
}
