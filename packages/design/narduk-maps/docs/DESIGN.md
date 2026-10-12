# narduk-maps design direction (v1)

Logan, 2026-10-12: "in each instance i really want a nice looking map ... a package that we use that we could make a
nice map that is nicer than what we have here and reusable". The baseline is aquidneck.nard.uk/map, which uses stock
OpenFreeMap positron with every OSM label, black 1px town lines, pins over town names and a grey box while it loads.
The other baseline is the two hand-rolled SVG maps: MARC's `CountyMap.vue` and Aquidneck's `IslandLedger.vue`.

## Domain pass

Five concepts from the world these maps serve (civic dashboards, public-health and resilience trackers):

- **Shoreline:** the land/water edge is the most legible shape on a regional map.
- **Jurisdiction:** towns and counties are the units people act in.
- **Status of a place:** a project or site has a state, and its shape and colour say which.
- **Level:** a region is filled by how bad it is right now (choropleth).
- **Provenance:** every layer says where it came from, and examples say they are examples.

**Signature element.** One picture, two engines. The SVG map (instant, no JS cost) and the MapLibre map (pan and zoom)
use the same projection (Web Mercator), the same tokens and the same marks. The SVG is the GL map's poster, and the
live map fades in over it without moving a pixel. A shoreline halo makes the land read at a glance: a soft
water-side band along the coast.

**Three defaults we do not use:**

1. A stock basemap with the full OSM label set. Instead, a muted style we own: land, water, shoreline, quiet roads,
   and place labels limited to the towns the data needs.
2. A grey box while the map loads. The poster paints on first render, including SSR.
3. Default MapLibre chrome: stock popup, nav control and full-width attribution bar. We use our own small controls
   and a tooltip card. Attribution stays visible but compact.

Also banned: SVG `<title>` elements (browsers show them as native tooltips, Logan 2026-10-12), black hairline
boundaries, and pins covering labels.

## Look (tokens, light; dark is selected, not inverted)

| Token | Light | Use |
| --- | --- | --- |
| `--color-map-water` | `#dfe8ee` | sea and lakes (Aquidneck's sea already) |
| `--color-map-land` | `#f7f6f2` | land |
| `--color-map-shore` | water mixed 60% toward `#9fb6c6` | 1.5px coastline plus a 6px halo at 35% on the water side |
| `--color-map-boundary` | `#8a97a3` at 70% | jurisdiction lines, 1px, round joins |
| `--color-map-boundary-focus` | `--color-map-ink` | selected or hovered shape, 2px |
| `--color-map-ink` | `#1f2a33` | labels |
| `--color-map-label-halo` | land | 3px text halo |
| `--color-map-road` | land mixed 12% toward ink | GL only, major roads only below z12 |
| `--color-map-mark-ring` | `#ffffff` | 2px surface ring on every mark |

- **Labels:** small caps, 600 weight, letter-spacing 0.06em, 11px for jurisdictions; water names italic, muted.
- **Marks:** a dot of radius 7 with a 2px surface ring, in shapes the caller picks:
  - `dot`
  - `ring` (white fill, 4px coloured ring)
  - `core` (dot with a white core)
  - `small` (radius 5, outlined)
  - `hollow` (white, dashed grey ring)

  A highlighted mark is radius 10. Status colour comes from the caller, never from the package.
- **Fills (choropleth):** the caller passes colours. A hatched pattern means "no data" (MARC `noSite`). Fills sit
  under boundaries, never over the shoreline.

## API (v1, to the two consumers' real needs)

- `@narduk-enterprises/narduk-maps` (root) and `./svg`: `NardukGeoMap`, the projection utils and the types. This
  entry never imports maplibre.
- `./style`: `createBasemapStyle(tokens, opts)`, which returns a MapLibre style JSON (pure data, no maplibre import)
  over OpenFreeMap's keyless OpenMapTiles vector source, glyphs from OpenFreeMap and no sprite.
- `./gl`: `NardukMap`. `maplibre-gl` is an optional peer dependency, imported dynamically on load.
- `./style.css`: the tokens and component CSS.

Ship v1 without clustering, self-hosted tiles on R2, and any narduk-mapkit dependency (its `./marks` entry pulls
in the MapKit runtime). These are follow-up issues.
