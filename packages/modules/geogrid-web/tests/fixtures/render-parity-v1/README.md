# render-parity-v1

The canonical, SHA-256-pinned bytes that every Narduk renderer of a scalar grid
must agree with.

Five renderers draw the same data: the Python tile bake in this repo, the
dynamic tile renderer beside it, GeoGridKit's Metal shader (Swift), and
GeoGridWeb's WebGL2 and Canvas2D paths (TypeScript). They have already drifted
in ways nobody noticed until someone compared pixels — three different rounding
rules for the same ramp interpolation, and two engines silently dropping
per-stop ramp alpha, which broke the transparent low end of the `front` ramp.
Prose cannot pin that. This pack can.

**Producer:** [`scripts/generate_render_parity_fixtures.py`](../../scripts/generate_render_parity_fixtures.py)
in this repo. Every number here comes out of the production code path —
`shared/colorramp.py`, `earth_data_pipeline.catalog`,
`earth_data_pipeline.grid_artifact`, `earth_data_pipeline.tiles`. Nothing in the
generator re-implements ramp, grid, or tile math, so if a renderer disagrees
with the pack, the pack is right by construction.

**Consumer gate:** `tenants/geo/earth-data/services/earth-data-pipeline/tests/test_render_parity_fixtures.py`
regenerates the pack in memory on every CI run and fails if it has drifted from
the code that produced it.

## Contents

| Path | What it pins |
| --- | --- |
| `ramp-parity-v1.json` | Tier 0. The whole ramp registry, plus pinned samples for value-space and position-space sampling, wire round-trips, and two 256-entry LUTs with SHA-256 digests. |
| `grids/<layer>_<date>.bin` | A synthetic 33×33 scalar grid in the exact wire dialect `/api/v1/grid` serves, with NaN holes and values past both ends of the layer's range. |
| `grids/<layer>_<date>.bin.sha256` | The publish-time digest sidecar, exactly as a real release carries it. |
| `catalog-excerpt.json` | Real `descriptor_for` output for those layers — `ramp`, `rampSets`, `valueRange`, `scale`, `bakedRampVersion` — plus the `valueStatistics` block computed from the grid beside it. |
| `expected/<layer>/<z>_<x>_<y>.png` | Tier 1. Two tiles per zoom (z6/z9/z10) from the real tile renderer: a well-covered **interior** tile, and a sparse **boundary** tile where the grid runs out. |
| `manifest.json` | SHA-256 and byte length for every file above, plus the pack's own parameters. |

`manifest.json` and this README are the only files not listed inside
`manifest.json` — nothing can hash itself, and a documentation edit should not
invalidate a data pin.

## Tolerance tiers

**Tier 0 — byte-exact.** `ramp-parity-v1.json`, the grid binaries, and the
catalog excerpt are closed-form outputs with no encoder in the way. A
reimplementation matches them exactly or it is wrong. This is where most of the
value is: it needs no GPU, no image decoder, and no test harness beyond a JSON
parser.

**Tier 1 — 4/255 per channel, on decoded RGBA.** Compare *pixels*, never PNG
bytes: zlib and Pillow are free to compress the same pixels differently across
versions, and a byte comparison would fail on that alone. 4/255 is the existing
GeoGridKit precedent and covers the last-bit disagreements a GPU pipeline is
entitled to. A same-language reimplementation of the CPU path should be exact;
this pipeline's own test asserts exact equality against itself.

This is not theoretical. The same tile encodes one byte shorter on the Linux CI
runner than on a Mac, from identical pixels. The generator therefore **keeps the
shipped encoding of any image whose decoded pixels are unchanged**, so
regenerating on a different machine does not churn a SHA-256 that three
repositories vendor. A genuine rendering change still produces different pixels,
different bytes and a different hash — which is the signal the pack exists to
give.

### The tile renderer quantizes the ramp — Tier 1 is not continuous sampling

**Read this before implementing Tier 1.** The expected tiles were **not** drawn
by sampling the ramp continuously. The renderer quantizes the normalized
position to `rampPaletteSteps` (128, recorded in `manifest.json`) and looks the
colour up in a palette:

```
index = round(normalized * (steps - 1))          # clamped to [0, steps - 1]
rgba  = lut[index]                               # lut[i] = interpolate(stops, i / (steps - 1))
```

`round` here is `numpy.rint` — **half-to-even**, the same rule
`ramp-parity-v1.json` records in its `rounding` field.

