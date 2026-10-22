# Ponytail audit: mapkit source

What this repo does: `@narduk-enterprises/narduk-mapkit` is the shared MapKit library. It signs same-host MapKit JWTs, draws markers, callouts, and vector tiles in the browser, and ships a Nuxt module. `@narduk-enterprises/narduk-mapkit-nuxt` is the older adapter. Its README says it is frozen and that new apps should use `@narduk-enterprises/narduk-mapkit/nuxt`.

Load I assumed: published npm libraries used by Nuxt apps on Cloudflare Workers, and sometimes on Node. A token route is public to the browser. A map holds hundreds to a few thousand markers, or a regional vector-tile network. I did not assume millions of DOM markers.

## Must fix

### 1. In-flight vector tile still paints after clearCache

`packages/modules/narduk-mapkit/src/client/vector-tiles.ts:1658-1665`

What this is: `clearCache()` bumps a generation so an old decode is not stored. `execute()` still returns that decode.

Problem: `useMapKitVectorTiles` calls `clearCache()` when the archive url changes (`packages/modules/narduk-mapkit-nuxt/src/runtime/composables/useMapKitVectorTiles.ts:119-120`). A read that started on the old archive can finish after that. `execute` skips `cache.set` when the generation changed, then `return tile`. `imageForTile` paints that tile and hands the canvas to MapKit. The test at `packages/modules/narduk-mapkit/tests/vector-tiles.test.ts:279-305` only checks that the cache size is 0. It still lets the in-flight `imageForTile` resolve to a painted canvas. Switch from `rivers-2024.pmtiles` to `rivers-2025.pmtiles` while tile `7/31/48` is in flight, and the map shows the 2024 lines.

Fix: After decode, if `startedAt !== generation` or the abort signal is set, return `null`. In `clearCache()`, abort the running reads so the fetch can stop.

If we skip it: Tiles that were already downloading show the previous archive until MapKit asks for them again.

### 2. Adapter token route ignores the host allowlist the README describes

`packages/modules/narduk-mapkit-nuxt/src/runtime/server/mapkit-token.get.ts:59-89`

What this is: The GET handler calls `mapKitTokenResponse` with the Apple key, team id, and private key only. It does not pass `allowedHosts`.

Problem: `packages/modules/narduk-mapkit-nuxt/README.md:309-315` says `MAPKIT_ALLOWED_ORIGINS` and `runtimeConfig.mapkitAllowedOrigins` are used, and that a missing setup returns `{ configured: false }`. This route reads neither. `packages/modules/narduk-mapkit-nuxt/script/check-cloudflare-build.mjs:111-135` sends `Origin: https://allowed.example` to `https://worker.example` with `MAPKIT_ALLOWED_ORIGINS=https://allowed.example` and `APPLE_MAPKIT_TOKEN` set. It expects 200 and `{ configured: true, token }`. The handler returns 403, because that origin is not the worker host, and it never returns a static token (`staticToken` is ignored in `packages/modules/narduk-mapkit/src/server/handler.ts:32`). On a Node listener, `Host: evil.example` plus `Sec-Fetch-Site: same-origin` mints a JWT whose `origin` is `http://evil.example` (or `https://evil.example`). `isMapKitHostAllowed` would refuse that host, but only when `allowedHosts` is set. The kit route sets it (`packages/modules/narduk-mapkit/src/nuxt/runtime/server/mapkit-token.get.ts:131-137`). This adapter does not. Cloudflare binds `Host`, so that forge does not work there. Node does not.

Fix: Pass `allowedHosts` into `mapKitTokenResponse`, the same way the kit route does. Store hostnames, not `https://` origins. Update the README and `check-cloudflare-build.mjs` to the current JSON (`error`, `token`, `expiresAt`) and to same-origin requests.

If we skip it: An operator who set `MAPKIT_ALLOWED_ORIGINS` thinks unknown hosts are refused. On Node they are not, and the Apple key signs a token for the attacker's host. `pnpm test:cloudflare` in this package checks a contract this route no longer implements.

## Should fix

### 3. Copied Nuxt token example builds self from a spoofable URL

`packages/modules/narduk-mapkit/examples/nuxt-mapkit-token.get.ts:18-27`

What this is: The sample sets `self` from `getRequestURL(event, { xForwardedHost: false }).origin`.

