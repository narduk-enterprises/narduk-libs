# @narduk-enterprises/narduk-mapkit-nuxt

Nuxt integration for `@narduk-enterprises/narduk-mapkit`. It adds the
`AppMapKit` and `AppMapKitCallout` components, `useMapKit`, `useMapKitCallouts`,
`useMapkitToken`, and a Worker-compatible `GET /api/mapkit-token` route.

## Install

```sh
pnpm add @narduk-enterprises/narduk-mapkit @narduk-enterprises/narduk-mapkit-nuxt
```

```ts
export default defineNuxtConfig({
  modules: ['@narduk-enterprises/narduk-mapkit-nuxt'],
})
```

The component fills its parent, so the parent must have an explicit height:

```vue
<template>
  <div style="height: 420px">
    <AppMapKit :items="stations" :create-pin-element="createPin" />
  </div>
</template>
```

## `AppMapKit`

Supports two rendering modes, which can be combined: pin annotations (`items`
and `createPinElement`) and GeoJSON polygon/line overlays (`geojson`, optional
`overlayStyleFn`). It also owns MapKit JS loading (`useMapKit`), bounding region
calculation, zoom behavior, dark-mode sync, and cleanup on unmount. Fullscreen
and callouts are separate opt-in sections below.

### Props

| Prop                     | Default                       | Purpose                                                                                              |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `items`                  | `[]`                          | Pin annotation items (`{ id, lat, lng, ... }`). Optional when using `geojson`-only mode.             |
| `createPinElement`       | --                            | `(item, isSelected) => { element, cleanup? }`. Required for pins to render at all.                   |
| `selectedId` (`v-model`) | `null`                        | Bidirectional selection. Selecting zooms to the item and rebuilds pins; clearing zooms out.          |
| `annotationSize`         | `{ width: 100, height: 56 }`  | Pin annotation size in pixels.                                                                       |
| `geojson`                | `null`                        | A `FeatureCollection` with `Polygon`/`MultiPolygon`/`LineString` features, rendered as overlays.     |
| `overlayStyleFn`         | --                            | `(properties) => OverlayStyle` per GeoJSON feature; otherwise a themed default style is used.        |
| `circles`                | `[]`                          | Lightweight circle overlays: `{ lat, lng, radius, color, opacity? }`, for large point clouds.        |
| `dynamicCircleRadius`    | `false`                       | When `true`, circle radii scale with zoom (`minCircleRadius`/`maxCircleRadius`/`circleScaleFactor`). |
| `clusteringIdentifier`   | --                            | When set, nearby pins merge into cluster bubbles at low zoom. Pair with `createClusterElement`.      |
| `centerLabel`            | --                            | Text label rendered at the center of the GeoJSON features.                                           |
| `fallbackCenter`         | --                            | `{ lat, lng }` region shown when there are no items, GeoJSON, or circles to bound.                   |
| `boundingPadding`        | `0.05`                        | Fractional padding added around the computed bounding region.                                        |
| `minSpanDelta`           | `0`                           | Minimum span in degrees, so a small area still shows context.                                        |
| `zoomSpan`               | `{ lat: 0.002, lng: 0.0025 }` | Span used when zooming to a selected item.                                                           |
| `preserveRegion`         | `false`                       | Keep the current map region when `items` change instead of auto-zooming to fit.                      |
| `suppressSelectionZoom`  | `false`                       | When `true`, a selection change only rebuilds pins; the parent controls the camera.                  |
| `isZoomEnabled`          | `true`                        | Also toggles the visible zoom control.                                                               |
| `isScrollEnabled`        | `true`                        | Pan interaction. Set both this and `isZoomEnabled` to `false` for a static/display-only map.         |
| `isRotationEnabled`      | `false`                       | Only takes effect when the client supports rotation.                                                 |
| `showsPointsOfInterest`  | `true`                        | When `false`, hides POI labels and switches to MapKit's muted map type.                              |

### Events