A port that implements Tier 0 faithfully and then renders continuously misses
these pixels by **up to 8/255 on the ramp `sst_filled` actually uses** — twice
the Tier-1 tolerance — while missing KD490 by at most 3, which is the most
confusing possible failure and reads as a shader bug. It is not. Apply the same
quantization, or compare against tiles you regenerate with
`EARTH_DATA_RAMP_PALETTE_STEPS=0` (the continuous path) rather than against the
shipped ones.

> **Careful with ramp names here.** `sst_filled`'s spec ramp is the registry
> ramp named **`thermal`**, not the one named `sst`. Tier 0 pins both, and their
> quantization deviations differ (8 vs 5), so "the SST ramp" is ambiguous
> whenever you are reconciling a number — say which registry name you mean.

The interior tile of each zoom is floored at 25% coverage and 8 distinct
colours, so it always exercises resampling. The boundary tile is **deliberately
exempt** from both — being sparse and near-monochrome is what it pins — so do
not read those floors as a property of every shipped tile.

### The tile renderer interpolates latitude **linearly**, not per-pixel Mercator

**Read this before implementing Tier 1 too.** `render_tile_vectorized_rgba`
resolves a tile's corner latitudes through Web Mercator and then walks between
them linearly:

```
lon[px] = west  + ((px + 0.5) / 256) * (east  - west)
lat[py] = north - ((py + 0.5) / 256) * (north - south)     # linear in latitude
```

Both client tile-math implementations — GeoGridKit's `GridTileMath` and
GeoGridWeb's `lonLatForTilePixel`, which is a literal port of it — invert
Mercator per pixel instead. The two disagree by more than a pixel at the pack's
shallowest zoom:

| tile | tile latitude span | max ǀlinear − Mercatorǀ | in tile pixels |
| --- | --- | --- | --- |
| `6/15/26` | 4.8930° | 0.029587° | **1.55 px** |
| `9/121/208` | 0.5985° | 0.000482° | 0.21 px |
| `10/241/417` | 0.2997° | 0.000120° | 0.10 px |

A client that reproduces Tier 0 perfectly and then renders a tile through its
own Mercator tile math misses the expected pixels by far more than 4/255 at z6,
on a gradient field, for a reason that has nothing to do with colour. Reproduce
the two lines above in the parity path.

Nothing here says which of the two is *right* for a map — that question is
open, and this pack deliberately does not settle it. What the pack pins is what
the published tiles actually are.

### Alpha comes from the ramp, not from coverage

