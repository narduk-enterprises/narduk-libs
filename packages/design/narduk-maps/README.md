# narduk-maps

One map picture, drawn by two engines. `NardukGeoMap` is an SSR-identical SVG
map. `NardukMap` mounts MapLibre over the same picture and fades in once it is
idle. Both share one Web Mercator projection, one set of tokens and one set of
mark shapes, so the poster and the live map line up pixel for pixel.

**npm package:** `@narduk-enterprises/narduk-maps` (GitHub Packages, not public
npm). The look is specified in [docs/DESIGN.md](./docs/DESIGN.md).

## Install

```bash
npm install @narduk-enterprises/narduk-maps
# only if you use the `./gl` entry:
npm install maplibre-gl@^5
```

`maplibre-gl` is an optional peer dependency. It is external to every build
output here and is only ever loaded with a dynamic `import('maplibre-gl')` from
`./gl`.

## Entries

| Import                                      | What it gives you                                                          | Imports maplibre-gl |
| ------------------------------------------- | -------------------------------------------------------------------------- | ------------------- |
| `@narduk-enterprises/narduk-maps`           | `NardukGeoMap`, projection and label utils, mark helpers, tokens, types    | never               |
| `@narduk-enterprises/narduk-maps/svg`       | the same as `.`                                                            | never               |
| `@narduk-enterprises/narduk-maps/style`     | `createBasemapStyle(tokens, options)`: OpenFreeMap style JSON as pure data | never               |
| `@narduk-enterprises/narduk-maps/gl`        | `NardukMap`                                                                | dynamic import only |
| `@narduk-enterprises/narduk-maps/style.css` | tokens and component CSS (import once)                                     | no                  |

`src/dist.test.ts` builds the package and proves the `.`, `./svg` and `./style`
outputs (and everything they import) never mention `maplibre`.

## SVG map

```vue
<script setup lang="ts">
import { NardukGeoMap } from '@narduk-enterprises/narduk-maps'
import '@narduk-enterprises/narduk-maps/style.css'
</script>

<template>
  <NardukGeoMap
    :shapes="towns"
    id-key="name"
    :points="points"
    highlight="W-02"
    aria-label="Coastal resilience actions"
    @select="onSelect"
  />
</template>
```

