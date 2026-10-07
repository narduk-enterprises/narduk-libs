import SwiftUI

/// Beat Blaster's type: the heavy rounded faces of the design, scaled with Dynamic Type (#1651). The design's sizes
/// are the Large (default) sizes. Small labels grow the most and big display text the least, so every screen still
/// fits at the largest accessibility size.
struct BlasterFont: ViewModifier {
    let size: CGFloat
    let weight: Font.Weight
    let design: Font.Design
    @Environment(\.dynamicTypeSize) private var typeSize

    func body(content: Content) -> some View {
        content.font(.system(size: size * Self.scale(typeSize, size: size), weight: weight, design: design))
    }

    /// The factor for `size` at `type`: Apple's body-text ratios (17 pt at Large), capped by how big the text
    /// already is.
    static func scale(_ type: DynamicTypeSize, size: CGFloat) -> CGFloat {
        let body: CGFloat =
            switch type {
            case .xSmall: 14 / 17
            case .small: 15 / 17
            case .medium: 16 / 17
            case .large: 1
            case .xLarge: 19 / 17
            case .xxLarge: 21 / 17
            case .xxxLarge: 23 / 17
            case .accessibility1: 28 / 17
            case .accessibility2: 33 / 17
            case .accessibility3: 40 / 17
            case .accessibility4: 47 / 17
            case .accessibility5: 53 / 17
            @unknown default: 1
            }
        let cap: CGFloat = size >= 28 ? 1.25 : (size >= 18 ? 1.5 : 1.8)
        return min(body, cap)
    }
}

extension View {
    /// A design size that follows Dynamic Type (see `BlasterFont`).
    func blasterFont(size: CGFloat, weight: Font.Weight, design: Font.Design = .rounded) -> some View {
        modifier(BlasterFont(size: size, weight: weight, design: design))
    }
}
