import NardukMusicCore
import UIKit
import XCTest

@testable import BeatBlaster

/// Every icon and vibe card the app names exists in the art kit's catalog.
final class ArtTests: XCTestCase {
    func testEveryMappedIconExists() {
        let names = Set(Art.icons.values)
            .union(["icon-beat-lab", "icon-wobble-wave", "icon-growl", "icon-deep", "icon-pluck", "icon-synth"])
            .union(["icon-piano", "icon-bell", "icon-kit-classic", "icon-kit-boom", "icon-kit-zappy", "icon-kit-dj"])
        for name in names {
            XCTAssertNotNil(
                UIImage(named: name, in: Bundle(for: Self.self), compatibleWith: nil) ?? UIImage(named: name), name)
        }
    }

    func testEveryStyleHasAVibeCard() {
        for style in BlasterStyle.all {
            let name = Art.vibe(for: style)
            XCTAssertNotNil(name, "\(style.funName)")
            if let name { XCTAssertNotNil(UIImage(named: name), name) }
        }
    }

    /// No emoji left on the kids' screens: every Beat Lab row, speed, sound pad and band part draws a kit icon.
    func testEveryRowSpeedPadAndPartHasAnIcon() {
        let emoji =
            LabRow.allCases.map(\.emoji) + Speed.allCases.map(\.emoji) + SoundPad.allCases.map(\.emoji)
            + BandPart.allCases.map(\.emoji)
        for symbol in emoji { XCTAssertNotNil(Art.icon(for: symbol), "\(symbol) has no kit icon") }
    }
}
