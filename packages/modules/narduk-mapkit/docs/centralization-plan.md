# Mapping Code Centralization Plan

This plan is based on the local and GitHub inventory run on July 4, 2026.

## Inventory

Representative local code:

- `narduk-maps`: MapKit and Leaflet engines for raster tile playback, viewport persistence, and overlay crossfades.
- `austin-texas-net`: Nuxt token route, local MapKit loader, generic marker/GeoJSON/circle component, region bounds, clustering, and dynamic circle radius.
- `tpwdreefs`: Nuxt/H3 token route that bridges Cloudflare bindings into the shared server helper.
- `hydrogen`: station marker map with custom annotations, clusters, focus-by-region, geolocation, and nearest-station calculation.
- `grib-viewer` and `gonogo-ios`: native MapKit/tile/raster overlay code that should influence data contracts, but not be folded into this TypeScript package.

Representative remote-only hits:

- `gonogo/src/worker/mapkit.ts`: Worker token signing with an origin-keyed token cache.
- `narduk-earth-data` and `earthdata-viewer`: deployed viewer code using the shared token route and MapKit tile overlays.
- `grib-viewer/tools/rawenc-mapkit-viewer`: browser MapKit inspection tooling for chart/raster data.
- `GeoGridKit`: Swift MapKit tile overlay host for grid data.

## Direction

Keep `@loganrenz/narduk-mapkit` framework-agnostic and web-focused:

- Server: origin resolution, allowlists, env/Doppler/Worker config, token signing, token caching.
- Client: script loading, token refresh, MapKit JS constructors, tile overlays, overlay animation.
- Geometry: plain-data bounds, GeoJSON extraction, drawable framing, distance and hit testing.
- Playback: route progress, route slicing, duration formatting.

Do not put Nuxt, Vue, Hono, Cloudflare, SwiftUI, or app-specific marker HTML in core. Keep those as examples or downstream adapters.

## Migration Order

1. Replace custom token routes with `createMapKitTokenHandler()` or `mapKitTokenResponseFromEnv()`.
2. Replace local `useMapKit` / script-loader copies with `initializeMapKit()`.
3. Replace local `flyToBounds`, `computeBoundingRegion`, GeoJSON bounds extraction, and lng/lat tile bounds code with `computeMapKitRegionFor*()` plus `createMapKitRegionFor*()`.
4. Replace custom MapKit tile overlay constructors and fade loops with `createMapKitTileOverlay()` and `crossfadeMapKitOverlayOpacity()`.
5. Leave marker DOM, callout content, app panels, data fetching, and domain-specific nearest-item logic in each app.
6. For native Swift map code, align data contracts and tile semantics with this package, but keep native rendering in Swift packages such as `GeoGridKit`.

## Performance Targets

- Token endpoint: avoid repeated ECDSA key import/sign operations by reusing signed tokens per origin until they near expiry.
- Browser boot: avoid duplicate script loads and coalesce concurrent token refreshes.
- Region calculation: compute bounds from normalized plain data once, then build runtime MapKit objects at the edge.
- Tile animation: only keep the current and fading overlays alive, remove stale overlays after transition completion, and allow cancellation.
- Large point clouds: prefer circles or clustered annotations over thousands of rich DOM annotations; keep dynamic radius and marker HTML app-specific.

## Follow-Up Candidates

- A small `@loganrenz/narduk-mapkit-vue` adapter if three or more Vue/Nuxt apps converge on the same component API.
- A shared `MapEngine` contract for MapKit/Leaflet fallback viewers if the earth-data viewer pattern spreads.
- A Swift companion package only if the native apps need shared MapKit overlay contracts beyond what `GeoGridKit` already provides.
