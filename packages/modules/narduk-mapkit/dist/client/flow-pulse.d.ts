import type { PointLayerView } from './point-layer.js';
import type { VectorTilePathPiece, VectorTilePathStretch } from './vector-tile-paths.js';
/** How the streaks and their static chevrons are drawn. Lengths are CSS pixels. */
export interface FlowPulseStyle {
    /** Brightness of the tributary streaks against the main ones, 0 to 1. Default 0.85. */
    branchOpacity?: number;
    /** Stroke width of a tributary streak. Default `width * 0.6`, at least 1.4. */
    branchWidth?: number;
    /** Half the width of a chevron, from its tip to a wing's end. Default 4. */
    chevron?: number;
    /** Distance between two chevrons along the path. Default 64. */
    chevronSpacing?: number;
    /** Stroke width of a chevron. Default 2.2. */
    chevronWidth?: number;
    /** The streak head's colour; the tail is the same colour, fainter. */
    color: string;
    /** Length of one streak, head to the end of its tail. Default 30. */
    dash?: number;
    /** Colour of the halo under each streak. Default: no halo. */
    glowColor?: string;
    /** Brightness of the halo, 0 to 1. Default 0.45. */
    glowOpacity?: number;
    /** Halo width as a multiple of `width`. Default 1.8. */
    glowScale?: number;
    /** Default 1. */
    opacity?: number;
    /** Distance from the start of one streak to the start of the next. Default 56. */
    period?: number;
    /** How fast the streaks travel, in pixels a second. Default 90. */
    speed?: number;
    /** Steps in a streak's tail, from the bright head back to its faint end; 1 is a plain dash. Default 4. */
    tail?: number;
    /** Stroke width of a streak head. */
    width: number;
}
export declare const FLOW_PULSE_DEFAULTS: {
    readonly branchOpacity: 0.85;
    readonly chevron: 4;
    readonly chevronSpacing: 64;
    readonly chevronWidth: 2.2;
    readonly dash: 30;
    readonly glowOpacity: 0.45;
    readonly glowScale: 1.8;
    readonly opacity: 1;
    readonly period: 56;
    readonly speed: 90;
    readonly tail: 4;
};
/** Tributaries of one brightness: stretches listed upstream first within each line. */
export interface FlowPulseBranch {
    /** How bright this group is, 0 to 1, before the style's `branchOpacity`. */
    opacity: number;
    /** Stretches of this group. Lines (a tributary and what feeds it) are listed upstream first. */
    stretches: readonly VectorTilePathStretch[];
}
/** The slice of a vector tile source the pulse reads. */
export interface FlowPulsePathSource {
    pathPieces: (options: {
        marginPx?: number;
        stretches: readonly VectorTilePathStretch[];
        view: PointLayerView;
    }) => VectorTilePathPiece[];
}
export interface FlowPulseContext {
    lineCap: string;
    lineDashOffset: number;
    lineJoin: string;
    lineWidth: number;
    strokeStyle: string | object;
    globalAlpha: number;
    beginPath: () => void;
    clearRect: (x: number, y: number, width: number, height: number) => void;
    lineTo: (x: number, y: number) => void;
    moveTo: (x: number, y: number) => void;
    setLineDash: (segments: number[]) => void;
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    stroke: (path?: FlowPulsePath) => void;
}
/** What a built line is: a `Path2D`, or anything a context can stroke. */
export type FlowPulsePath = object;
export interface FlowPulseCanvas {
    height: number;
    style?: {
        height: string;
        width: string;
    };
    width: number;
    getContext: (contextId: '2d') => FlowPulseContext | null;
}
export interface FlowPulseLayerOptions {
    /** The canvas laid over the map. The layer sizes it; the caller positions it. */
    canvas: FlowPulseCanvas;
    cancelAnimationFrame?: (handle: number) => void;
    /**
     * Builds the object a line is kept in between frames. Default: `new Path2D()`
     * where the platform has it; without one, each frame draws the line afresh.
     */
    createPath?: () => (FlowPulsePath & FlowPulsePathBuilder) | null;
    /** Frame clock in milliseconds. Default `performance.now()`. */
    now?: () => number;
    /** Device pixels per CSS pixel, read at each rebuild. Default `devicePixelRatio`, at most 2. */
    pixelRatio?: () => number;
    /**
     * Whether to hold still. Default: the `prefers-reduced-motion: reduce` media
     * query, followed as it changes.
     */
    reducedMotion?: boolean;
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    source: FlowPulsePathSource;
    style: FlowPulseStyle;
}
/** The part of `Path2D` the layer uses. */
export interface FlowPulsePathBuilder {
    lineTo: (x: number, y: number) => void;
    moveTo: (x: number, y: number) => void;
}
export type FlowPulseMode = 'chevrons' | 'idle' | 'pulse';
export interface FlowPulseStats {
    /** Lines of tributary streaks. */
    branchChains: number;
    /** Lines the pieces of the main path were joined into. */
    chains: number;
    /** Frames the loop has drawn since the layer was made. */
    frames: number;
    mode: FlowPulseMode;
    /** Points across every line. */
    points: number;
}
export interface FlowPulseLayer {
    /** Stop, clear and release. Idempotent. */
    destroy: () => void;
    /**
     * The path to run along, upstream first, or `null` for none, and optionally
     * fainter streaks on tributaries, which run the way their lines are drawn.
     * One call reads the geometry once; `null` and no branches clears it all.
     */
    setPath: (stretches: readonly VectorTilePathStretch[] | null, branches?: readonly FlowPulseBranch[] | null) => void;
    setStyle: (style: FlowPulseStyle) => void;
    readonly stats: FlowPulseStats;
    /** The map is about to move: stop and clear. `update()` resumes. */
    suspend: () => void;
    /** The map has settled on this view: read the geometry and draw. */
    update: (view: PointLayerView) => void;
}
interface Chain {
    /** Cumulative length at each point, for chevron placement. */
    lengths: Float32Array;
    /** Where the pattern starts along this line, in pixels, from the path's start. */
    phase: number;
    /** The line kept for stroking, when the platform can. */
    path?: FlowPulsePath;
    points: Float32Array;
}
/**
 * Join the pieces of a path, in path order, into lines: a piece that starts
 * where the last one ended continues it. A gap (a tile not decoded, a stretch
 * off the screen) starts a new line whose pattern phase comes from the ground
 * distance, so the dashes on the far side of a gap still line up with the
 * ones before it, to within the difference between ground and drawn length.
 */
export declare function joinPathPieces(pieces: readonly VectorTilePathPiece[], pixelsPerMetre: number): Chain[];
export declare function createFlowPulseLayer(options: FlowPulseLayerOptions): FlowPulseLayer;
export {};
//# sourceMappingURL=flow-pulse.d.ts.map