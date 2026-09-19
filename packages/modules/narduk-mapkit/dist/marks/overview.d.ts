/**
 * buoys#142: what an embedded map should be looking at.
 *
 * narduk-mapkit frames a map by the bounding box of everything it was given.
 * That is right for a regional set and useless for this catalogue: measured on
 * the live index (1353 stations, `/api/stations`), latitude runs -47.0 to 71.3
 * and longitude runs -179.8 to 180.0, because NDBC's Indian-Ocean and western
 * Pacific DART buoys carry `region: "atlantic-coast"`. The bounding box of that
 * is the globe -- the homepage hero rendered the whole world on desktop, and on
 * a 390x844 phone the aspect fit cropped it to Europe and Africa with 71 of 570
 * pins in view. Production `a6fb2532` showed the same camera.
 *
 * So the app picks the camera and the embeds set it explicitly:
 *
 * 1. Frame the interquartile core (Tukey, k = 1.5) rather than the extremes, so
 *    a handful of mislabelled buoys cannot drag the view off the data. On the
 *    full index that alone moves the centre from 20.0N 0.1E to 36.7N 92.9W.
 * 2. A frame still wider than a third of the planet is not a map of anything,
 *    so show the North America overview instead. Measured core longitude spans:
 *    the full index 173.7 degrees and `atlantic-coast` 208.3 (both fall back),
 *    against `pacific-coast` 79.8, `gulf-of-mexico` 17.5 and `great-lakes` 16.6
 *    (all framed on their own data). Framing the full index on its own core was
 *    the first attempt here, and it put the same world map back on screen.
 *
 * Fixing the region labels upstream would retire rule 2; rule 1 stands on its
 * own as ordinary outlier discipline.
 */
export interface MapCameraPoint {
    lat: number;
    lng: number;
}
export interface MapCamera {
    center: MapCameraPoint;
    span: MapCameraPoint;
}
export interface MapCameraOptions {
    /** Smallest span in degrees, so a single point does not zoom to a street. */
    minSpan?: number;
    /** Fraction of the framed range added as breathing room. */
    padding?: number;
}
/**
 * The default overview. Centred on the geographic middle of the lower 48, wide
 * enough for both coasts and the Gulf; MapKit widens whichever axis the host's
 * aspect ratio needs, which is what carries the Caribbean and Alaska into view
 * on a landscape embed.
 */
export declare const NORTH_AMERICA_OVERVIEW: MapCamera;
/**
 * The camera an embed should show for `points`, or `null` when it has none and
 * the kit's own `fallbackCenter` should stand.
 */
export declare function mapOverviewCamera(points: readonly MapCameraPoint[], { minSpan, padding }?: MapCameraOptions): MapCamera | null;
//# sourceMappingURL=overview.d.ts.map