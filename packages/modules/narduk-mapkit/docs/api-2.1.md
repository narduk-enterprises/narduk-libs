# `@narduk-enterprises/narduk-mapkit` 2.1.0 — API specification

Status: **specification, not implementation.** This is the contract S3/S4/S5
code against. Written 2026-09-17 (lane MAPKIT-S2).

Inputs: the MAPKIT-REPLAN plan (Revision 2.1) as a proposal, and the MAPKIT-S1
spike as measured evidence. **Where they disagree, the spike wins** — every such
correction is marked (S1). PLAN §4.10 is VOID; PLAN §4.7's CSP contribution
point is descoped (narduk-libs#410).

Binding decisions (Logan, 2026-09-17): one package with a `./nuxt` entry;
narduk-app consumers only; MapKit JS v6 via Apple's loader; same-host
fail-closed token route; admission bar "2 live apps or a defect fix"; lift
nothing from pacc-trac-live except the per-pin anchor fix; fake lives at
`narduk-mapkit/testing`; Buoys is the first and only required consumer.

Defects 2.1.0 must fix: **buoys#112** (mobile annotation callout has no "View
details" link — root cause is rebuild-on-selection: §c.2 and the `#callout` slot
in §c.4) and the **per-pin anchor defect** (narduk-libs#305, measured -85/-144
px; Buoys carries its own red test).

---

**2.1.1 amends this specification in place.** Every change below is marked
(2.1.1) and carries the kit defect it fixes (K-1..K-10) -- all of them found by
Buoys while adopting 2.1.0. Where 2.1.0's text described something that was
never built, or was built differently, the 2.1.1 text is the contract and the
old sentence is gone rather than struck through; §g was rewritten wholesale for
that reason.

---

## a. Package entries and exports

One published package, one version. `@narduk-enterprises/narduk-mapkit-nuxt` is
**frozen at 2.0.x** and receives no 2.1.0 release.

