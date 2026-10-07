import NardukSoundVisuals
import SwiftUI
import Testing

/// Logan: "i see new color controls but the visualizers dont seem to respect them in the sound gallery". The library
/// tests check each kind alone; these drive the gallery's own model and check what a card actually receives.
@MainActor @Suite struct PaletteLookTests {
    @Test func aNewLookReachesTheSharedStateAndEveryTilesOwnState() {
        let model = GalleryModel()
        let tileState = SoundVisualState()
        model.sync(tileState)
        #expect(tileState.look.isNeutral)
        let before = tileState.palette

        model.choose(.ocean)
        model.sync(tileState)
        #expect(model.visualState.look == model.look)
        #expect(tileState.look == model.look)
        #expect(tileState.palette != before, "a tile's own state ignored the look")
        #expect(model.visualState.palette == tileState.palette)

        model.look.hueShift = 90
        model.sync(tileState)
        #expect(tileState.look.hueShift == 90)

        model.rollRandom(seed: 5)
        model.sync(tileState)
        #expect(tileState.palette == model.visualState.palette)
        model.resetLook()
        model.sync(tileState)
        #expect(tileState.look.isNeutral)
    }

    @Test func theGalleryCanvasCardsDrawInTheChosenPalette() {
        let model = GalleryModel()
        #expect(model.cardPalette == GalleryPalette.classic)
        model.choose(.sunset)
        #expect(model.cardPalette != GalleryPalette.classic)
        #expect(model.cardPalette == model.visualState.palette)
        let first = model.cardPalette
        model.rollRandom(seed: 11)
        #expect(model.cardPalette != first)
    }
}
