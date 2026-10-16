import type { LatLng } from './helpers.js';
/** How long a glide takes by default: most of a 15 s poll, so the marker is still moving when the next fix arrives. */
export declare const MAPKIT_GLIDE_MS = 13000;
/** A jump longer than this is a new place, not a move. */
export declare const MAPKIT_MAX_GLIDE_METRES = 1500;
/** A move shorter than this is GPS noise, not a direction. */
export declare const MAPKIT_MIN_HEADING_MOVE_METRES = 15;
/** Compass bearing in degrees (0 = north, clockwise) of the move from `from` to `to`. */
export declare function bearingDegrees(from: LatLng, to: LatLng): number;
/** The signed turn from `from` to `to` in degrees, the short way round: always in [-180, 180). */
export declare function shortestAngleDelta(from: number, to: number): number;
/**
 * The heading to draw next. It is "unwrapped" (it can pass 360 or go below 0)
 * so a CSS transition from the last heading turns the short way, never the long
 * way round. With no current heading the target is used as is.
 */
export declare function unwrapHeading(current: number | undefined, target: number): number;
/** Fold an unwrapped heading back to [0, 360) for display or a `data-` attribute. */
export declare function normalizeHeading(heading: number): number;
/** The point `t` (0 to 1, clamped) of the way from `from` to `to`, linearly in latitude and longitude. */
export declare function interpolateLatLng(from: LatLng, to: LatLng, t: number): LatLng;
/** Why a move is drawn at once instead of glided. */
export type MapKitSnapReason = 'first' | 'hidden' | 'jump' | 'reduced-motion';
export interface MapKitSnapContext {
    /** The first fix this marker has had. */
    first?: boolean;
    /** The tab was hidden since the last fix: nothing should sweep on return. */
    hidden?: boolean;
    /** A jump longer than this is a new place. Default `MAPKIT_MAX_GLIDE_METRES`. */
    maxGlideMetres?: number;
    /** `prefers-reduced-motion: reduce`. */
    reducedMotion?: boolean;
}
/**
 * The reason a move must be drawn at once, or `null` when it may glide. The
 * checks run in the order of the `MapKitSnapReason` union's meaning: a first fix
 * has no earlier place to glide from at all, so it wins over everything.
 */
export declare function mapKitSnapReason(from: LatLng, to: LatLng, context?: MapKitSnapContext): MapKitSnapReason | null;
/** A polyline with its cumulative length, ready for `pointAlongPath`. */
export interface MapKitGlidePath {
    /** Cumulative metres from the first point; same length as `points`. */
    cumulative: number[];
    points: LatLng[];
}
/** Measure a polyline. */
export declare function buildGlidePath(points: readonly LatLng[]): MapKitGlidePath;
export interface MapKitPathAlongOptions {
    /** The along-line way may be at most this many times the straight way (plus the slack). Default 1.6. */
    detourFactor?: number;
    /** Added to the detour limit so two close fixes are not refused for a few metres. Default 60. */
    detourSlackMetres?: number;
    /** A fix further than this from a line is not on it. Default 50. */
    onLineMetres?: number;
}
/**
 * The stretch of a route line a vehicle drove between two fixes, so it glides
 * round the corners of its route and not straight across them.
 *
 * `null` (glide straight) when either fix is off every line, or when the way
 * along the line is a detour from the straight way: nothing is invented. With
 * several candidate lines the one both fixes sit closest to wins.
 */
export declare function pathAlongPolylines(lines: ReadonlyArray<readonly LatLng[]>, from: LatLng, to: LatLng, options?: MapKitPathAlongOptions): MapKitGlidePath | null;
/** The point `t` (0 to 1, clamped) of the way along the path by distance. */
export declare function pointAlongPath(path: MapKitGlidePath, t: number): LatLng;
/**
 * The heading of the last stretch of a path, in degrees, or `null` for a path
 * with no length. This is the direction the route itself runs where the vehicle
 * ends up -- steadier than the bearing between two noisy GPS fixes, and right
 * at a corner the fixes straddle.
 */
export declare function pathEndHeading(path: MapKitGlidePath): number | null;
//# sourceMappingURL=motion.d.ts.map