| Entry           | 2.0.2                | 2.1.0                      | Notes                                                                                                                                                                        |
| --------------- | -------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`             | barrel of everything | unchanged                  | still re-exports client + geometry + playback + server + token + types                                                                                                       |
| `./client`      | stable               | **changed**                | loader is v6-only (§d); `MAPKIT_JS_V6_SCRIPT_URL`, `scriptUrl`, `staticToken`, `isJwtExpired`, `tokenRefreshWindowMs` removed from the _option and behaviour_ surface (§a.2) |
| `./geometry`    | stable               | unchanged                  | mybo depends on it; no change                                                                                                                                                |
| `./server`      | stable               | **changed**                | `mapKitTokenResponse` implements §e                                                                                                                                          |
| `./token`       | stable               | **changed**                | default TTL 86400 → 1800 s; `origin` claim required, never defaulted                                                                                                         |
| `./apple-maps`  | zero consumers       | unchanged, `@experimental` | not deleted                                                                                                                                                                  |
| `./playback`    | zero consumers       | unchanged, `@experimental` | not deleted                                                                                                                                                                  |
| `./worker`      | hydrogen, my-farm    | unchanged, **unsupported** | out of scope (bare Workers); no new work, not deleted                                                                                                                        |
| `./node`        | my-farm              | unchanged, **unsupported** | same                                                                                                                                                                         |
| **`./nuxt`**    | —                    | **NEW**                    | the Nuxt module: `<AppMapKit>`, `useMapKit()`, the token route (§b, §c)                                                                                                      |
| **`./testing`** | —                    | **NEW**                    | the deterministic MapKit fake (§g)                                                                                                                                           |

### a.1 Compatibility for the two apps pinned at exact 2.0.0

**hydrogen** (root Worker, `./worker`) and **my-farm** (`./node`, `./client`,
`./geometry`) both pin `@narduk-enterprises/narduk-mapkit` at an exact `2.0.0`.
Publishing 2.1.0 changes nothing for them until somebody edits a pin: no range
resolves forward. Both are out of scope as design constraints and **stay on
2.0.0**; neither export is removed, so nothing breaks.

The seven apps on `@narduk-enterprises/narduk-mapkit-nuxt` 2.0.4/2.0.5/2.0.6
carry that package's own exact-pinned copy of core 2.0.2 inside it. They cannot
receive the new component by accident — moving to `./nuxt` is an edit to
`nuxt.config.ts`, i.e. a migration PR.

**The one real hazard**: seven consumers run Dependabot weekly with
`@narduk-enterprises/*` included and zero cooldown. hydrogen and gonogo are in
that set, and a 2.1.0 bump would flip hydrogen `web/`'s map from MapKit JS v5 to
v6 with green CI that cannot see the map. Mitigation is a Dependabot `ignore`
for `>=2.1.0` in **hydrogen** and **gonogo**, landed _before_ publish (§h, slice
DEP).

### a.2 Removed / deprecated vs 2.0.x

Nothing is removed from any published entry. "Removed" below means _not carried
into `./nuxt`_ or _no longer an option on `./client`_:

| Thing                                                                                                                                       | Disposition                              | Why                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staticToken`, `MAPKIT_TOKEN`, `APPLE_MAPKIT_TOKEN`, `public.mapkitToken`                                                                   | **deleted from `./client` and `./nuxt`** | (S1 §5.5) a portal token is origin-restricted by the same mechanism, so it can only ever work on one domain — never a preview, never localhost. One that works everywhere has no origin restriction, i.e. exactly the object Logan does not want. |
| `scriptUrl`, `MAPKIT_JS_V6_SCRIPT_URL`, `loadMapKitLibraries`                                                                               | deleted from `./client` options          | Apple's loader owns the script URL; it throws on any `5*` version string, so there is no accidental-v5 path to defend.                                                                                                                            |
| `isJwtExpired`, `tokenRefreshWindowMs`                                                                                                      | deleted from `./client`                  | (S1 §7) redundant against v6: the JWT is spent once at `/ma/bootstrap` and MapKit runs on an accessKey afterwards.                                                                                                                                |
| `MAPKIT_ALLOWED_ORIGINS`                                                                                                                    | **ignored**, one startup log line        | the request's own routed host is the only source of the claim (§e).                                                                                                                                                                               |
| `MAPKIT_SERVER_API_KEY`                                                                                                                     | dead, leaves the docs                    | no consumer.                                                                                                                                                                                                                                      |
| adapter `callouts*` props, `<AppMapKitCallout>`, `useMapKitCallouts`, `useMapkitToken`, `fullscreenControl`/`fullscreenMode`, `centerLabel` | **not carried to `./nuxt`**              | zero consumers on the package. The callout need is met by the `#callout` slot instead (§c.4).                                                                                                                                                     |
| `event.context.nardukMapKit.rateLimit` hook                                                                                                 | not carried                              | zero consumers; narduk-core's rate limiter replaces it (§e.4).                                                                                                                                                                                    |
| `annotationSize` (global, default 100×56), hard-coded `anchorOffset (0,-6)`                                                                 | **do not exist at `./nuxt`**             | the anchor defect (narduk-libs#305). Replaced by per-pin geometry (§c.3).                                                                                                                                                                         |

---

## b. Nuxt module options and env names

Module ID `@narduk-enterprises/narduk-mapkit/nuxt`, `configKey: 'nardukMapKit'`,
`compatibility: { nuxt: '>=4.0.0' }`. Peers: `nuxt >=4`, `vue >=3.5`,
`@narduk-enterprises/narduk-core` (assumed present). Runtime deps:
`@apple/mapkit-loader ^1`, `@nuxt/kit ^4`, `h3 ^1`. `@types/apple-mapkit ^6`
arrives **transitively as a runtime dependency of the loader** (S1 §3) — it is
not a devDependency choice and cannot drift from the loader.

| Option            | Type                                       | Default                               | Notes                                                                |
| ----------------- | ------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------- |
| `component`       | `boolean`                                  | `true`                                | registers `AppMapKit`                                                |
| `composables`     | `boolean`                                  | `true`                                | registers `useMapKit`                                                |
| `tokenRoute`      | `boolean`                                  | `true`                                | registers the token route                                            |
| `tokenRoutePath`  | `string`                                   | `'/api/mapkit-token'`                 | must start with `/`; same-host only                                  |
| `libraries`       | `MapKitLibrary[]`                          | `['map', 'annotations', 'overlays']`  | app-wide default for the required `libraries` prop                   |
| `language`        | `string \| undefined`                      | `undefined`                           | passed to `load()`                                                   |
| `ssrPreload`      | `boolean`                                  | `true`                                | emit `renderHTMLAttributes()` during SSR, **without** a token (§d.4) |
| `tokenTtlSeconds` | `number`                                   | `1800`                                | clamped to `[60, 1800]`                                              |
| `rateLimit`       | `{ limit: number; windowSeconds: number }` | unset: **no limit** (narduk-libs#485) | opt-in fixed-window ceiling per routed origin                        |

`ModuleOptions` carries no token, key, or origin-list value — nothing secret is
ever a module option.

### b.1 runtimeConfig and env NAMES (names only; values never appear here or in logs)

| runtimeConfig key            | Env name            | Default          | Notes                                                 |
| ---------------------------- | ------------------- | ---------------- | ----------------------------------------------------- |
| `appleTeamId`                | `APPLE_TEAM_ID`     | `''`             | JWT `iss`                                             |
| `appleKeyId`                 | `APPLE_KEY_ID`      | `''`             | JWT `kid`                                             |
| `applePrivateKey`            | `APPLE_PRIVATE_KEY` | `''`             | ES256 signing key                                     |
| `appleSecretKey`             | `APPLE_SECRET_KEY`  | `''`             | historical alias for the line above; kept             |
| `public.mapkitTokenEndpoint` | —                   | `tokenRoutePath` | relative path only; an absolute URL is a config error |

**Removed**: `mapkitAllowedOrigins` (`MAPKIT_ALLOWED_ORIGINS`) and
`public.mapkitToken`. Both are read once at setup and, if present, produce a
single startup warning naming the key — never its value. Custody of the signing
material is nvault persona `apple/prd/mapkit-signing`; the company-hq#338
cutover is separate work.

---

## c. `<AppMapKit>` — props, emits, slots, expose

Generic over `T`, the app's item type.

> **`window.mapkit` is NOT the namespace your map belongs to.** MapKit JS 6
> resolves `mapkit.load(libraries)` to a scoped namespace object that is not
> `window.mapkit`, and an `Annotation`, `Coordinate`, `CoordinateRegion`,
> `MapRect` or `MapType` built from the global one is refused by your own map
> (`Map.addAnnotations expected an annotation at index 0, but got [object EventTarget]`).
> Build every MapKit value from the namespace this component hands you --
> `map-ready`'s second argument (§c.5), the ref's `getMapKit()` (§c.6), or
> `useMapKit().mapkit` -- and never from `globalThis.mapkit`. Measured live
> against MapKit JS 6.0.128 on 2026-09-17 (K-10, §g.1).

### c.1 Props

| Prop                                                                                        | Type                                                                               | Default                   | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `libraries`                                                                                 | `MapKitLibrary[]`                                                                  | —                         | **REQUIRED** (S1 §3): `mapkit.core.js` is a stub; without `'map'` there is no `mapkit.Map` at all. Module default applies only when the prop is omitted _and_ `nardukMapKit.libraries` is set.                                                                                                                                                         |
| `items`                                                                                     | `readonly T[]`                                                                     | `[]`                      | keyed; see `itemKey`                                                                                                                                                                                                                                                                                                                                   |
| `itemKey`                                                                                   | `(item: T, index: number) => string`                                               | reads `item.id`           | **the buoys#112 root-cause fix.** A stable key per item makes an `items` change a _diff_, not a rebuild. Dev-mode error on a missing or duplicate key.                                                                                                                                                                                                 |
| `itemLabel`                                                                                 | `(item: T) => string`                                                              | —                         | **REQUIRED when `items` is non-empty.** `aria-label` of the library-owned pin host.                                                                                                                                                                                                                                                                    |
| `createPinElement`                                                                          | `(item: T, isSelected: boolean) => { element: HTMLElement; cleanup?: () => void }` | —                         | returns **only the glyph**. The focusable host is the library's.                                                                                                                                                                                                                                                                                       |
| `pinGeometry`                                                                               | `(item: T) => MapKitPinGeometry`                                                   | `() => ({})`              | per-pin size and anchor (§c.3)                                                                                                                                                                                                                                                                                                                         |
| `selectedId` (`v-model:selected-id`)                                                        | `string \| null`                                                                   | `null`                    | matched against `itemKey`                                                                                                                                                                                                                                                                                                                              |
| `hoveredId` (`v-model:hovered-id`)                                                          | `string \| null`                                                                   | `null`                    | **NEW (narduk-libs#517).** The pin under the pointer; the host carries `data-mapkit-hovered`. Zero adds and zero removes.                                                                                                                                                                                                                              |
| `leader`                                                                                    | `{ anchor: HTMLElement \| null } \| null`                                          | `null`                    | **NEW (narduk-libs#517).** Draws a leader from the selected pin to `anchor` on every region change. Emits `leader-offscreen`. The overlay is also `MapKitLeaderOverlay` on `./client`.                                                                                                                                                                 |
| `clusteringIdentifier`                                                                      | `string \| undefined`                                                              | `undefined`               | unchanged from 2.0.x                                                                                                                                                                                                                                                                                                                                   |
| `createClusterElement`                                                                      | `(cluster, count: number) => HTMLElement`                                          | `undefined`               | unchanged                                                                                                                                                                                                                                                                                                                                              |
| `geojson`                                                                                   | `GeoJSONFeatureCollection \| null`                                                 | `null`                    | unchanged                                                                                                                                                                                                                                                                                                                                              |
| `overlayStyleFn`                                                                            | `(props: GeoJSONFeatureProperties) => OverlayStyle`                                | `undefined`               | unchanged                                                                                                                                                                                                                                                                                                                                              |
| `circles`, `dynamicCircleRadius`, `minCircleRadius`, `maxCircleRadius`, `circleScaleFactor` | as 2.0.x                                                                           | as 2.0.x                  | unchanged                                                                                                                                                                                                                                                                                                                                              |
| `zoomSpan`, `minSpanDelta`, `boundingPadding`, `fallbackCenter`                             | as 2.0.x                                                                           | as 2.0.x                  | unchanged                                                                                                                                                                                                                                                                                                                                              |
| `isScrollEnabled` / `isZoomEnabled` / `isRotationEnabled`                                   | `boolean`                                                                          | `true` / `true` / `false` | unchanged                                                                                                                                                                                                                                                                                                                                              |
| `preserveRegion`                                                                            | `boolean`                                                                          | **`true`** (was `false`)  | 7 of 7 consumers set it                                                                                                                                                                                                                                                                                                                                |
| `suppressSelectionZoom`                                                                     | `boolean`                                                                          | **`true`** (was `false`)  | 4 of 5 selection users set it                                                                                                                                                                                                                                                                                                                          |
| `showsPointsOfInterest`                                                                     | `boolean`                                                                          | `false` (was `true`)      | five observed values, all `false`; **confirm riverstatus in S5 before landing this flip**                                                                                                                                                                                                                                                              |
| `mapType`                                                                                   | `'standard' \| 'hybrid' \| 'satellite' \| 'muted' \| 'mutedStandard'`              | `'standard'`              | NEW in 2.1.0. **(2.1.1, K-3)** `'muted'` is this library's own spelling and is translated to Apple's `'mutedStandard'`, which 2.1.1 also accepts directly. Written to a LIVE map, not only to the constructor (K-4). v6's own enum is the top-level `mapkit.MapType`; `mapkit.Map.MapTypes` still exists and Apple deprecates it.                      |
| `colorScheme`                                                                               | `'light' \| 'dark' \| 'auto'`                                                      | `'auto'`                  | NEW; `'auto'` follows an injected colour-mode ref, never a `MutationObserver` on `<html>`                                                                                                                                                                                                                                                              |
| `ariaLabel`                                                                                 | `string`                                                                           | `'Map'`                   | on the `role="region"` container                                                                                                                                                                                                                                                                                                                       |
| `pinsFocusable`                                                                             | `boolean`                                                                          | `true`                    | **NEW (2.1.1, K-8).** `false` makes every pin host decorative: no `role`, no `tabindex`, no `aria-label`, no `aria-pressed`, and no keyboard or pointer listeners -- and `itemLabel` stops being required. For a map whose pins are a data layer the app selects from a list beside it, a screen reader should not announce N buttons that do nothing. |
| `nonce`                                                                                     | `string \| undefined`                                                              | `useNonce()`              | optional under `strictDynamic: true` (S1 §2.4); pass it anyway so a `strictDynamic: false` app still works                                                                                                                                                                                                                                             |

### c.2 Keyed reconciliation (normative)

```ts
type MapKitDiff = {
  added: string[]
  removed: string[]
  moved: string[]
  restyled: string[]
}
```

1. Initial render of N items is exactly **one** `addAnnotations(array)` call.
2. An `items` change touching k of N keys performs at most k `addAnnotations`
   and k `removeAnnotations`; the other N−k annotation objects keep **the same
   object identity** and their DOM hosts are not replaced.
3. A coordinate change for an existing key updates `annotation.coordinate` **in
   place** — no remove/add.
4. A `selectedId` change performs **zero** adds and **zero** removes: exactly
   the outgoing and incoming glyphs are re-rendered inside hosts that persist,
   so `document.activeElement` survives selection.

### c.3 Per-pin anchor semantics (narduk-libs#305)

```ts
interface MapKitPinGeometry {
  /** Element box in CSS px. Default: measured from the rendered glyph. */
  size?: { width: number; height: number }
  /** Which point of the element sits on the coordinate. Default 'bottom-center'. */
  anchor?: 'center' | 'bottom-center' | 'top-center' | 'top-left'
  /** CSS px added AFTER the anchor is applied. Default { x: 0, y: 0 }. */
  anchorOffset?: { x: number; y: number }
}
```

Semantics: the annotation's coordinate lands on the element's `anchor` point,
then `anchorOffset` shifts it (`+x` right, `+y` down). The library computes
MapKit's `anchorOffset` from `size` + `anchor` + `anchorOffset`; apps never
compute it. `size` is per-pin, so a 170×150 pin and a 16×16 pin in the same map
are both correct. **There is no global `annotationSize` and no hard-coded
`(0, -6)`.**

### c.4 Slots

| Slot        | Scope                                                                                                           | Purpose                                                                                                                                                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#default`  | —                                                                                                               | free content over the map (unchanged)                                                                                                                                                                                                                                            |
| `#loading`  | `{}`                                                                                                            | replaces the built-in "Loading map…"                                                                                                                                                                                                                                             |
| `#error`    | `{ failure: MapKitFailure; retry: () => void }`                                                                 | replaces "Map unavailable". The default UI **never prints the raw error**; it prints the code and a retry button.                                                                                                                                                                |
| `#callout`  | `{ item: T; id: string; position: { x: number; y: number }; placement: 'above' \| 'below'; close: () => void }` | **the buoys#112 surface.** Rendered by the library into a positioned host inside the map container and re-projected on every `region-change`. Content is the app's Vue tree, so Buoys' `StationMapPopover` — `NuxtLink` "View details" and all — moves into this slot unchanged. |
| `#fallback` | `{}`                                                                                                            | shown when `libraries` cannot load at all                                                                                                                                                                                                                                        |

