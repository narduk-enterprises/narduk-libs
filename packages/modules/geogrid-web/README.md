# GeoGridWeb

Web twin of [GeoGridKit](https://github.com/narduk-enterprises/GeoGridKit): decode gridded geo payloads and render them as a **full-screen sibling canvas overlay** with **WebGL2** (primary) and **Canvas2D** (fallback).

| | |
|--|--|
| Package | `@narduk-enterprises/geogrid-web` |
| Repo | `github.com/narduk-enterprises/GeoGridWeb` |
| GPU | WebGL2 + Canvas2D fallback |
| WebGPU | Not in v0.x |

## Relationship to GeoGridKit

Shared *concepts* (scale, value range, color stops, normalize math, temporal frames). Different *host model* in v1:

- **GeoGridKit**: bake tiles → MapKit / CGImage
- **GeoGridWeb v1**: viewport-sized overlay canvas over any basemap

Tile bakers, mosaic lattice, and vector styles are future work.

## Install

GitHub Packages (`@narduk-enterprises` scope):

```ini
@narduk-enterprises:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```sh
pnpm add @narduk-enterprises/geogrid-web
```

## Quick start

```ts
import {
  createGridOverlay,
  decodeTemporalChunk,
  type TemporalRasterManifest,
} from '@narduk-enterprises/geogrid-web'

const overlay = createGridOverlay({
  mode: 'scalar',
  style: {
    ramp: [
      { value: 0.01, r: 22, g: 72, b: 120 },
      { value: 1, r: 118, g: 45, b: 78 },
    ],
    valueRange: [0.01, 1],
    scale: 'log',
    opacity: 0.75,
  },
})

mapContainer.appendChild(overlay.element())
overlay.setViewport({
  center: { latitude: 30, longitude: -90 },
  span: { latitudeDelta: 10, longitudeDelta: 10 },
})

const frames = await decodeTemporalChunk(chunkBytes, manifest as TemporalRasterManifest)
overlay.renderAt(frames[0]!, frames[0]!, 0, manifest.bbox)
```

Exports: `@narduk-enterprises/geogrid-web`, `/core`, `/render`, `/overlay`.

## What this package does *not* own

- MapKit / MapLibre / Leaflet basemap setup
- HTTP catalog or chunk fetching (apps pass `ArrayBuffer` frames)
- Product-specific ramps (kd490, yield, etc.)
- Nuxt / Vue components

## Known v1 limitations

- Dateline-crossing bboxes unsupported
- Null / unusable viewport: skip draw (uses last good viewport when available)
- No tiled `renderTile` baker yet

## Development

```sh
pnpm install
pnpm run quality
```

## License

MIT