| Event                            | Payload                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| `map-ready`                      | The underlying `mapkit.Map` instance, once constructed.                 |
| `map-click`                      | `{ lat, lng }` — the map background was clicked (not a pin/overlay).    |
| `region-change`                  | `{ centerLat, centerLng, latDelta, lngDelta }` on zoom/pan.             |
| `feature-select`                 | The clicked GeoJSON `Feature`, when a polygon/line overlay is selected. |
| `fullscreen-change`              | See [Fullscreen](#fullscreen).                                          |
| `callout-open` / `callout-close` | See [Callouts](#callouts).                                              |

### Slots

| Slot      | Scope | Purpose                                                                                                                                            |
| --------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` | --    | Overlay chrome inside the map wrapper, typically `<AppMapKitCallout>`. A sibling of the canvas; callout contents teleport into MapKit-owned hosts. |

### Exposed methods

A template ref exposes `scrollIntoView()`, `setRegion(center, span?)`,
`zoomToFit(zoomOutLevels?)`, and `getMap()` (the raw `mapkit.Map`), plus the
fullscreen and callout methods documented in their own sections below.

### Example

```vue
<script setup lang="ts">
interface Station {
  id: string
  lat: number
  lng: number
  name: string
}

const stations = ref<Station[]>([
  { id: '1', lat: 37.7749, lng: -122.4194, name: 'Station 1' },
])
const selectedId = ref<string | null>(null)

function createPin(item: Station, isSelected: boolean) {
  const element = document.createElement('div')
  element.className = isSelected ? 'pin pin--selected' : 'pin'
  element.textContent = item.name
  return { element }
}
</script>

<template>
  <div style="height: 420px">
    <AppMapKit
      v-model:selected-id="selectedId"
      :items="stations"
      :create-pin-element="createPin"
      @map-click="(coords) => console.log('clicked', coords)"
    />
  </div>
</template>
```

NE Base `data-design-card` entries for `AppMapKit` and `AppMapKitCallout` are
deferred until the card mechanism in
[#250](https://github.com/narduk-enterprises/narduk-libs/issues/250) lands.

## Fullscreen

Off by default. Opt in with `fullscreen-control`, and the component renders a
small toggle over the map:

```vue
<AppMapKit
  :items="stations"
  :create-pin-element="createPin"
  fullscreen-control
  fullscreen-mode="viewport"
  @fullscreen-change="(event) => (isFullscreen = event.active)"
/>
```

`fullscreenMode` is `'viewport'` (the default -- a fixed overlay filling the
browser viewport, which works everywhere) or `'fullscreen'` (the Fullscreen API,
falling back to viewport where it is unavailable, with `event.fallback` set).

The component presents its own wrapper, so the map's status overlay and the
toggle come along, and it refreshes MapKit geometry on every change. A template
ref also exposes `enterFullscreen()`, `exitFullscreen()`, `toggleFullscreen()`,
and an `isFullscreen` ref.

Viewport mode positions with `position: fixed`, so no ancestor of the component
may set `transform`, `filter`, `backdrop-filter`, `perspective`, or
`contain: paint` -- any of those becomes the containing block and traps the map
inside it.

## Callouts

Off by default. Opt in with `callouts`, then write the callout's contents as a
slot on `<AppMapKitCallout>` inside the map:

```vue
<script setup lang="ts">
const selectedId = ref<string | null>(null)
</script>

<template>
  <div style="height: 420px">
    <AppMapKit
      v-model:selected-id="selectedId"
      :items="stations"
      :create-pin-element="createPin"
      callouts
    >
      <AppMapKitCallout :items="stations" v-slot="{ item, close }">
        <UCard>
          <template #header>{{ item.name }}</template>
          {{ item.reading }}
          <UButton size="xs" @click="close">Close</UButton>
        </UCard>
      </AppMapKitCallout>
    </AppMapKit>
  </div>
</template>
```

Selecting a pin opens its callout, and dismissing a callout clears the
selection, so the two never disagree. Set `callout-follow-selection="false"` to
drive callouts entirely from the exposed methods instead.

### Nuxt UI inside a callout

The slot is moved into the callout's host element with a `<Teleport>`, not
mounted as a second Vue app, so the content keeps its place in the component
tree. That is what makes Nuxt UI work: `UCard`, `UButton`, `UModal`, and the
rest read their configuration from `<UApp>` through `provide`/`inject`, which a
second app would not see. `useNuxtApp()`, the color mode, route state, and
ordinary reactivity all reach the slot for the same reason.

`:items` on `<AppMapKitCallout>` is optional and never read at runtime; it is
the type witness that lets TypeScript infer the slot's `item`, which a child
cannot pick up from its parent's generic.

### `AppMapKitCallout` slots

| Slot      | Scope                         | Purpose                                                                                 |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `default` | `{ item, close, calloutKey }` | Callout body. `calloutKey` rather than `key`, which Vue reserves on a `<slot>` element. |

### Props, events, and methods

| Prop                     | Default    | Purpose                                                                                                                                                                                                                                                  |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `callouts`               | `false`    | Opt in. Nothing is constructed until it is `true`.                                                                                                                                                                                                       |
| `calloutMode`            | `'single'` | `'multi'` keeps every open callout open.                                                                                                                                                                                                                 |
| `calloutPlacement`       | `'above'`  | Preferred side; flips when cramped.                                                                                                                                                                                                                      |
| `calloutAnchorOffset`    | derived    | Pixels added to the projected anchor. Defaults to clearing the pin, from `annotationSize`.                                                                                                                                                               |
| `calloutFollowSelection` | `true`     | Bind callouts to `selectedId` in both directions.                                                                                                                                                                                                        |
| `calloutOptions`         | --         | The rest of the controller's options: `gap`, `edgePadding`, `flip`, `caretSize`, `closeOnEscape`, `closeOnMapClick`, `closeOnPan`, `closeOnDeselect`, `focusOnOpen`, `restoreFocus`, `role`, `ariaLabel`, `zIndex`, `hideOffscreen`, `keyForAnnotation`. |

Events: `callout-open` (also fired when an open callout is re-opened with new
data) and `callout-close`. Both carry `{ item, key, phase, reason }`.

A template ref exposes `openCallout(key)`, `closeCallout(key)`,
`closeCallouts()`, and `getCalloutController()`. Inside the map's own subtree,
`useMapKitCallouts()` returns the same controls plus the reactive `entries`
list, for a legend row or a keyboard shortcut that opens a callout.

### Styling

The component styles only the caret and leaves the callout's surface to the slot
content, so a `UCard` is not stacked on a second background. Match the caret to
that surface with custom properties on the map or any ancestor:

```css
.map-wrapper {
  --mapkit-callout-caret-background: var(--ui-bg);
  --mapkit-callout-caret-border: var(--ui-border);
  --mapkit-callout-caret-size: 10px;
  --mapkit-callout-max-width: 22rem;
}
```

## Token route

Runtime names accepted by the token route:

- `APPLE_PRIVATE_KEY` or `APPLE_SECRET_KEY`
- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `MAPKIT_ALLOWED_ORIGINS`
- `APPLE_MAPKIT_TOKEN` or `MAPKIT_TOKEN`

Cloudflare bindings are read from the request-scoped Nitro context. Nuxt
runtime-config equivalents (`applePrivateKey`, `appleSecretKey`, `appleTeamId`,
`appleKeyId`, `mapkitAllowedOrigins`, and `public.mapkitToken`) are supported as
fallbacks. Missing credentials return `503` with `{ configured: false }`. The
generated endpoint accepts GET only; other methods return `405` with
`Allow: GET`.

Provider-specific rate limiting remains app-owned. A server middleware can set
the request-scoped hook before the package route runs:

```ts
export default defineEventHandler((event) => {
  event.context.nardukMapKit = {
    rateLimit: async ({ origin }) => {
      const allowed = await consumeAppRateLimit(origin)
      return allowed
        ? { allowed: true }
        : { allowed: false, retryAfterSeconds: 60 }
    },
  }
})
```

The hook is optional so apps can instead enforce Cloudflare rate-limiting rules
at the edge. A denied hook response is `429` and may include `Retry-After`.

## Options

```ts
export default defineNuxtConfig({
  nardukMapKit: {
    component: true,
    composables: true,
    tokenRoute: true,
    tokenRoutePath: '/api/mapkit-token',
  },
})
```

Disable `tokenRoute` when the app provides its own endpoint. Override
`public.mapkitTokenEndpoint` when composables should call a different route.
