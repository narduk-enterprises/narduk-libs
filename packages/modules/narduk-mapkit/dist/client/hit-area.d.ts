/**
 * Apply an enlarged tap target to a marker host.
 *
 * `expandMapKitHitArea` (pure, on `./geometry`) decides the host's size and the
 * padding that keeps the glyph where the anchor puts it; this writes them to the
 * element. Shared by `<AppMapKit>`'s pin layer and `MapKitMovingMarkerLayer` so
 * a hit area means the same thing for static and moving markers.
 */
import type { MapKitHitAreaPadding, MapKitPinGeometry } from '../nuxt/runtime/pin-geometry.js';
export declare const MAPKIT_HIT_AREA_ATTRIBUTE = "data-mapkit-hit-area";
/**
 * Size and pad `host` for `geometry` (the enlarged one `expandMapKitHitArea`
 * returned) and `padding`. With no padding, or no size, it removes what an
 * earlier call set, so a marker that no longer needs the larger target goes back
 * to the size of its glyph.
 */
export declare function writeMapKitHitArea(host: HTMLElement, geometry: MapKitPinGeometry, padding: MapKitHitAreaPadding): void;
//# sourceMappingURL=hit-area.d.ts.map