`#callout` is a **callout** seam: one host, scoped to the opened item. It is
**not** the general overlay-host seam (that stays a 2.2 candidate on its own
five-consumer evidence). Opened for `selectedId` by default;
`calloutFollowSelection={false}` hands control to the exposed
`openCallout`/`closeCallout`.

**(2.9.0, narduk-libs#746)** A pin selected from the keyboard moves focus to the
first focusable element in the `#callout` slot once it renders, so a keyboard or
screen-reader user reaches the callout's action without tabbing back through the
page. A pointer selection leaves focus where it is. `calloutFocus="never"` opts
out; the default is `'keyboard'`.

### c.5 Emits

| Event                            | Payload                                        | Change                                                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update:selectedId`              | `string \| null`                               | unchanged                                                                                                                                                                                                                    |
| `update:hoveredId`               | `string \| null`                               | **NEW (narduk-libs#517)**                                                                                                                                                                                                    |
| `leader-offscreen`               | `boolean`                                      | **NEW (narduk-libs#517).** True when the selected pin's screen point is outside the map frame.                                                                                                                               |
| `map-ready`                      | `(map: mapkit.Map, mapkit: MapKitNamespace)`   | **(2.1.1, K-10)** second argument ADDED; the first is unchanged, so every existing handler keeps working. See §g.1 -- this namespace, never `window.mapkit`, is what an escape-hatch consumer must build MapKit values from. |
| `region-change`                  | `{ centerLat; centerLng; latDelta; lngDelta }` | unchanged                                                                                                                                                                                                                    |
| `map-click`                      | `{ lat; lng }`                                 | unchanged                                                                                                                                                                                                                    |
| `feature-select`                 | `GeoJSONFeature`                               | unchanged                                                                                                                                                                                                                    |
| `callout-open` / `callout-close` | `{ id: string; item: T }`                      | retained, now driven by the slot                                                                                                                                                                                             |
| `mapkit-error`                   | `MapKitFailure`                                | NEW                                                                                                                                                                                                                          |
| `fullscreen-change`              | —                                              | **dropped** (zero consumers)                                                                                                                                                                                                 |

### c.6 Expose

`getMap()`, **`getMapKit()` (2.1.1, K-10)**, `setRegion(region, opts?)`,
`zoomToFit(opts?)`, `scrollIntoView()`, `select(id: string \| null)`,
`openCallout(id)`, `closeCallout(id?)`, **`retry(): void`**,
`getDiagnostics(): { annotations: number; lastDiff: MapKitDiff }`.

`getMapKit()` returns the scoped namespace this component's map belongs to, or
`undefined` before the map is ready. It is the template-ref equivalent of
`map-ready`'s second argument, for a consumer that holds a ref rather than
listening for the event. Both were added; neither replaces the other, and adding
an argument to an emit breaks no existing handler, which is why 2.1.1 took that
path over changing `map-ready`'s single payload.

`retry()` exists because **MapKit never re-asks for a token on failure** (S1
§4): it retried `/ma/bootstrap` three times with the _same_ token and gave up.
Recovery is ours — `retry()` drops the singleton and re-initialises.

### c.7 States, errors, SSR, test hooks

```ts
// Apple's own ConfigurationErrorStatus, verbatim (S1 §7). Do not invent an enum.
type MapKitErrorStatus =
  | 'Unauthorized'
  | 'Bad Request'
  | 'Too Many Requests'
  | 'Malformed Response'
  | 'Timeout'
  | 'Network Error'
  | 'Unknown'

interface MapKitFailure {
  source: 'mapkit' | 'token'
  status: MapKitErrorStatus
  message: string
  /** Present for source: 'token'. */
  httpStatus?: number
  /** Parsed from Apple's "Origin does not match - expected: X, actual: Y" suffix. */
  originMismatch?: { expected: string; actual: string }
}
```

Token-route refusals map into Apple's names rather than a parallel enum:
`403 → 'Unauthorized'`, `429 → 'Too Many Requests'`, `503 → 'Unauthorized'`
(unconfigured signer), fetch rejection → `'Network Error'`, non-JSON body →
`'Malformed Response'`. `httpStatus` is what distinguishes them.

`originMismatch` is surfaced because it is the single most useful string for a
misconfigured preview (S1 §5.4).

**SSR**: with `ssrPreload`, the module emits `renderHTMLAttributes()` through
`useHead({ script: [...] })` so `mapkit.core.js` downloads before hydration.
Emitted **without `token`** — a token there re-introduces the static,
non-refreshable path. `load()` adopts the existing tag (it dedupes on
`[data-callback="initMapKitLoaderV2"]`). The `useHead` call runs on the server
only: on the client a second owner of the same tag (unhead's renderer) cannot
recognise the server's element once the browser hides its CSP nonce, and
appended a second `mapkit.core.js` through 2.1.2 (narduk-libs#469). Nothing
renders a map during SSR; the container is SSR'd empty with its `role="region"`
and label.

The component initialises once both MapKit JS is ready and its container is
mounted.

**Test hooks**: `data-mapkit-state="loading|ready|error"`,
`data-mapkit-pin="<id>"`, `data-mapkit-selected`, `data-mapkit-callout="<id>"`.

**Accessibility**: the library owns a focusable pin host (`role="button"`,
`tabindex="0"`, `aria-label` from `itemLabel`, `aria-pressed`, Enter/Space).
Apps own the glyph only. Container is `role="region"` with `ariaLabel`.
`prefers-reduced-motion` turns animated region changes into jumps.

### c.8 The shipped stylesheet (2.1.1, K-6)

2.1.0 named `.mapkit-wrapper`, `.mapkit-canvas` and `.mapkit-status` as the
component's DOM contract and shipped **no CSS for them**, so an adopting app had
to write the host chrome itself -- position, overflow, and the 100% sizing a
MapKit canvas needs -- or get a zero-height map. Buoys' own
`assets/css/mapkit.css` carries exactly those rules, prefixed `.mk-root` to win
a specificity contest against nothing.

2.1.1 ships them. `dist/` is built by plain `tsc`, which emits no `.css`, so the
stylesheet is a TypeScript string (`nuxt/runtime/styles.ts`, exported as
`MAPKIT_COMPONENT_CSS`) written out by `addTemplate` and **unshifted** onto
`nuxt.options.css`. Registered only when `component: true`.

Two rules make it safe to override, and both are tested:

1. **Every selector is a single class** (`.mapkit-status > *` is the one
   descendant). No `!important`, no id, no chained classes. An app's own
   single-class rule therefore wins on source order.
2. **It is first in `nuxt.options.css`**, so an app stylesheet -- registered in
   `nuxt.config`, imported in a layout, or scoped in a component -- comes after
   it and wins.

It is **layout only**: no colour, font, radius, shadow, or transition. A theme
the app cannot see is worse than no theme, and the host chrome is the part every
consumer had to duplicate.

---

## d. Loader and refresh contract (S1 §3/§4 — normative)

```ts
const mk = await load({ nonce, language, libraries, version: '6' }) // NO token
await new Promise<void>((resolve, reject) => {
  mk.addEventListener('configuration-change', (e) => {
    if (e.status === 'Initialized') resolve() // 'Refreshed' fires on later exchanges
  })
  mk.addEventListener('error', (e) => {
    started = undefined
    reject(new MapKitAuthError(e.status, e.message))
  })
  mk.init({
    authorizationCallback: (done) =>
      fetch(endpoint, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => done(j.token)),
  })
})
```

1. **`load()` is called WITHOUT `token`.** PLAN §4.3's `load({ token, ... })` is
   the bug: it puts the token in `data-token` on the injected script and wires
   MapKit's static, non-refreshable path, making the refresh promise impossible.
   (S1 §7)
2. **`libraries` is mandatory in v6** — hence the required prop.
3. The token arrives only through `mapkit.init({ authorizationCallback })`. The
   callback fetches the **relative** endpoint, so the request always goes to the
   serving origin. The token is never persisted, never logged, never put in a
   URL.
4. **MapKit never re-asks on failure — the library owns recovery.** Measured: on
   a rejected token MapKit retried `/ma/bootstrap` 3× with the same token,
   called the callback exactly once, and gave up. On JWT expiry with an idle map
   (45 s token, 2 min) and on 401s to data requests, `tokenCalls` stayed 1. So
   `initializeMapKit` clears its singleton in the `error` handler, and
   `<AppMapKit>` exposes `retry()`.
5. `initializeMapKit()` keeps its name and singleton contract (four call sites).
6. Error enum is Apple's `ConfigurationErrorStatus` **verbatim** (§c.7).
7. Types come from `@types/apple-mapkit ^6`, transitively via the loader.
   `declare const mapkit: any` and every app-local `MapKitGlobal` go.
8. **CSP: no change needed anywhere.** narduk-core's shipped preset ran v6 with
   zero violations in Chromium and WebKit, 600 annotations, hybrid + 3D camera.
   `'wasm-unsafe-eval'` is **not** needed; zero WebAssembly calls, no `.wasm`
   asset. The narduk-core CSP contribution point is descoped to 2.2
   (narduk-libs#410). Bounded: see §i.

---

## e. Token route contract

`GET {tokenRoutePath}`, same-host, fail-closed.

### e.1 Request rules

1. `self` = `new URL(getRequestURL(event, { xForwardedHost: false })).origin` —
   scheme + host + port of the request **as routed**. Never from `Origin`,
   `Referer`, or any `X-Forwarded-*` header. On Workers the routed hostname
   cannot be forged.
2. Same-origin evidence, required, in order:
   - `Sec-Fetch-Site` present ⇒ must equal `same-origin` (`same-site`,
     `cross-site`, `none` refused);
   - absent ⇒ `Origin`, if present, must equal `self`; else `Referer`'s origin
     must equal `self`; else refuse.
   - In every case, an `Origin` present and **≠ `self`** refuses.
3. **A missing `Origin` is legitimate.** Measured in real Chromium (S1 §2.5): a
   same-origin `fetch()` sends _no_ `Origin` at all and
   `Sec-Fetch-Site: same-origin`. Rejecting missing-`Origin` requests would
   reject every legitimate call.
4. `GET` only. `OPTIONS`/`POST`/… → 405. **No `Access-Control-Allow-Origin` is
   ever emitted**, on any response.

### e.2 Response

| Case                       | Status | Body                                   | Headers                                                   |
| -------------------------- | ------ | -------------------------------------- | --------------------------------------------------------- |
| success                    | `200`  | `{ token: string; expiresAt: number }` | `cache-control: no-store`, `vary: origin, sec-fetch-site` |
| signing config absent      | `503`  | `{ error: 'unconfigured' }`            | same                                                      |
| cross-origin / no evidence | `403`  | `{ error: 'not-same-origin' }`         | same                                                      |
| rate limited               | `429`  | `{ error: 'rate-limited' }`            | same + `retry-after`                                      |
| wrong method               | `405`  | `{ error: 'method-not-allowed' }`      | same + `allow: GET`                                       |

No "quiet 200". `403` bodies explain the refusal in prose for the human who
opened the URL in a tab (`Sec-Fetch-Site: none`).

### e.3 Claims

`iss` = team id, `kid` = key id (header), `iat`, `exp = iat + 1800`,
`origin = self`, `scope = 'mapkit_js'`.

**Apple enforces `origin` exactly** — proven (S1 §5): a token for
`http://localhost:4501` used on `http://127.0.0.1:4502` gets `401` ×3 plus
_"Origin does not match - expected: …, actual: …"_; a port mismatch alone fails;
a token with **no** `origin` claim works anywhere, which is why the claim is
required and never defaulted. Build it from `URL.origin` semantics so default
ports are omitted on `https:`.

**Say the TTL accurately** (S1 §7): Apple issues a **1800 s accessKey at
`/ma/bootstrap` independent of the JWT's `exp`** — a 45 s JWT still bought a
1800 s accessKey. `exp` bounds the _minting_ window, not the _usage_ window, so
a token leaked at minute 29 can still buy a fresh session: worst case ≈60
minutes. Still a large win over the 24 h of `DEFAULT_MAPKIT_TOKEN_TTL_SECONDS`
today.

### e.4 Rate limit, cache, logging

- **No rate limit by default** (narduk-libs#485, superseding the 30 requests /
  60 s default #436 shipped). An app opts in with the module's `rateLimit`
  option or by mounting its own limiter on
  `event.context.nardukMapKit.rateLimit`, which wins.
- In-isolate signed-token cache keyed by `self`, reused until 5 minutes before
  expiry, **capped at 32 entries** (today the key is caller-supplied, so the
  cache is unbounded).
- **Logged**: the refusal reason, the HTTP status, `self`, and whether a
  deprecated key was present by NAME. **Never logged**: the token, any JWT
  fragment, `APPLE_PRIVATE_KEY`, or any header value carrying credentials.

### e.5 Prerequisite: narduk-core's canonical-host redirect (narduk-libs#408)

`00-canonical-host.ts` has **no `/api` exemption** and 308s every GET. Measured
end-to-end: the page's `fetch` is 308'd cross-origin, the browser blocks it for
want of `Access-Control-Allow-Origin`, `Failed to fetch`, **the map never loads
— and the canonical host still minted a token**, burning an Apple mint and a
rate-limit slot per preview page-load. This is a **prerequisite of the design,
not a trap**: S4's preview-host test is **expected RED until narduk-libs#408
lands** (guard: `Sec-Fetch-Dest !== 'document' ⇒ return`). Another lane owns
#408.

---

## f. Performance budgets (testable, in the fake unless stated)

Baselines measured on phantom-192 (Mac15,10, headless Chromium 1243 +
SwiftShader), MapKit 6.0.128.

| Budget                                               | Bar                                                                                                                                          | Source    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `addAnnotations(600)` against real MapKit            | **≤ 90 ms** (measured 66–86 ms over 7 runs)                                                                                                  | S1 §1 Q-B |
| Init, `import` → `configuration-change: Initialized` | **≤ 500 ms** (measured 262–448 ms)                                                                                                           | S1 §1 Q-B |
| Selection change, 600 pins                           | **0** added, **0** removed, exactly **2** glyphs re-rendered, **0** hosts replaced, `document.activeElement` unchanged                       | §c.2.4    |
| `items` diff of 1 pin in 600                         | ≤ 1 add, ≤ 1 remove; the other **599 annotation objects keep identity** and their hosts are not touched                                      | §c.2.2    |
| Coordinate change of 1 pin                           | 0 adds, 0 removes, 1 in-place `coordinate` write                                                                                             | §c.2.3    |
| Initial load of N pins                               | exactly **1** `addAnnotations` call                                                                                                          | §c.2.1    |
| Keyboard                                             | every pin Tab-reachable; Enter/Space selects                                                                                                 | §c.7      |
| axe on the harness page                              | 0 violations                                                                                                                                 | PLAN §4.9 |
| Client JS                                            | `size-limit` entry for the component chunk and for `import { initializeMapKit }` alone; within **+10%** of the 2.0.5 baseline recorded in S5 | PLAN §4.9 |
| Network                                              | zero requests to `cdn.apple-mapkit.com` from a page that renders no map                                                                      | PLAN §4.9 |
| Error states                                         | every `MapKitFailure.status` reachable, rendered through `#error`, `retry()` works                                                           | §c.7      |
| Token                                                | every rule in §e                                                                                                                             | §e        |

---

## g. `./testing` — the fake MapKit surface

**2.1.1 rewrote this section.** What 2.1.0 specified here (`installMapKitFake()`
returning a `MapKitFake` with `calls`, `annotations()`, `failNextToken()`,
`rejectToken()`, `expireAccessKey()`, `uninstall()`) was never implemented under
those names, and an adopting app that coded against it found nothing to import
(K-2). Below is the surface that actually ships. The exhaustive reference is the
package README, "Testing: the MapKit fake".

Typed against `@types/apple-mapkit`, deterministic Web-Mercator projection, no
network path to Apple. Route **only** `cdn.apple-mapkit.com` — the sole Apple
host MapKit contacted in every S1 scenario.

```ts
// @narduk-enterprises/narduk-mapkit/testing
export function createFakeMapKit(options?: FakeMapKitOptions): FakeMapKitHandle
export function installFakeMapKit(
  options?: FakeMapKitOptions,
): FakeMapKitHandle & { uninstall: () => void }
export function fakeMapKitInitScript(options?: FakeMapKitOptions): string
export function isFakeMapKitNotImplemented(value: unknown): boolean

export interface FakeMapKitHandle {
  /** The namespace `install()` publishes as `globalThis.mapkit`. */
  readonly mapkit: FakeMapKitNamespace
  /** Shaped like `@apple/mapkit-loader`'s `load`. Resolves to the SCOPED namespace. */
  load(options?: FakeMapKitLoadOptions): Promise<FakeMapKitNamespace>
  /** Test-only; unreachable from `mapkit`. */
  readonly inspect: FakeMapKitInspector
  install(target?: Record<string, unknown>): () => void
}
```

`inspect` carries `operations`, `count(name)`, `annotationsAdded` /
`annotationsRemoved`, `annotationCounts(id)`, `maps`, `tokens`, `tokenCalls`,
`bootstrapAttempts`, `configurationChanges`, `errors`, `now`,
`advanceClock(ms)`, `selectAnnotation` / `deselectAnnotation`,
`calloutElement(a)`, `degenerateCameraInputs` and `reset()`. Scripted failure is
`options.auth` (`mode: 'accept' | 'error' | 'wrong-origin'`, `status`,
`bootstrapAttempts`, `accessKeyTtlSeconds`, `onAccessKeyExpiry`), not a method
on the handle — a mode chosen at construction cannot be forgotten halfway
through a test.

### g.1 `window.mapkit` is NOT the namespace your map belongs to

MapKit JS 6 resolves `mapkit.load(libraries)` to a **scoped namespace object
that is not `window.mapkit`**, and an `Annotation`, `Coordinate`, `MapRect` or
`MapType` value built from the global one fails your map's own checks with
`Map.addAnnotations expected an annotation at index 0, but got [object EventTarget]`.
Build every MapKit value from the namespace `<AppMapKit>` hands you —
`map-ready`'s second argument, the component ref's `getMapKit()`, or
`useMapKit().mapkit` — and never from `globalThis.mapkit`.

Measured on a live preview against MapKit JS 6.0.128 on 2026-09-17:
`globalThis.mapkit.maps.length === 0` while a kit map was on screen. The fake
models this from 2.1.1 (K-10): `handle.load()` resolves to a namespace distinct
from `handle.mapkit`, each namespace's `maps` lists only its own, and a foreign
value is refused in Apple's own message shape. 2.1.0's fake resolved `load()` to
the very object it published as `window.mapkit`, so both were one object under
test and 62 green end-to-end tests shipped a blank map.

### g.2 The fidelity rule, and what it means for a missing default

Reading or writing any member the fake does not model throws
`FakeMapKitNotImplemented: <member>`. The same rule covers a member it models
but nothing has set: `map.mapType` on a map built without one throws rather than
answering a guess, because Apple documents no default. Where real MapKit's
behaviour is unknown, the fake says so instead of inventing it — a degenerate
camera (a `MapRect` with no positive extent, or padding with no room left in the
container) is applied AND recorded on `inspect.degenerateCameraInputs`.

Must model: `mapkit.load(libraries)` returning a scoped namespace;
`configuration-change` with `status: 'Initialized' | 'Refreshed'`; `error`
carrying `MapKitConfigurationErrorEvent { status, message }`; the
origin-mismatch message suffix; annotation add/remove/coordinate-write
recording; the rect camera; a second `init()` after a failed exchange, and an
idempotent no-op for any other second `init()` (narduk-libs#522).

Real Apple is a **reported post-deploy smoke, never a required gate**.
narduk-testkit gets only a thin Playwright fixture that routes
`cdn.apple-mapkit.com` and the token endpoint at the fake; the fake itself ships
here.

---

## h. Slice map for parallel execution

| Slice                               | Starts                      | Inputs                        | Files owned                                                                                                                          | Done when                                                                                                                                                                                                                                                                                                                                                    | Review                    |
| ----------------------------------- | --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| **S3 — fake**                       | **now**, ∥ S4               | §g; S1 §7 addendum            | `narduk-mapkit/src/testing/**`, its tests, `narduk-testkit/src/playwright/mapkit-fixture.ts`                                         | conformance suite for every member the library calls; **3 RED tests committed as expected-fail** against the 2.0.x component: rebuild-on-selection (600 removes), anchor for a 170×150 pin, pin host not keyboard-reachable; runs with no network path to Apple                                                                                              | T1                        |
| **S4 — loader, types, token route** | **now**, ∥ S3               | §d, §e; S1 §3/§5/§2.5         | `narduk-mapkit/src/client/mapkit.ts`, `client/layers.ts`, `client/temporal.ts`, `client/scaling.ts`, `src/token/**`, `src/server/**` | `load()` per §d; zero `any`-typed `mapkit`; `rg "Map\.(MapTypes\|ColorSchemes)\|Annotation\.(CollisionMode\|DisplayPriority)"` empty in `src/`; null/undefined tolerance test (the gonogo case); crossfade on one clock; overlay ordering (narduk-libs#402); every rule in §e. **Preview-host test expected RED until #408 lands.** No narduk-core CSP work. | **T2** on the token route |
| **S5 — `<AppMapKit>` at `./nuxt`**  | when §c is merged (now)     | §b, §c, §f                    | `narduk-mapkit/src/nuxt/**` (module + runtime), `package.json` exports                                                               | S3's three RED tests green; every budget in §f passes in CI; surface matches §c; a plain-TS test drives the same controllers the component uses; `showsPointsOfInterest` flip confirmed against riverstatus                                                                                                                                                  | **T2**                    |
| **S6 — Buoys candidate**            | after S5                    | packed tarball of the S5 head | buoys draft branch only                                                                                                              | deleted: `buildStableMapItems`, `focusSelectedCalloutAction`, local `MapKitGlobal`, raw `window.mapkit` reads, a11y plumbing in `mapMarkers.ts`, `MAPKIT_ALLOWED_ORIGINS`; `StationMapPopover` moved into `#callout`; **buoys#112 reproduced at 390×844 with 570 pins on the fake, then 50/50 green**; map e2e on the fake with no skip path                 | T1                        |
| **DEP — Dependabot ignore**         | **now**, independent        | §a.1                          | `hydrogen/.github/dependabot.yml`, `gonogo/.github/dependabot.yml`                                                                   | `ignore` for `@narduk-enterprises/narduk-mapkit` `>=2.1.0` merged in **both**, **before** 2.1.0 publishes                                                                                                                                                                                                                                                    | T0                        |
| **S7 — release 2.1.0**              | after S6 green + DEP merged | —                             | `.changeset/*`, `narduk-mapkit/package.json`                                                                                         | one minor changeset carrying §a.2 verbatim; metadata `homepage`/`bugs` point at narduk-libs; 2.1.0 is `latest`; packed-consumer gate installs and builds `./nuxt`; the Release run's verified SHA equalled `origin/main` at publish; `narduk-mapkit-nuxt` README gains a pointer and **no new version**                                                      | T0                        |

S3 and S4 share no files. S5 owns `src/nuxt/**` alone. S6 touches no narduk-libs
file.

---

## i. Open / unverified — do not report these as answered

Copied from S1 §10 and §2.3. Every item below is an unknown, not a decision.

1. **PENDING**: whether `authorizationCallback` fires a second time at the ~1800
   s accessKey expiry, and whether `configuration-change: 'Refreshed'`
   accompanies it. A 35-minute run was killed at ~12 minutes and produced no
   result. Recipe:
   `SPIKE_SHORT_TTL=300 SPIKE_WAIT_MS=2100000 … node run.mjs refreshLong` (~31
   min, re-runnable). **If it comes back `tokenCalls: 1`, MapKit never renews on
   its own and the library must schedule its own re-init before 1800 s — S4 must
   not assume the positive.** Cheaper substitute: assert it against the fake's
   controllable accessKey clock (§g).
2. `'wasm-unsafe-eval'` not needed **for what was measured**: MapKit 6.0.128,
   libraries `map`/`annotations`/`overlays`, `standard` + `hybrid`, a 3D camera,
   headless Chromium/SwiftShader and WebKit. **Not** covered: Flyover, Look
   Around, `services`, `geocoder`, `directions`, `user-location`, a future
   MapKit version, a real GPU. Read as "not required today". Buoys' report-only
   soak is what turns it into a standing claim.
3. `https://*.apple.com` in `connect-src` was never contacted; which library
   needs it is unknown.
4. `upgrade-insecure-requests` could not be exercised on an `http:` fixture.
5. **HTTPS was never used.** Every origin in the spike was `http://localhost` /
   `http://127.0.0.1`. Apple accepted `http:` origins in the claim; `https:`
   with a default port (no `:443` in the claim) is **unverified**. S4 must build
   the claim from `URL.origin`, which omits default ports.
6. Only Chromium 1243 and WebKit (Playwright 2359) were tested — no Firefox, no
   real Safari, no mobile Safari. buoys#112 is a **mobile Safari** defect, so
   §c.2's fix is a hypothesis until S6 reproduces and clears it on the fake at
   390×844 and the real-Apple smoke.
7. `showsPointsOfInterest`'s default flip rests on five observed `false` values
   plus riverstatus, whose value the sweep did not record. Confirm before
   landing.
8. The counting method behind "zero consumers" is a `git grep` of 15 cloned
   repos on `origin/main`. It does not see private forks, unpushed branches, or
   repos not cloned locally.

**Added by 2.1.1:**

9. **What real MapKit does with a degenerate camera is not established.** Apple
   documents neither `visibleMapRect`'s behaviour for a `MapRect` with a
   non-positive `width`/`height`, nor `padding`'s behaviour when the insets
   leave no room in the container. Buoys saw the real map zoom out to a
   continent on the phone when selection maths produced one of these, but that
   is one observation of one input, not a documented rule. The fake therefore
   **applies the input and records it** on `inspect.degenerateCameraInputs`
   rather than clamping, throwing, or pretending to know: a test can assert its
   own maths never produces one, which is the assertion that would have caught
   the Buoys defect. Establishing the real rule needs a live probe, and until it
   runs, nothing here may be reported as Apple's behaviour.
10. **K-9 is enforced at runtime only.** `itemLabel` being required when `items`
    is non-empty and `pinsFocusable` is not `false` throws from `setup` with a
    named message. The type-level version -- a discriminated `$props` union that
    makes the omission a compile error -- was NOT built: a union `$props` on a
    generic `defineComponent` construct signature could not be proven safe under
    `vue-tsc` from inside this package, and a wrong one would break every
    consumer's build. It stays a 2.2 candidate.
11. **The fake's namespace brand is a symbol, not a class family.** Foreign
    values are refused by a branded-identity check, so a cross-namespace
    `instanceof` still passes in the fake where real MapKit's would fail. The
    counting method behind "nothing branches on `instanceof`" is a `git grep` of
    this package and of the one adopting app checked out locally (Buoys) -- it
    does not see the other six consumers. The rejection, not its mechanism, is
    what a test asserts; a consumer that does branch on `instanceof` is outside
    what the fake models.
