# Canonical MapKit Workspace

This decision record began with the local and GitHub inventory run on July 4,
2026 and was implemented on July 14, 2026. This repository is the canonical
web MapKit source under the `narduk-geo` organization.

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

- Server: origin resolution, allowlists, explicit Worker config, token signing,
  and token caching. Process/Doppler resolution is isolated in the `/node`
  subpath and never enters the Worker graph.
- Client: script loading, token refresh, MapKit JS constructors, tile overlays, overlay animation.
- Geometry: plain-data bounds, GeoJSON extraction, drawable framing, distance and hit testing.
- Playback: route progress, route slicing, duration formatting.
- Apple Maps Server API: developer/access tokens, search, and geocoding.

Publish `@loganrenz/narduk-mapkit-nuxt` from this workspace as the one Nuxt
adapter. It owns the reusable `AppMapKit` component, composables, module
registration, and H3 token route while depending on core for token and client
behavior.

Do not put Nuxt, Vue, Hono, Cloudflare, SwiftUI, or app-specific marker HTML in
core. Do not put app panels, product data fetching, domain styling, or native
Swift rendering in the Nuxt adapter.

## Migration Order

1. Replace custom token routes with `createMapKitTokenHandler()` or `mapKitTokenResponseFromEnv()`.
2. In Nuxt apps, install the Nuxt adapter and replace local `useMapKit`,
   `useMapkitToken`, `AppMapKit`, and token-route copies.
3. Replace local `flyToBounds`, `computeBoundingRegion`, GeoJSON bounds extraction, and lng/lat tile bounds code with `computeMapKitRegionFor*()` plus `createMapKitRegionFor*()`.
4. Replace custom MapKit tile overlay constructors and fade loops with `createMapKitTileOverlay()` and `crossfadeMapKitOverlayOpacity()`.
5. Remove vendored source, absolute tarballs, mutable Git refs, redirected
   repository URLs, and copied token implementations after each consumer is
   proven against immutable npm releases.
6. Leave marker DOM, callout content, app panels, data fetching, and
   domain-specific nearest-item logic in each app.
7. For native Swift map code, align data contracts and tile semantics with
   this package, but keep native rendering in Swift packages such as
   `GeoGridKit`.

## Performance Targets

- Token endpoint: avoid repeated ECDSA key import/sign operations by reusing signed tokens per origin until they near expiry.
- Browser boot: avoid duplicate script loads and coalesce concurrent token refreshes.
- Region calculation: compute bounds from normalized plain data once, then build runtime MapKit objects at the edge.
- Tile animation: only keep the current and fading overlays alive, remove stale overlays after transition completion, and allow cancellation.
- Tile gating: cache at most 2,048 geographic intersection decisions and share
  those decisions across 1x/2x scale variants.
- Large point clouds: prefer circles or clustered annotations over thousands of rich DOM annotations; keep dynamic radius and marker HTML app-specific.

## Consolidated Source Material

- The former top-level `narduk-mapkit` checkout supplied the idempotent vector
  overlay attach/remove helpers and tests. Its other source was stale and was
  not copied over newer canonical behavior.
- `earthdata-viewer/vendor/narduk-mapkit` supplied the bounded tile-intersection
  cache. The vendor copy must remain until Earthdata migrates to a published
  release.
- `narduk-template/layers/maps` supplied the Nuxt component/composable contract
  and Apple Maps search/geocode behavior. Template-only rate limiting, logging,
  core-layer imports, Nuxt UI, and color-mode dependencies were not retained.
  Rate-limit provider code stayed app-owned; only a request-scoped generic hook
  contract was retained.

## Follow-Up Candidates

- A shared `MapEngine` contract for MapKit/Leaflet fallback viewers if the earth-data viewer pattern spreads.
- A Swift companion package only if the native apps need shared MapKit overlay contracts beyond what `GeoGridKit` already provides.
