import Foundation

/// An intense visualizer (narduk-libs#1615): an id, a title and the fragment function that draws it. The built-ins
/// are the `static let`s below and share the library `IntenseRenderer` compiles at start-up; a plugin
/// (`IntenseKind.plugin`, narduk-libs#1665) carries its own MSL source, which the renderer compiles into a library
/// of its own after the shared `IntenseShaderCommon` and `IntenseEffects`, so a broken plugin cannot take another
/// visualizer down. Equality includes the source, so saving a plugin file makes it a new kind and a running view
/// rebuilds its pipeline.
public struct IntenseKind: Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    /// The fragment function drawn to the screen (for the fluid pair, the glitch pass).
    let fragment: String
    /// A first pass that writes the feedback texture the main fragment reads (fluid + glitch only).
    let feedbackFragment: String?
    /// The plugin's MSL, or nil for a built-in.
    let pluginSource: String?

    init(
        id: String, title: String, fragment: String, feedbackFragment: String? = nil, pluginSource: String? = nil
    ) {
        self.id = id
        self.title = title
        self.fragment = fragment
        self.feedbackFragment = feedbackFragment
        self.pluginSource = pluginSource
    }

    /// A kind drawn by `fragment` in `source`, a drop-in plugin. `id` names the file, so a rename is a new tile.
    public static func plugin(id: String, title: String, fragment: String, source: String) -> IntenseKind {
        IntenseKind(id: "plugin:" + id, title: title, fragment: fragment, pluginSource: source)
    }

    /// The id, kept so `kind.rawValue` call sites written for the old enum still compile.
    public var rawValue: String { id }

    public var isPlugin: Bool { pluginSource != nil }
    var usesFeedback: Bool { feedbackFragment != nil }

    public static let hyperspaceLasers = IntenseKind(
        id: "hyperspaceLasers", title: "Hyperspace + lasers", fragment: "hyperspaceFragment")
    /// Iridescent fluid advected frame to frame, then glitched (RGB split, tearing, block shifts).
    public static let fluidGlitch = IntenseKind(
        id: "fluidGlitch", title: "Fluid + glitch", fragment: "glitchFragment", feedbackFragment: "fluidFragment")
    /// A Mandelbrot dive: bass pushes the zoom, section changes turn the picture and shift the colour.
    public static let fractalDive = IntenseKind(
        id: "fractalDive", title: "Fractal dive", fragment: "fractalDiveFragment")
    /// A neon grid terrain under a striped sun: the spectrum raises the hills, the drop lifts off.
    public static let synthwaveFlyover = IntenseKind(
        id: "synthwaveFlyover", title: "Synthwave flyover", fragment: "synthwaveFragment")
    /// Iridescent liquid filaments and droplets splashing out of a core: bass sets the reach, highs the spray.
    public static let liquidSplash = IntenseKind(
        id: "liquidSplash", title: "Liquid splash", fragment: "liquidSplashFragment")
    /// A close-up star: granulated photosphere, sunspots, spicules, corona streamers, prominences and solar wind.
    public static let sun = IntenseKind(id: "sun", title: "Sun", fragment: "sunFragment")

    /// The built-ins, in gallery order. Plugins are loaded at run time and are not listed here.
    public static let allCases: [IntenseKind] = [
        .hyperspaceLasers, .fluidGlitch, .fractalDive, .synthwaveFlyover, .liquidSplash, .sun,
    ]
}
