import SwiftUI
import XCTest

@testable import BeatBlaster

/// The card grids pick the column count that gives the biggest cards that all fit, so pickers never scroll.
final class FitGridTests: XCTestCase {
    private let card = CGSize(width: 168, height: 196)

    private func fit(_ count: Int, _ width: CGFloat, _ height: CGFloat) -> FitGrid<BlasterStyle, EmptyView>.Fit {
        FitGrid<BlasterStyle, EmptyView>.fit(
            count: count, cell: card, spacing: 14, in: CGSize(width: width, height: height))
    }

    func testRoomyWindowKeepsDesignedSize() {
        XCTAssertEqual(fit(14, 2000, 1000).scale, 1, "cards never grow past their designed size")
    }

    func testEveryCardFitsTheSpace() {
        for (width, height) in [(940, 420), (700, 250), (360, 600), (1200, 520)] as [(CGFloat, CGFloat)] {
            let result = fit(14, width, height)
            let rows = CGFloat((14 + result.columns - 1) / result.columns)
            let cols = CGFloat(result.columns)
            XCTAssertLessThanOrEqual(cols * card.width * result.scale + (cols - 1) * 14, width + 0.5)
            XCTAssertLessThanOrEqual(rows * card.height * result.scale + (rows - 1) * 14, height + 0.5)
            XCTAssertLessThanOrEqual(result.scale, 1)
        }
    }

    func testWideShortSpacePrefersMoreColumns() {
        XCTAssertGreaterThanOrEqual(fit(14, 1400, 300).columns, 7)
        XCTAssertLessThanOrEqual(fit(14, 360, 1400).columns, 3)
    }
}
