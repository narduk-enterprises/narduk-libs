import type { PointLayerView } from './point-layer.js';
import type { VectorTilePathPiece, VectorTilePathStretch } from './vector-tile-paths.js';
/** How a pulse and its static chevrons are drawn. Lengths are CSS pixels. */
export interface FlowPulseStyle {
    /** Half the width of a chevron, from its tip to a wing's end. Default 4. */
    chevron?: number;
    /** Distance between two chevrons along the path. Default 64. */
    chevronSpacing?: number;
    color: string;
    /** Length of one lit dash. Default 22. */
    dash?: number;
    /** Default 1. */
    opacity?: number;
    /** Distance from the start of one dash to the start of the next. Default 200. */
    period?: number;
    /** How fast the dashes travel, in pixels a second. Default 125. */
    speed?: number;
    /** Stroke width of a dash. */
    width: number;
}
export declare const FLOW_PULSE_DEFAULTS: {
    readonly chevron: 4;
    readonly chevronSpacing: 64;
    readonly dash: 22;
    readonly opacity: 1;
    readonly period: 200;
    readonly speed: 125;
};
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
    stroke: (path?: unknown) => void;
}
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
export type FlowPulseMode = 'chevrons' | 'idle' | 'pulse';
export interface FlowPulseStats {
    /** Lines the pieces were joined into. */
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
    /** The path to run along, upstream first, or `null` for none. */
    setPath: (stretches: readonly VectorTilePathStretch[] | null) => void;
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