Problem: An absolute-form request line `GET https://evil.example/api/mapkit-token HTTP/1.1` makes `getRequestURL` use `https://evil.example`. `mapKitRoutedOrigin` (`packages/modules/narduk-mapkit/src/server/handler.ts:143-160`) returns null for that target, and the real module route uses it. This example does not. Add `Sec-Fetch-Site: same-origin` and the route signs a token for `https://evil.example`. Apps that set `tokenRoute: false` are told to copy this file.

Fix: Build `self` with `mapKitRoutedOrigin`, as `packages/modules/narduk-mapkit/src/nuxt/runtime/server/mapkit-token.get.ts:82-89` does.

If we skip it: A custom token route copied from the example mints for the host written on the request line.

### 4. Adapter frames the long way across the date line

`packages/modules/narduk-mapkit-nuxt/src/runtime/components/AppMapKit.vue:293-302`

What this is: `computeBoundingRegion` uses `maxLng - minLng` and the midpoint.

Problem: Points `(lat 30, lng 179.5)` and `(lat 31, lng -179.5)`, default padding `0.05`. Longitude span is `359 * 1.05 = 376.95` degrees. Center longitude is `0`. The map opens on the whole world. `computeLongitudeSpan` (`packages/modules/narduk-mapkit/src/geometry/longitude.ts:17-20`) is 1 degree centered on 180 for this pair. The kit component calls `mapKitBoundingRegion`. The adapter does not.

Fix: Use `mapKitBoundingRegion` or `computeLongitudeSpan` for the longitude span and center.

If we skip it: A route or polygon that crosses ±180° in an app still on `narduk-mapkit-nuxt` is framed as the whole world.

### 5. Metre grid misses neighbours across ±180°

`packages/modules/narduk-mapkit/src/geometry/declutter.ts:172-174`

What this is: `MetreGrid.#column` is `floor(lng / cellLng)`. `anyCloserThanPixels` and `collapseNearbyPoints` only compare a cell with the eight around it.

Problem: `{lat: 0, lng: 179.9}` and `{lat: 0, lng: -179.9}` are 22,239 m apart. On a map with latitude span 10° and height 400 px, that is about 8 px. `anyCloserThanPixels(points, 20, 10, 400)` should be true. The limit is 55,660 m. The columns are `floor(179.9 / 0.5) = 359` and `floor(-179.9 / 0.5) = -360`. The scan never pairs them, so the function returns false. `chooseMapKitMarkerTier` stays on `symbol`, and the markers draw on top of each other. `collapseNearbyPoints` with `maxMetres: 50000` keeps two groups. `gridCluster` (`packages/modules/narduk-mapkit/src/geometry/helpers.ts:206-208`) splits the same pair. Nothing in this repo calls `gridCluster`. It is a public export.

Fix: Shift longitude onto one continuous arc before the column index. `computeLongitudeSpan` already picks that arc.

If we skip it: Date-line maps keep the large marker tier, and stops that sit together are not collapsed.

### 6. Arrow keys treat a date-line step as backwards

`packages/modules/narduk-mapkit/src/geometry/roving.ts:55-70`

What this is: East/west distance is `(point.lng - origin.lng) * cos(lat)`.

Problem: Origin `{lat: 0, lng: 179}`, candidate `{lat: 0, lng: -179.5}`. The candidate is 1.5° east. `east` is `-358.5`. For `direction: 'east'`, `along <= 0`, so `nextMapKitRovingKey` returns null when that is the only other pin. The kit pin layer uses this for arrow keys (`packages/modules/narduk-mapkit/src/nuxt/runtime/pin-layer.ts:482`).

Fix: Use the short longitude delta for the east component. `shortestLongitudeDeltaDegrees` in `geometry.ts:567-571` is that helper.

If we skip it: Arrow Right on a pin just west of ±180° does not move to the pin just east of it.

### 7. Polygon and line hit tests use raw longitude

`packages/modules/narduk-mapkit/src/geometry/geometry.ts:433-489`

What this is: `pointInPolygon` and `closestPointOnSegment` treat longitude as a flat x axis. `hitTestPolygonOverlays` is what the Nuxt overlay layer calls on a tap (`packages/modules/narduk-mapkit/src/nuxt/runtime/overlay-layer.ts:135`).

