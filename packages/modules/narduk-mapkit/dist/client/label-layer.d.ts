import type { VectorTileCoordinate } from './hit-test.js';
import type { PointLayerScreenCircle, PointLayerView } from './point-layer.js';
import type { MapKitFrameScheduler } from './timers.js';
/** Most labels placed in one frame unless the caller says otherwise. */
export declare const LABEL_LAYER_DEFAULT_MAX_LABELS = 200;
/**
 * How far past the visible edge, in CSS pixels, an anchor is still considered,
 * so a label whose anchor is just off screen can still show its near half.
 */
export declare const LABEL_LAYER_DEFAULT_MARGIN_PX = 128;
/** Distinct (font, text) widths the measure cache keeps; the oldest-used leaves first. */
export declare const LABEL_LAYER_DEFAULT_MEASURE_CACHE_LIMIT = 1024;
/**
 * Work for placing and painting a national view: 3,000 candidate anchors
 * against 5,000 obstacle dots. Counted in operations, not milliseconds, so it
 * cannot flake under load; measured in `tests/label-layer.test.ts`, which also
 * logs the wall time it saw for information.
 */
export declare const LABEL_LAYER_NATIONAL_FRAME_BUDGET: {
    readonly anchors: 3000;
    /** Anchors examined (ranked scan) in one frame. */
    readonly considered: 3000;
    /** Box-versus-item overlap tests in one frame. */
    readonly overlapTests: 60000;
    readonly obstacles: 5000;
    /** `strokeText` plus `fillText` calls in one frame. */
    readonly textCalls: number;
};
/** One name to place. `priority` higher wins; `minZoom` is the first zoom it may show. */
export interface LabelAnchor {
    /** Returned by {@link LabelLayer.labelAt}; absent means the hit says so, never 0. */
    id?: number | string;
    latitude: number;
    longitude: number;
    minZoom: number;
    priority: number;
    text: string;
}
/** How a label is painted. Every colour and the font come from the caller. */
export interface LabelStyle {
    /** Text colour. */
    fill: string;
    fontFamily: string;
    /** Font size in CSS pixels, before the device pixel ratio. */
    fontSize: number;
    fontWeight?: number | string;
    /** Colour of the stroke painted under the fill so text reads on any ground. */
    halo: string;
    /** Halo stroke width in CSS pixels. 0 paints no halo. */
    haloWidth: number;
    /** Line box height as a multiple of `fontSize`. Default 1.2. */
    lineHeight?: number;
    /** Clear space kept around the text box, CSS pixels, beyond the halo. Default 2. */
    padding?: number;
}
/** A single style, or one chosen per anchor (return a stable object per class of anchor). */
export type LabelStyleSource = LabelStyle | ((anchor: LabelAnchor) => LabelStyle);
/** A dot-shaped mark in screen space; `x`, `y` is the centre. Same shape the point layer returns. */
export type LabelCircleObstacle = PointLayerScreenCircle;
/** A rectangular mark in screen space; `x`, `y` is the top-left corner. */
export interface LabelRectObstacle {
    height: number;
    width: number;
    x: number;
    y: number;
}
export type LabelObstacle = LabelCircleObstacle | LabelRectObstacle;
/** The screen as it is now, plus the pixel ratio the canvas is backed at (default 1). */
export interface LabelView extends PointLayerView {
    pixelRatio?: number;
}
/** The 2D surface the label painter and its measurer need, narrowed to what they call. */
export interface LabelCanvasContext {
    fillStyle: string | object;
    font: string;
    lineJoin: string;
    lineWidth: number;
    strokeStyle: string | object;
    textAlign: string;
    textBaseline: string;
    clearRect: (x: number, y: number, width: number, height: number) => void;
    fillText: (text: string, x: number, y: number) => void;
    measureText: (text: string) => {
        width: number;
    };
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    strokeText: (text: string, x: number, y: number) => void;
}
export interface LabelCanvas {
    height: number;
    width: number;
    getContext: (contextId: '2d') => LabelCanvasContext | null;
}
export interface LabelLayerOptions<TCanvas extends LabelCanvas = LabelCanvas> {
    anchors: readonly LabelAnchor[];
    cancelAnimationFrame?: MapKitFrameScheduler['cancelAnimationFrame'];
    /** The canvas {@link LabelLayer.requestPaint} paints into. */
    canvas?: TCanvas;
    /**
     * Makes the small canvas text is measured on when `measureText` is not given.
     * Give this or `measureText`.
     */
    createCanvas?: (width: number, height: number) => LabelCanvas;
    /** Most labels per frame. Default {@link LABEL_LAYER_DEFAULT_MAX_LABELS}. */
    maxLabels?: number;
    /** Default {@link LABEL_LAYER_DEFAULT_MARGIN_PX}. */
    marginPx?: number;
    /** Distinct (font, text) widths cached. Default {@link LABEL_LAYER_DEFAULT_MEASURE_CACHE_LIMIT}. */
    measureCacheLimit?: number;
    /** Width in CSS pixels of `text` set in the CSS `font` shorthand. Default: canvas `measureText`. */
    measureText?: (text: string, font: string) => number;
    /**
     * Marks to avoid, in screen space for the view being placed. Called once per
     * placement and read synchronously. A point layer's `obstaclesInView` fits.
     */
    obstacles?: (view: LabelView) => Iterable<LabelObstacle>;
    /** Called after each {@link LabelLayer.requestPaint} frame has painted. */
    onPainted?: (placement: LabelPlacement) => void;
    requestAnimationFrame?: MapKitFrameScheduler['requestAnimationFrame'];
    style: LabelStyleSource;
}
/** One label kept for the frame. Positions are CSS pixels from the view's top-left. */
export interface PlacedLabel {
    /** Height of the text box. */
    height: number;
    /** Index of the anchor in the array the layer was given. */
    index: number;
    id: number | string | undefined;
    style: LabelStyle;
    text: string;
    /** Width of the text box, measured once and cached. */
    width: number;
    /** Centre of the text, which is the anchor's position. */
    x: number;
    y: number;
}
/** What one placement did, in counts. Nothing here is a time. */
export interface LabelPlacementStats {
    /** Stopped at `maxLabels` with anchors left unexamined. */
    capped: boolean;
    /** Anchors that passed the zoom and region rules and were tried. */
    considered: number;
    droppedByLabel: number;
    droppedByObstacle: number;
    /** Cache misses: `measureText` calls this frame. */
    measured: number;
    /** Anchors skipped because the view is below their first zoom. */
    belowMinZoom: number;
    /** Anchors skipped because they sit outside the region plus the margin. */
    outsideRegion: number;
    /** Obstacles put in the grid. */
    obstacles: number;
    /** Box-versus-item overlap tests. */
    overlapTests: number;
    /** Anchors skipped because their text could not be measured to a positive width. */
    unmeasurable: number;
}
export interface LabelPlacement {
    labels: PlacedLabel[];
    stats: LabelPlacementStats;
}
export interface LabelHit {
    /** Index of the anchor in the array the layer was given. */
    index: number;
    /** The anchor's id, or `undefined` when it has none. */
    id: number | string | undefined;
    text: string;
}
export interface LabelMeasureCacheStats {
    hits: number;
    limit: number;
    misses: number;
    size: number;
}
export interface LabelLayer<TCanvas extends LabelCanvas = LabelCanvas> {
    readonly anchorCount: number;
    readonly cacheStats: LabelMeasureCacheStats;
    /** Cancel a pending frame and stop painting. Idempotent. */
    destroy: () => void;
    /** Paint a pending {@link LabelLayer.requestPaint} now instead of next frame. */
    flushNow: () => void;
    /**
     * The label under a coordinate, from the last placed frame only. `null` when
     * nothing is within `toleranceInPixels` of a label box, when no frame has
     * been placed, or when `zoom` is not the zoom that frame was placed at: a
     * stale answer would name the wrong place. Synchronous; reads no tiles.
     */
    labelAt: (coordinate: VectorTileCoordinate, toleranceInPixels: number, zoom: number) => LabelHit | null;
    /** Place and paint now into `canvas` (default: the option's canvas). */
    paint: (view: LabelView, canvas?: TCanvas) => LabelPlacement;
    /** Choose labels for the view without painting; also becomes the frame `labelAt` answers from. */
    place: (view: LabelView) => LabelPlacement;
    /** Coalesce region changes: many calls in a frame paint once, with the latest view. */
    requestPaint: (view: LabelView) => void;
    /** Replace the anchors. Positions are projected again here, once. */
    setAnchors: (anchors: readonly LabelAnchor[]) => void;
    setStyle: (style: LabelStyleSource) => void;
}
export declare function createLabelLayer<TCanvas extends LabelCanvas = LabelCanvas>(options: LabelLayerOptions<TCanvas>): LabelLayer<TCanvas>;
//# sourceMappingURL=label-layer.d.ts.map