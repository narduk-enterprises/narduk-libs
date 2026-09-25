/**
 * Longitude arithmetic shared by the geometry helpers and the Nuxt runtime's
 * framing. Internal: not re-exported from `./geometry`, so moving it here did
 * not widen the public surface.
 */
export declare function normalizeLongitudeDegrees(lng: number): number;
export declare function toPositiveLongitudeDegrees(lng: number): number;
/**
 * Span of a set of longitudes, measured the short way round: the arc left after
 * removing the largest gap between neighbours. Two points either side of the
 * antimeridian (179.5, -179.5) span 1 degree centred on 180, not 359 degrees
 * centred on 0.
 */
export declare function computeLongitudeSpan(longitudes: number[]): {
    centerLng: number;
    crossesAntimeridian: boolean;
    eastLng: number;
    lngDelta: number;
    westLng: number;
};
//# sourceMappingURL=longitude.d.ts.map