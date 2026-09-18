/**
 * This library's own spellings, mapped onto MapKit's.
 *
 * Only `'muted'` needs one: `'hybrid'`, `'satellite'` and `'standard'` are
 * already Apple's own values, and so is `'mutedStandard'`.
 */
const MAPKIT_MAP_TYPE_ALIASES = {
    muted: 'mutedStandard',
};
/** The value MapKit JS is given for a `mapType` prop. */
export function resolveMapKitMapType(mapType) {
    return MAPKIT_MAP_TYPE_ALIASES[mapType] ?? mapType;
}
/** Write a basemap onto a live map. Idempotent; MapKit ignores an unchanged write. */
export function applyMapKitBasemap(map, basemap) {
    map.mapType = resolveMapKitMapType(basemap.mapType);
    map.colorScheme = basemap.colorScheme;
}
//# sourceMappingURL=basemap.js.map