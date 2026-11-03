---
'@narduk-enterprises/narduk-maps': minor
'@narduk-enterprises/create-narduk-app': patch
---

narduk-maps gains a framework-free `./geo` entry for Narduk Geo catalog v2 on
MapLibre, moved from earth-web rather than rewritten: the catalog loader (index
→ catalogs → layers, malformed layers skipped with a reason), terrarium and uv
decode, bilinear over texels with data, the ramp texture with per-stop alpha,
readout formatting in display units (log10 undone), the `FieldLayer` custom
WebGL2 layer, an exact PNG decoder, PMTiles and XYZ tile sources, frame-time
helpers with cadence-aware labels and the prefetch policy, and
`setupMapLibre` / `registerPmtilesProtocol`. `pmtiles` is a new dependency;
`maplibre-gl` stays an optional peer and `./geo` uses only its types. The
generator's narduk-maps pin moves with the release.
