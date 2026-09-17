/**
 * MapKit JS 6 ships `mapkit.core.js` as a stub, so the list is what decides
 * whether there is a `mapkit.Map` at all. These three are what 2.0.x hard-coded;
 * 2.1.0 keeps them as the DEFAULT and makes the list configurable
 * (narduk-libs#422 §b) so an app that draws only pins can drop `overlays`.
 */
export const DEFAULT_MAPKIT_LIBRARIES = ['map', 'annotations', 'overlays'];
export const DEFAULT_MAPKIT_TOKEN_ROUTE = '/api/mapkit-token';
//# sourceMappingURL=defaults.js.map