Problem: Ring `(0°, 179°) → (10°, 179°) → (10°, -179°) → (0°, -179°)`. The short reading is a 2° strip across the date line. `pointInPolygon({lat: 5, lng: 179.5}, ring)` is false. `pointInPolygon({lat: 5, lng: 0}, ring)` is true. A tap in the strip misses. A tap in the Atlantic can hit. `hitTestLineOverlays` uses the same flat segment math. Nothing in this repo calls it. `findNearestMapKitLineHit` already uses the short delta. The flat helper is still exported.

Fix: Unwrap each ring on the short arc before the ray cast. Point `hitTestLineOverlays` at `segmentClosestPointV2`.

If we skip it: Taps on a polygon that crosses ±180° hit the wrong shape, or none.

### 8. Vector-tile areas stretch across the world at ±180°

`packages/modules/narduk-mapkit/src/client/vector-tile-areas.ts:123-158`

What this is: Area rings are stored as world x `(lng + 180) / 360`, then boxed and filled as straight edges.

Problem: Corners at lng 179 and lng -179 become world x `0.997` and `0.003`. The box runs from `0.003` to `0.997`. `shapeContains` rejects lng 179.5 (world x `0.999`, past the east edge). `areaReaches` (`vector-tile-areas.ts:305-308`) uses that box, so the area matches tiles across the Atlantic. The edge from `0.997` to `0.003` is the long way.

Fix: Unwrap each ring, or split it at ±180, before `worldX`.

If we skip it: A boundary polygon that crosses the date line is drawn across the planet and does not contain the points in the real strip.

### 9. Switching the follow target never ends the previous follow

`packages/modules/narduk-mapkit/src/client/moving-markers.ts:259-271`

What this is: `follow(id)` stores `#followId` and adds gesture listeners. `#endFollow` is what calls `onFollowEnd`.

Problem: `follow('bus-1')` then `follow('bus-2')` does not call `#endFollow('bus-1')`. `onFollowEnd('bus-1')` never runs. `followedId` is `bus-2`. The tests cover a pan after follow, and a follow of an unknown id (`packages/modules/narduk-mapkit/tests/moving-markers.test.ts:353-380`). They do not cover a switch from one id to another.

Fix: When the previous id is a different marker, call `#endFollow` for it before attaching listeners for the new id.

If we skip it: A control that clears "following bus-1" inside `onFollowEnd` stays on bus-1 while the camera tracks bus-2.

### 10. Single-id highlight still uses the old hairline floor

`packages/modules/narduk-mapkit/src/client/vector-tiles.ts:1323-1334`

What this is: `paintVectorTile` and `paintVectorTileHighlightPlan` draw thin lines with `hairlineStroke`. `paintVectorTileHighlight` does not.

Problem: `hairlineStroke` (`vector-tiles.ts:997-1010`) says a 0.3 CSS px line on a 3x screen is 1 device px at alpha 0.9, not 1.5 px. Style `{ width: 0.3 }` and `pixelRatio` 3: the network line is width 1 and alpha 0.9. The highlight uses `Math.max(0.9, 1.5) = 1.5` at full alpha. The highlight is thicker and darker than the line under it.

Fix: Call `hairlineStroke` for the casing and the stroke in `paintVectorTileHighlight`.

If we skip it: A thin highlighted reach looks heavier than the network it sits on.

### 11. Map menu keeps detached buttons when the list shrinks

`packages/modules/narduk-mapkit/components/MapkitMenu.vue:40-49`

What this is: Arrow keys walk `itemRefs`, not `props.items`.

Problem: `setItemRef` stores a node when Vue passes one. It does nothing when Vue passes `null` as a row unmounts. Open the menu with 12 items, then replace `items` with 3 while it stays open. Indexes 3 through 11 still point at detached buttons. `focusIndex` uses `itemRefs.length`, which is still 12. ArrowDown can focus a button that is no longer in the menu.

Fix: Clear the slot when the ref is null. Move focus only across `props.items.length` live nodes.

If we skip it: A filtered menu sends keyboard focus to a control that is not on screen.

### 12. useMapkitToken still returns a public static JWT

`packages/modules/narduk-mapkit-nuxt/src/runtime/composables/useMapkitToken.ts:19-21`

