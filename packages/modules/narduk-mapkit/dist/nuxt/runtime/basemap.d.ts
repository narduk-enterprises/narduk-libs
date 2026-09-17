/**
 * The basemap seam: which tiles a live map shows, and in which colour scheme.
 *
 * Framework-free for the same reason as every other controller beside it -- two
 * consumers drive MapKit from plain TypeScript -- and separate from the
 * component so both halves of the 2.1.0 defect can be tested without Vue:
 *
 * - **K-3.** `<AppMapKit>`'s `mapType` prop documents `'muted'`, which is not a
 *   MapKit JS value. Apple's `mapkit.MapType.MutedStandard` is `'mutedStandard'`
 *   (`@types/apple-mapkit`, `declare const MapType`), so 2.1.0 handed MapKit a
 *   value it does not know. The alias is translated here and every real MapKit
 *   value passes through untouched, so `mapType="mutedStandard"` also works.
 * - **K-4.** `mapType` and `colorScheme` were applied in the `mapkit.Map`
 *   constructor only, so changing either prop on a mounted map did nothing.
 *   `applyMapKitBasemap` is what the component's watcher calls.
 */
import type { MapKitMapLike } from './mapkit-surface.js';
import type { MapKitMapType } from '../types.js';
/** The value MapKit JS is given for a `mapType` prop. */
export declare function resolveMapKitMapType(mapType: MapKitMapType): string;
export interface MapKitBasemap {
    /** Already resolved to `'dark'` or `'light'`; `'auto'` is the component's to decide. */
    colorScheme: 'dark' | 'light';
    mapType: MapKitMapType;
}
/** Write a basemap onto a live map. Idempotent; MapKit ignores an unchanged write. */
export declare function applyMapKitBasemap(map: MapKitMapLike, basemap: MapKitBasemap): void;
//# sourceMappingURL=basemap.d.ts.map