| Prop            | Meaning                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `shapes`        | GeoJSON FeatureCollection of Polygon or MultiPolygon features                                                          |
| `idKey`         | feature property holding the id (default `id`); `nameKey` the name (default `name`)                                    |
| `fills`         | `Record<id, css colour>` or a function of the feature; default `--color-map-land`                                      |
| `hatch`         | `Record<id, boolean>`: an SVG hatch pattern meaning "no data"                                                          |
| `water`         | paint the sea and the shoreline halo (default true)                                                                    |
| `points`        | `{ id, lon, lat, color, shape, href?, label }`, shape one of `dot`, `ring`, `core`, `small`, `hollow`                  |
| `highlight`     | a point id, drawn larger and on top                                                                                    |
| `selected`      | a shape id, outlined                                                                                                   |
| `interactive`   | shapes become keyboard-focusable buttons that emit `select(id)`                                                        |
| `plain`         | print mode: no tab stops, `levelText[id]` drawn under each name                                                        |
| `labels`        | `'shapes'` (default), `'none'`, or `{ text, lon, lat }[]`                                                              |
| `width`         | viewBox width (default 520); the height follows the bounds                                                             |
| `padding`       | frame padding (number or per side), same meaning as MapLibre's `fitBounds` padding                                     |
| `bounds`        | `[w, s, e, n]` overriding the fit                                                                                      |
| `basemap`       | a baked [cutout](#baked-cutout-basemap): it replaces the fit and draws land, water, roads and names                    |
| `basemapLabels` | which baked names to draw: `'places'` (default, all), `'cities'` (rank 0 only) or `'none'`; shape names are unaffected |
| `table`         | render a visually hidden table of shapes and points                                                                    |
| `ariaLabel`     | the accessible name of the group                                                                                       |

Emits `select(id)` and `point-hover(id | null)`. A `#tooltip` slot replaces the
default card; its scope is `{ kind, id, title, text, point, feature }`.

### Server rendering

The component draws from a viewBox and never measures the DOM or reads the
clock. Pattern and clip ids come from `useId()`, and hover state starts empty,
so a server render and a client render are identical (`NardukGeoMap.test.ts`
compares `renderToString` with a mount). Projected paths are cached per geometry
in a `WeakMap`, so changing only `fills` (a timelapse repainting every frame)
never re-projects.

### Labels

Each name sits at the pole of inaccessibility of its shape's largest ring, is
clamped inside the frame, and is then nudged up, down, left or right until it
clears every mark and every label already placed. A pin never covers a name.
Names baked into a cutout go through the same placer but are dropped, never
clipped, when they would leave the frame or cannot find clear space.

### Accessibility

The `<svg>` is `role="group"` (`role="img"` in `plain` mode) and contains no
`<title>` or `<desc>`, which browsers show as native tooltips. A point with an
`href` is an `<a>` with an `aria-label`; one without is a focusable `role="img"`
element. Every mark has an invisible 24px hit target. Hover and focus show a
tooltip card.

## GL map

```vue
<script setup lang="ts">
import { NardukMap } from '@narduk-enterprises/narduk-maps/gl'
</script>

<template>
  <NardukMap
    :shapes="towns"
    id-key="name"
    :points="points"
    :width="640"
    :height="460"
    scheme="light"
  />
</template>
```

`NardukMap` takes the same `shapes`, `points`, `fills`, `hatch`, `highlight`,
`idKey`, `nameKey`, `labels`, `padding` and `bounds` as the SVG map, plus
`overlays` (raster tile layers with `label`, `opacity`, `visible` and
`attribution`), `visibleLayers`, `scheme`, `tokens`, `load` and `height`. It
renders `NardukGeoMap` as a poster, mounts MapLibre over it with the same
`fitBounds` padding, and fades in on the first `idle`, so nothing jumps. `load`
is `eager`, `visible` (default), `idle` or `interaction`.

Marks are drawn as a `symbol` layer from images painted once per colour on a
canvas (not circle layers), so MapLibre's collision detection treats them as
obstacles and the basemap's place names step off them. Zoom buttons and a
compact attribution (OpenFreeMap, OpenMapTiles, OpenStreetMap, plus overlays)
are custom and token-styled. A `#popup` slot renders into the tooltip card on a
point click; Escape closes it. `defineExpose({ map })` hands you the MapLibre
instance.

## Basemap style

```ts
import { createBasemapStyle } from '@narduk-enterprises/narduk-maps/style'

const style = createBasemapStyle({}, { scheme: 'dark', labels: 'places' })
```

OpenFreeMap vector tiles (`https://tiles.openfreemap.org/planet`, OpenMapTiles
schema), glyphs from the same host, no sprite and no icons. Landcover and parks
at a faint tint, major roads then minor, no buildings below z14, boundaries, and
place names for cities, towns and villages only. No POIs, no road labels, no
house numbers. Options: `scheme` (`light` or `dark`, each with its own chosen
values), `labels` (`places` or `none`), `tokens` overrides, `hideNames` (names
you draw yourself). `metadata['narduk:slots']` names the layers the caller's own
layers go under.

## Baked cutout basemap

A `CutoutBasemap` is a region's land, water, shoreline, roads and place names
baked at build time into one small static object, so a map needs no tiles and no
engine:

```ts
interface CutoutBasemap {
  name: string
  bbox: [w, s, e, n] // already widened to the frame's aspect
  viewBox: [width, height]
  zoom: number
  layers: {
    id: 'water' | 'green' | 'shore' | 'roadMinor' | 'roadMajor' | 'state'
    d: string
  }[]
  labels: {
    text: string
    x: number
    y: number
    kind: 'place' | 'water'
    rank: number
  }[]
  attribution: string
}
```

With `basemap` set, the bbox and viewBox are the projection frame (north-west
corner at the origin, Web Mercator), so shapes and points land in the same
pixels as the baked paths. Paint order: land, green, the caller's shape fills,
water, shore (a clipped halo and a line), roads, state lines, then shape
boundaries, labels and points. The attribution is drawn bottom right. The baking
CLI is not part of this package.

Baked names are bold capitals with tracking at 72% opacity (water names are
italic in the water-label colour), the same as the GL `place` layer. Set
`basemapLabels="cities"` to keep only rank 0, or `"none"` when your own shape
names carry the map (the MARC choropleth does), so villages never collide with
county labels.

## Tokens

The basemap tokens are the approved harbor look
(`design/narduk-maps/gen/style.mjs`, `LOOKS.harbor`), light and dark; ink,
focus, tooltip and mark tokens are data and state tokens and are separate.
Colours are `--color-map-*` custom properties in `style.css` (light on `:root`,
dark on `.narduk-map--dark`, `.dark` and `[data-theme='dark']`), mirrored as hex
in `src/tokens.ts` for GL style JSON; `tokens.test.ts` keeps the two in step.
Numbers (mark sizes, strokes, label type) live only in `DEFAULT_METRICS` and
reach the SVG as inline `--size-map-*` custom properties. Editing a token is the
whole job of re-skinning.

## Lab

```bash
pnpm --filter @narduk-enterprises/narduk-maps run lab   # http://localhost:5183
```

`lab/App.vue` shows real data (MARC county levels, Aquidneck actions) in every
mode. Query params: `?dark=1` and `?only=<section>` (`aquidneck-svg`,
`aquidneck-svg-375`, `aquidneck-gl`, `aquidneck-cutout`, `aquidneck-cutout-375`,
`marc-normal`, `marc-plain`, `marc-interactive`, `marc-cutout`,
`marc-cutout-375`, `dark-row`) for screenshots.

## Known gaps against DESIGN.md

- MapLibre has no small caps, so GL names use upper case with tracking where the
  SVG uses small caps.
- GL basemap place names are clipped at the frame edge like any MapLibre label;
  the SVG drops them instead.
- Marks and labels in the SVG poster scale with the viewBox; GL marks are scaled
  by container width over viewBox width to match.

## Development

```bash
pnpm run quality      # format:check, lint, typecheck, test:unit
```