With clipping off, every pixel whose bilinear stencil has at least one finite
corner is written straight from the LUT — **including the LUT's alpha**, which
is not 255 on most of these ramps (`kd490`'s stops run 240–252). Coverage
decides *whether* a pixel is written, never how opaque it is:

```
value = total > 0 ? weighted / total : NaN     # total = sum of valid corner weights
rgba  = isValid(value) ? lut[index] : (0, 0, 0, 0)
```

A renderer that multiplies output alpha by fractional bilinear coverage — as
GeoGridWeb's reference path does, deliberately, for its own soft-edge
behaviour — feathers every hole edge in the pack and will not match. So will a
renderer that forces alpha to 255, or one that compares premultiplied bytes:
the alpha these tiles carry is **straight, not premultiplied**.

That is a statement about the *decoded* pixels, which is the only thing Tier 1
compares. The files themselves are **8-bit indexed PNGs** — colour type 3, with
`PLTE` carrying the RGB and a `tRNS` chunk carrying one straight alpha byte per
palette entry — not truecolor RGBA. Two things follow for anyone writing their
own decoder rather than leaning on Pillow, ImageIO or the browser:

- `tRNS` may be **shorter** than `PLTE`; any palette index at or past its length
  is fully opaque. The two chunks are not required to match in length.
- A type-3 scanline is one byte per pixel, so the filter predictors run with
  `bpp = 1`, not `4`. That mistake unfilters to plausible-looking garbage rather
  than to an obvious failure.

A quick decode check before trusting a comparison: covered pixels must come back
with **alpha below 255** on both pack layers. All-255 alpha means `tRNS` was
skipped; slightly dark RGB means the bytes are premultiplied.

### A consumer's Tier-1 checklist

The four things a faithful port gets wrong most often, all of them silent:

1. Latitude interpolated linearly across the tile, not per-pixel Mercator (above).
2. The ramp looked up as a **nearest index into a 128-entry palette**, not
   sampled continuously and not linearly filtered out of a 256-entry LUT.
3. Alpha taken from the ramp, the tiles decoded as indexed PNGs with `tRNS`,
   and the comparison done on straight (non-premultiplied) pixels (above).
4. `sst_filled`'s ramp is the registry ramp **`thermal`**, not `sst` — see the
   ramp-name callout under the quantization section above, which also records
   why the two ramps' quantization deviations differ.

Getting all four right is not merely within tolerance — it is exact. An
independent reimplementation from this README alone (no pipeline imports)
reproduces all ten expected tiles at `max|delta| = 0`, verified 2026-08-29.
Treat any non-zero delta in a fresh port as a bug in one of the four above
rather than as floating-point drift to be absorbed by the 4/255 tolerance; the
tolerance exists for GPU pipelines, not for a CPU reimplementation.

### Zoom ladder

z6, z9 and z10, and **z10 is the deepest rung on purpose**. Grid cells are
~0.155°, so a tile spans ~36 cells at z6, 4.5 at z9 and 2.3 at z10 — roughly 113
tile pixels per grid cell, which genuinely exercises value-space bilinear across
cell boundaries. Below that the tile is narrower than the grid: z11 spans 1.1
cells and z12 only 0.57, a single 2×2 corner that renders identically under
nearest, bilinear or a constant fill. Such a tile *looks* like a deep-overzoom
test while pinning nothing. Going deeper wants a finer synthetic grid, not a
deeper tile.

The generator pins every render-affecting environment variable
(`EARTH_DATA_COASTLINE_CLIP=0`, `EARTH_DATA_RAMP_PALETTE_STEPS=128`) for the
duration of a render, so a shell that happens to export one cannot silently
re-pin bytes.

## Reading the fixtures

### The synthetic field is analytic, not seeded

A seeded RNG pins bytes only as long as every consumer has the same RNG. This
field is a closed form over the cell index, so a Swift or TypeScript port can
regenerate the identical grid from this description alone:

- The grid is 33×33 over the bbox in `manifest.json`, **row 0 at the north
  edge** (the wire dialect's row order). The bbox is the z6 tile `15/26` inset by
  6% on each side — sized against the tile grid rather than picked for
  roundness, so the expected tiles are 76–100% covered instead of the ~4% a
  round one-degree box produced, while the inset keeps a real grid boundary in
  frame at every zoom.
- `lo` and `hi` below are the layer's `valueRange`, carried in both the `.bin`
  header and the catalog excerpt.
- Let `u = column / 32` and `v = row / 32`. The normalized position at a cell is
  `p = -0.15 + 1.30 · (0.5 · (u + (1 − v)))` — a diagonal sweep from `-0.15` at
  the south-west corner to `1.15` at the north-east one. The overshoot at both
  ends is deliberate: every tile exercises clamp-low and clamp-high alongside
  in-range color.
- `p` is denormalized into data space by `catalog.ramp_stop_value`: on a linear
  layer `lo + p·(hi − lo)`; on a log layer with `lo > 0`,
  `10^(log10(lo) + p·(log10(hi) − log10(lo)))` — and the linear form otherwise,
  since a log ramp with a non-positive minimum has no log domain. That is the
  same function that writes ramp stop values onto the wire, so the field and the
  ramp agree by construction rather than by coincidence.
- Values are then stored as `float32`, matching the wire.

Holes are `NaN` at: the block `rows 6–10 × columns 20–24`, **inclusive on both
ends** (Python `slice(6, 11)` / `slice(20, 25)`); every cell where
`(row + column) mod 17 == 0`; and the two corner cells `(0, 0)` and `(32, 32)`.
A block, a stripe, and two single cells fail differently under a renderer that
mishandles `NaN` at a bilinear sample's corner, which is why there are three
shapes rather than one.

**Log layers only** additionally carry two unphysical cells — `(16, 3) = -1.0`
and `(16, 4) = 0.0` — because non-positive is the out-of-domain case a log
scale has its own rule for (transparent, never clamped). On a linear layer the
same value would be just another below-range clamp the field's own overshoot
already covers, while dragging the published histogram across hundreds of empty
bins.

### The expected tiles were rendered without coastline clipping

`EARTH_DATA_COASTLINE_CLIP=0`. Both pack layers set `coastline_clip=True` in
production, which resolves a GSHHG landmask off disk and antialiases tile alpha
against it. That is right for the product and wrong for a fixture: it would
make the expected pixels depend on an asset no client repo vendors, and on the
exact landmask version the generating machine happened to hold. With clipping
off, the render is a plain NaN-aware bilinear sample into the ramp — which is
the path the Metal and WebGL renderers implement anyway.

`manifest.json` states `"coastlineClip": false` so a consumer never has to infer
it.

### The two layers are not interchangeable

`sst_filled` is linear, `kd490_filled` is log. The log leg is not decoration:
`log10` normalization and the non-positive-is-transparent rule are exactly
where the three language ports have historically disagreed. A harness that runs
only the linear layer has tested the easy half.

## `valueStatistics`

The catalog excerpt carries the per-layer, per-date distribution block the
pipeline publishes for relative/percentile ramps (narduk-data#280): `count`,
`min`, `max`, `mean`, `stddev`, nine percentiles, and a 32-bin histogram.

- Percentiles are **numpy's default, Hyndman–Fan type 7**, computed over the
  **full grid** — no stride, no subsampling. `stddev` is the **population**
  standard deviation (numpy `ddof=0`): these grids are a census of the AOI
  water, not a sample drawn from it. A client is expected to stride when
  it recomputes a stretch over a live viewport; the published statistic is the
  exact one, so it can be the value three renderers agree against.
- `space` mirrors the layer's `scale`. On a log layer every number in the block
  — min, max, mean, stddev, percentiles and histogram edges — is the base-10
  logarithm of the physical value, which is the space the ramp is linear in.
- On a log layer the population excludes non-positive cells, matching
  `normalize_value`, which renders those transparent rather than clamping them.
  `count` is therefore the honest denominator for the percentiles beside it, not
  the grid's finite-cell count.

> **Consumers: read `space` before you use a single number from this block.**
> Both client renderers hold their display range in **physical units** and apply
> `log10` themselves at draw time (GeoGridWeb `src/color/normalize.ts`,
> GeoGridKit's Metal path). Feeding a `space: "log10"` percentile straight into
> a display range therefore log-transforms it a second time and silently
> corrupts the stretch on every log-scale layer. Exponentiate first —
> `10 ** value` — for every number in a `log10` block: `min`, `max`, `mean`, the
> percentiles, and the histogram edges. `stddev` is a spread in log space and has
> no meaningful physical-unit form; convert the bounds, not the spread.
> `kd490_filled` in `catalog-excerpt.json` is a `log10` block, deliberately, so a
> parser that gets this wrong fails against the fixture rather than in
> production.

Two more things a consumer must handle, because both are ordinary outcomes
rather than edge cases:

- **A percentile pair can be equal.** A fully-observed `fill_age` day is zero
  everywhere; a saturated `confidence` plane is one everywhere. Both make
  `p2 == p98`, and `(v − p2) / (p98 − p2)` is then 0/0. Detect it and fall back
  to the layer's declared `valueRange`. `min` and `max` are published in the
  same block so the check needs no second request.
- **`percentiles` keys are strings written in LEXICOGRAPHIC order**
  (`"1", "2", "25", "5", "50", …`), because the pipeline serializes with sorted
  keys. Document order is not percentile order — read by key. (JavaScript
  reorders integer-like keys numerically, so `Object.keys` happens to be safe;
  Python and Swift are not.)

## Relationship to GeoGridWeb's draft

`ramp-parity-v1.json` began as a working draft at
`tests/fixtures/ramp-parity-v1.json` in `narduk-enterprises/GeoGridWeb`, whose
own generator docstring names `fixtures/render-parity-v1` as the destination and
asks that the schema string stay `narduk-ramp-parity-v1`. It does.

This copy is byte-identical to that draft apart from one line: the `generator`
field, which correctly names the file that produced each copy. Every ramp stop,
every sample, every normalized value, every LUT byte and both LUT digests are
the same. GeoGridWeb's existing `tests/color-parity.test.ts` consumes this file
unmodified.

## Regenerating

```
python3 scripts/generate_render_parity_fixtures.py           # rewrite the pack
python3 scripts/generate_render_parity_fixtures.py --check   # fail if stale
```

Regeneration is a deliberate act — it re-pins a contract three repositories
assert against. Review the diff, and say in the PR body which renderer changed
and why.
