import Foundation

/// A closed list of things an app counts: its features, or its panels. An app supplies two of these as enums. Raw values
/// are stable: they are written to disk and compared across versions.
public protocol ActivityTaxonomy: RawRepresentable, CaseIterable, Sendable where RawValue == String {
    var title: String { get }
}

/// Something the person did in the app, recorded only on this Mac and only while they have recording on.
/// Optional fields keep each line small; a reader ignores fields it does not know.
///
/// The JSON line is a stable format: `subject` is written as `symbol` and `Kind.subject` as `stock`, the names the first
/// app's logs already use.
public struct ActivityEvent: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        /// The app became active (`start`) or stopped being active (`end`).
        case session
        /// A deliberate action from the app's feature taxonomy.
        case feature
        /// The pointer rested in one panel for `duration` seconds.
        case dwell
        /// A click in a panel at window position `x`, `y` (0...1 from the top left).
        case click
        /// The thing the app is about came into view.
        case subject = "stock"
        /// Where each panel sat in a window, as [x, y, width, height] fractions, when it changed.
        case layout
        /// Pointer samples as [milliseconds after `t`, x × 1000, y × 1000] triples.
        case path
        /// Pointer samples per cell of a 32 × 20 grid over the window, keyed "column,row".
        case heat
        /// Values hovered in a panel, keyed by value, with sample counts.
        case levels
        /// Seconds each panel was on screen in the front window, keyed by region: what was in view even when the
        /// pointer was elsewhere.
        case visible
    }

    public static let version = 1
    public var v = Self.version
    public var t: Date
    public var kind: Kind
    /// The window's number, so one window's panels and pointer are never mixed with another's.
    public var window: Int?
    public var name: String?
    /// What a panel was showing, in the app's own terms.
    public var subject: String?
    public var detail: String?
    public var duration: Double?
    public var x: Double?
    public var y: Double?
    public var points: [Int]?
    public var regions: [String: [Double]]?
    public var cells: [String: Int]?

    enum CodingKeys: String, CodingKey {
        case v, t, kind, window, name, detail, duration, x, y, points, regions, cells
        case subject = "symbol"
    }

    public init(
        t: Date, kind: Kind, window: Int? = nil, name: String? = nil, subject: String? = nil, detail: String? = nil,
        duration: Double? = nil, x: Double? = nil, y: Double? = nil, points: [Int]? = nil,
        regions: [String: [Double]]? = nil, cells: [String: Int]? = nil
    ) {
        self.t = t
        self.kind = kind
        self.window = window
        self.name = name
        self.subject = subject
        self.detail = detail
        self.duration = duration
        self.x = x
        self.y = y
        self.points = points
        self.regions = regions
        self.cells = cells
    }
}