What this is: If `runtimeConfig.public.mapkitToken` is a non-expired JWT, `getMapkitToken()` returns it and does not call the same-host route.

Problem: Nuxt puts `public` runtime config in the page payload. `NUXT_PUBLIC_MAPKIT_TOKEN` is in the HTML of every visitor. This composable then uses that token for MapKit. The kit module ignores the same key (`packages/modules/narduk-mapkit/src/nuxt/index.ts:115-120`). This adapter warns and still returns it. A portal token with no origin restriction works on any site until `exp`. The old default lifetime was 24 hours.

Fix: Do not return `public.mapkitToken`. Always call `fetchMapKitToken`. Keep the warning when the key is set.

If we skip it: An app that still has the public token ships it to the browser, and MapKit uses it instead of a short same-origin JWT.

### 13. Every selection rebuilds every pin

`packages/modules/narduk-mapkit-nuxt/src/runtime/components/AppMapKit.vue:834-836`

What this is: The `selectedId` watcher calls `rebuildAnnotations` (`AppMapKit.vue:658-663`). That removes every owned pin and creates them all again.

Problem: A map with 800 items. The user selects one. `createPinElement` runs 800 times, and MapKit removes and adds 800 annotations, to change one selected state. The kit pin layer updates the pins that changed.

Fix: Rebuild only the pin that lost selection and the pin that gained it.

If we skip it: Selecting a marker on a large set stalls the main thread on every click.

## Nice to have

### 14. normalizeLongitudeDegrees is copied

`packages/modules/narduk-mapkit/src/geometry/geometry.ts:562-565`

What this is: A private copy of `packages/modules/narduk-mapkit/src/geometry/longitude.ts:7-10`. The bodies match today, including the `-0` check.

Problem: Region math and `segmentClosestPointV2` call the private copy. `gridCluster` and the Nuxt region helper call the exported one. A later edit to one copy will not change the other, so a region center and a line hit can disagree on the same longitude.

Fix: Import `normalizeLongitudeDegrees` from `./longitude.js` and delete the private function.

If we skip it: The two copies stay the same only until someone edits one of them.

### 15. Callout sample writes names with innerHTML

`packages/modules/narduk-mapkit/src/client/callouts.ts:61-64`

What this is: The doc sample sets `host.innerHTML` to `` `<h3>${context.item.name}</h3>` ``.

Problem: A name `</h3><img src=x onerror=alert(1)>` runs as HTML in the map overlay. The hover tooltip sets `textContent`. This sample does not. Apps copy the sample.

Fix: Build the heading with `textContent` in the sample. Leave the `render(host)` contract so a Vue mount still works.

If we skip it: The first callout copied from this sample is an XSS sink for marker names.

Five smaller notes are not listed above. A poller with `intervalMs: 0` schedules the next tick with no delay. A signing throw is logged as `refusal: 'unconfigured'` while the body says `signing-failed`. The adapter accepts a `tokenRoutePath` of `//...` at setup; `fetchMapKitToken` already throws before that fetch. `DecodedVectorTileCache.get` promotes a tile on `hitTest` and `pathPieces`, not only when the tile is painted. The Hono token example never passes `allowedHosts` for a Node listener.

Verdict: The kit token route, the same-origin checks, and `computeLongitudeSpan` are sound. Fix the in-flight tile paint and the adapter host allowlist before relying on an archive swap or a Node token route. The date-line misses are local and real.

Lean: -4 lines, -0 dependencies possible.

Not checked: I did not read `src/testing/runtime.ts` or `src/testing/types.ts` line by line. I did not read all of `AppMapKit.ts`, `probe.ts`, `fullscreen.ts`, `scaling.ts`, `temporal.ts`, `label-layer.ts`, `point-layer.ts`, `layers.ts`, `instrument-marks/`, or `marks/` beyond the date-line and roving paths cited above. I did not re-read `vector-tile-worker.ts`, `vector-tile-paint-worker.ts`, `vector-tile-paths.ts`, `mvt.ts`, `serve.ts`, or `pmtiles.ts`. I did not read Vue components other than `MapkitMenu.vue`, or examples other than the two token routes. I did not read `AppMapKitCallout.vue`, the playground UI, `script/check_dist_clean.mjs`, or `script/check_package_exports.mjs`. `dist/` is generated and was ignored. Other packages in this repo are other lanes.
