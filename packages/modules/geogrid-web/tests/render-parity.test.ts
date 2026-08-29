import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vitest'

import { normalizeValue } from '../src/color/normalize.js'
import { rampLut, roundHalfToEven, type RGBA8 } from '../src/color/ramp.js'
import { decodeGridBinary, type GridScalarDataset } from '../src/core/decode/grid.js'
import type { GridScale, RampStop } from '../src/core/models.js'
import { referenceRenderGridTile } from '../src/tile/baker.js'
import { tileBounds } from '../src/tile/mercator.js'
import type { GridStyle } from '../src/render/types.js'
import { decodePng } from './support/png.js'

/**
 * Tier 1 of the `render-parity-v1` cross-repo contract: golden-tile parity
 * against the real server tile renderer.
 *
 * Two different legs live in this file, and they gate differently — see
 * `RENDER-PARITY-CONTRACT.md` (the doc this was built from) and
 * `tests/fixtures/render-parity-v1/PROVENANCE.md` for the full derivation:
 *
 * - **Tier 1a — the green gate.** A test-local *server-parity* renderer, built
 *   out of this package's own primitives (`normalizeValue`, `rampLut`,
 *   `roundHalfToEven`), driven with the exact geometry and quantization the
 *   server tile renderer uses. Only the tile-pixel→lon/lat walk, the
 *   NaN-aware bilinear, and the nearest-index 128-step palette lookup are new
 *   code — everything that actually colors a pixel is the package's shipped
 *   ramp engine. Gated at the pack's published tolerance
 *   (`manifest.tolerance.tier1ChannelsOf255`, currently 4/255 per channel),
 *   though a correct port should land at 0 — see the per-tile deltas logged
 *   below.
 * - **Tier 1b — measured, not gated at 4.** The package's actual PRODUCTION
 *   tile renderer (`referenceRenderGridTile`) run over the same fixture,
 *   compared to the same golden tiles. This is expected to diverge by more
 *   than 4/255, for three structural reasons named at that describe block —
 *   none of them a bug in this package, all of them already documented in the
 *   contract doc. The assertion there is a ratchet against a *measured*
 *   bound, not the Tier-1a tolerance, and this file does not change any
 *   renderer behavior in `src/` to chase it.
 *
 * Server-parity colorization (Tier 1a's "Step 3") is deliberately **not**
 * `sampleRamp01`/`sampleLutLinear` continuous sampling. The server quantizes
 * the normalized position into `rampPaletteSteps` (128) and looks up the
 * *nearest* palette entry — `sampleLutLinear` (linear-filtered, 256-entry) is
 * exactly what Tier 1b's production path uses instead, and exactly why it
 * diverges.
 */

const PACK_URL = new URL('./fixtures/render-parity-v1/', import.meta.url)

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, PACK_URL)), 'utf8')) as T
}

interface RenderParityManifest {
  date: string
  layers: string[]
  tiles: string[]
  rampPaletteSteps: number
  tileSize: number
  tolerance: { tier1ChannelsOf255: number }
}

interface CatalogDataset {
  id: string
  valueRange: [number, number]
  scale: GridScale
}

interface CatalogExcerpt {
  datasets: CatalogDataset[]
}

interface RampParityFixture {
  ramps: Record<string, RampStop[]>
}

const manifest = loadJson<RenderParityManifest>('manifest.json')
const catalog = loadJson<CatalogExcerpt>('catalog-excerpt.json')
const rampFixture = loadJson<RampParityFixture>('ramp-parity-v1.json')

/**
 * `sst_filled`'s spec ramp is the registry ramp named `thermal`, **not** the
 * one named `sst` — the contract doc calls this out explicitly as a
 * documented trap, and the two ramps quantize differently (8/255 vs 5/255 on
 * a continuous sample), so getting this wrong reads as a shader bug rather
 * than a transcription error.
 */
const LAYER_RAMP: Record<string, string> = {
  sst_filled: 'thermal',
  kd490_filled: 'kd490',
}

const TILE_SIDE = manifest.tileSize
const RAMP_STEPS = manifest.rampPaletteSteps
const TIER1_TOLERANCE = manifest.tolerance.tier1ChannelsOf255

const TRANSPARENT: RGBA8 = [0, 0, 0, 0]

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function catalogDataset(layer: string): CatalogDataset {
  const found = catalog.datasets.find((dataset) => dataset.id === layer)
  if (!found) throw new Error(`catalog-excerpt.json has no dataset ${layer}`)
  return found
}

function rampStopsFor(rampName: string): RampStop[] {
  const stops = rampFixture.ramps[rampName]
  if (!stops) throw new Error(`ramp-parity-v1.json has no ramp named ${rampName}`)
  return stops
}

function parseTileSpec(spec: string): { z: number; x: number; y: number } {
  const parts = spec.split('/').map(Number)
  const [z, x, y] = parts
  if (parts.length !== 3 || z === undefined || x === undefined || y === undefined) {
    throw new Error(`malformed tile spec in manifest.json: ${spec}`)
  }
  return { z, x, y }
}

function loadGrid(layer: string): GridScalarDataset {
  const bytes = readFileSync(
    fileURLToPath(new URL(`grids/${layer}_${manifest.date}.bin`, PACK_URL)),
  )
  return decodeGridBinary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

function loadGolden(layer: string, tileSpec: string): ReturnType<typeof decodePng> {
  const [z, x, y] = tileSpec.split('/')
  const bytes = readFileSync(fileURLToPath(new URL(`expected/${layer}/${z}_${x}_${y}.png`, PACK_URL)))
  return decodePng(bytes)
}

/**
 * NaN-aware bilinear sample of a decoded `/grid` plane at a geographic point,
 * per the contract doc's "Step 2". This is new test-local code — it is not a
 * repackaging of anything the production renderer does, because the
 * production kernel (`sampleScalarBilinearSoft` / `sampleScalarBilinearCoastal`
 * in `src/core/math.ts`) computes coverage-weighted alpha rather than the
 * server's "any surviving weight colors the pixel, alpha comes from the ramp"
 * rule — see the Tier 1b divergence #3 below.
 *
 * `inside` is the product of the row mask and the column mask, applied to
 * every corner equally, exactly as the contract doc specifies — not a
 * per-corner bounds test.
 */
function bilinearSample(dataset: GridScalarDataset, lon: number, lat: number): number {
  const { header, planes } = dataset
  const { lon0, lat0, dx, dy, width, height } = header
  const values = planes[0]!

  const col = (lon - lon0) / dx
  const row = (lat - lat0) / dy
  const insideCol = col >= 0 && col <= width - 1
  const insideRow = row >= 0 && row <= height - 1
  if (!insideCol || !insideRow) return Number.NaN

  const col0 = clamp(Math.floor(col), 0, width - 1)
  const col1 = Math.min(width - 1, col0 + 1)
  const row0 = clamp(Math.floor(row), 0, height - 1)
  const row1 = Math.min(height - 1, row0 + 1)
  const tx = clamp(col - col0, 0, 1)
  const ty = clamp(row - row0, 0, 1)

  const corners: Array<{ r: number; c: number; w: number }> = [
    { r: row0, c: col0, w: (1 - ty) * (1 - tx) },
    { r: row0, c: col1, w: (1 - ty) * tx },
    { r: row1, c: col0, w: ty * (1 - tx) },
    { r: row1, c: col1, w: ty * tx },
  ]

  let weighted = 0
  let total = 0
  for (const corner of corners) {
    const sample = values[corner.r * width + corner.c]!
    if (Number.isFinite(sample)) {
      weighted += sample * corner.w
      total += corner.w
    }
  }
  return total > 0 ? Math.fround(weighted / total) : Number.NaN
}

/**
 * Colorize a bilinear-sampled value the way the server does: normalize
 * (reused verbatim from `src/color/normalize.ts`), quantize the normalized
 * position to the nearest of `steps` palette entries — **not** a linear
 * filter — and look that entry up in a `steps`-entry LUT built from
 * `rampLut`.
 *
 * The server's `normalized` array is `float32` (numpy), and `normalized *
 * (steps - 1)` is *also* evaluated as a float32 multiply — a Python int
 * scalar against a float32 array keeps the array's dtype rather than
 * upcasting to float64. That is not equivalent to computing the product in
 * double and rounding once at the end: at `kd490_filled` tile `10/241/417`,
 * pixel `(253, 90)`, the double product of the float32-rounded `n` is
 * `67.49999809265137` (rounds down to index 67), while numpy's float32
 * multiply of the same two float32 values lands exactly on the tie
 * `67.5` (rounds, half-to-even, up to index 68) — a real 4/255 pixel
 * miss that sent this test hunting for a "transcription bug" that turned out
 * to be a missing intermediate rounding, not a wrong formula. `Math.fround`
 * after **both** the normalize and the multiply reproduces the two-step
 * float32 rounding exactly.
 */
function colorizeServerParity(
  value: number,
  valueRange: readonly [number, number],
  scale: GridScale,
  lut: Uint8Array,
  steps: number,
): RGBA8 {
  const n = normalizeValue(value, valueRange, scale)
  if (n === null) return TRANSPARENT
  const nf32 = Math.fround(n)
  const scaled = Math.fround(nf32 * (steps - 1))
  const index = clamp(roundHalfToEven(scaled), 0, steps - 1)
  const offset = index * 4
  return [lut[offset]!, lut[offset + 1]!, lut[offset + 2]!, lut[offset + 3]!]
}

/**
 * Render one 256×256 tile through the server-parity path (contract doc
 * "Tier 1", steps 1–3), sampling the tile-pixel→lon/lat geometry linearly in
 * latitude — **not** by inverting Web Mercator per pixel, which is exactly
 * where GeoGridKit and GeoGridWeb's production geometry disagrees with the
 * server (divergence #1; see the Tier 1b block below).
 *
 * `tileBounds` (this package's own Web-Mercator corner math) is reused for
 * the tile's four corners only — true Mercator inversion at the corners is
 * exactly what the contract doc's `tile_bounds(z,x,y)` is, and it is not the
 * per-pixel interpolation the doc calls out as the divergent part.
 */
function renderServerParityTile(
  dataset: GridScalarDataset,
  valueRange: readonly [number, number],
  scale: GridScale,
  stops: readonly RampStop[],
  tile: { z: number; x: number; y: number },
): Uint8ClampedArray {
  const bounds = tileBounds({ ...tile, side: TILE_SIDE })
  if (!bounds) throw new Error(`degenerate tile bounds for ${tile.z}/${tile.x}/${tile.y}`)
  const [west, south, east, north] = bounds
  const lut = rampLut(stops, RAMP_STEPS)
  const pixels = new Uint8ClampedArray(TILE_SIDE * TILE_SIDE * 4)

  for (let py = 0; py < TILE_SIDE; py += 1) {
    const lat = north - ((py + 0.5) / TILE_SIDE) * (north - south)
    for (let px = 0; px < TILE_SIDE; px += 1) {
      const lon = west + ((px + 0.5) / TILE_SIDE) * (east - west)
      const value = bilinearSample(dataset, lon, lat)
      const rgba = colorizeServerParity(value, valueRange, scale, lut, RAMP_STEPS)
      const offset = (py * TILE_SIDE + px) * 4
      pixels[offset] = rgba[0]
      pixels[offset + 1] = rgba[1]
      pixels[offset + 2] = rgba[2]
      pixels[offset + 3] = rgba[3]
    }
  }
  return pixels
}

/** Max absolute per-channel delta between two same-sized RGBA8 rasters. */
function maxChannelDelta(a: Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
  let worst = 0
  for (let i = 0; i < a.length; i += 1) {
    worst = Math.max(worst, Math.abs(a[i]! - b[i]!))
  }
  return worst
}

describe.each(manifest.layers)('Tier 1a — server-parity render matches %s golden tiles', (layer) => {
  const dataset = loadGrid(layer)
  const { valueRange, scale } = catalogDataset(layer)
  const stops = rampStopsFor(LAYER_RAMP[layer]!)

  it.each(manifest.tiles)('tile %s is within tolerance', (tileSpec) => {
    const tile = parseTileSpec(tileSpec)
    const golden = loadGolden(layer, tileSpec)
    expect(golden.width).toBe(TILE_SIDE)
    expect(golden.height).toBe(TILE_SIDE)

    const rendered = renderServerParityTile(dataset, valueRange, scale, stops, tile)
    const delta = maxChannelDelta(rendered, golden.pixels)
    // eslint-disable-next-line no-console -- the actual measured delta is part of the contract's evidence trail.
    console.log(`Tier 1a  ${layer} ${tileSpec}: max|delta| = ${delta}/255`)
    expect(delta, `${layer} ${tileSpec} max per-channel delta`).toBeLessThanOrEqual(TIER1_TOLERANCE)
  })
})

/**
 * Tier 1b — the package's actual PRODUCTION tile renderer, measured (not
 * gated at 4/255) against the same golden tiles.
 *
 * Three structural reasons this renderer cannot reach the golden pixels at
 * the Tier-1a tolerance, all documented in `RENDER-PARITY-CONTRACT.md` and
 * none of them a bug to fix in this lane:
 *
 * 1. **Tile latitude.** The server interpolates latitude *linearly* between a
 *    tile's corner latitudes (Tier 1a's geometry, above). The production
 *    renderer — via `tileProjection`/`tileRowV` in `src/tile/mercator.ts` —
 *    inverts Web Mercator per pixel instead, matching GeoGridKit. Measured on
 *    this pack's own tiles: up to 1.55px at z6, dropping to ~0.1px by z10.
 * 2. **Ramp lookup.** The server quantizes to a nearest-index lookup over a
 *    128-entry palette (Tier 1a's colorize step). The production renderer
 *    samples a 256-entry LUT with GPU-style *linear* filtering
 *    (`sampleLutLinear` in `src/core/reference-render.ts`), which the
 *    contract doc measures at up to 8/255 on `thermal` and 3/255 on `kd490`
 *    from quantization alone — before any geometry difference is even
 *    considered.
 * 3. **Alpha.** The server takes alpha straight from the ramp everywhere any
 *    bilinear corner is valid. The production renderer's `soft` sampling
 *    multiplies alpha by bilinear coverage (`referenceScalarPixel` in
 *    `src/core/reference-render.ts`: `alpha = (color[3]/255) * coverage * opacity`),
 *    which fades every partially-covered edge pixel toward transparent
 *    instead of leaving it at the ramp's own alpha.
 *
 * This block does not change any renderer behavior in `src/` — it measures
 * the production path exactly as shipped and ratchets against that measured
 * bound so a *regression* beyond it still fails CI, without pretending the
 * production renderer and the server's exact tile bytes are the same
 * contract.
 *
 * The bounds below are the exact `max|delta|` measured against this pack when
 * this test was written (one `it.each` run, logged above as `Tier 1b  ...`).
 * z9's two tiles land within a few counts (the geometry divergence is under a
 * quarter pixel there); z6's single tile and both z10 tiles are dominated by
 * the alpha-from-coverage divergence (#3) rather than geometry, which is why
 * they do not track the "worse at low zoom" pattern geometry alone would
 * predict. Per-tile rather than one global bound, so a regression on any
 * single tile is caught precisely instead of hiding under a loose worst-case
 * number.
 *
 * The assertion below is **exact equality**, not `<=`, even for the loose
 * bounds (up to 252). A `<=` against a bound that large would admit nearly
 * any regression on those tiles and defeat the point of a ratchet. Exact
 * equality is safe here, not merely convenient: this render path
 * (`referenceRenderGridTile` → `tileProjection`/`tileRowV`) is pure CPU
 * double-precision arithmetic with no WebGL/GPU step, and V8 implements
 * `Math.atan`/`Math.sinh`/`Math.log10` in software (fdlibm) specifically so
 * transcendental results are bit-identical across OS and CPU architecture —
 * this is not the cross-language `log10` ULP concern noted elsewhere in this
 * repo (`color-parity.test.ts`), which is about *different runtimes*
 * (CPython vs V8) agreeing, not this same-runtime, same-JS-engine
 * computation drifting from itself. A future intentional change to this
 * bound (the renderer legitimately gets closer to, or further from, the
 * golden tiles) is expected to update the pinned number here, deliberately,
 * as part of that change.
 */
const TIER1B_MEASURED_MAX_DELTA: Record<string, Record<string, number>> = {
  sst_filled: {
    '6/15/26': 245,
    '9/121/209': 3,
    '9/121/208': 3,
    '10/241/417': 182,
    '10/241/431': 132,
  },
  kd490_filled: {
    '6/15/26': 252,
    '9/121/209': 3,
    '9/121/208': 4,
    '10/241/417': 246,
    '10/241/431': 240,
  },
}

describe.each(manifest.layers)('Tier 1b — production renderer vs %s golden tiles (measured)', (layer) => {
  const dataset = loadGrid(layer)
  const { valueRange, scale } = catalogDataset(layer)
  const stops = rampStopsFor(LAYER_RAMP[layer]!)

  const style: GridStyle = {
    rampStops: stops,
    valueRange: { lowerBound: valueRange[0], upperBound: valueRange[1] },
    scale,
  }

  it.each(manifest.tiles)('tile %s measured delta is within the committed ratchet', (tileSpec) => {
    const tile = parseTileSpec(tileSpec)
    const golden = loadGolden(layer, tileSpec)

    const raster = referenceRenderGridTile(dataset, style, { ...tile, side: TILE_SIDE })
    const delta = maxChannelDelta(raster.pixels, golden.pixels)
    // eslint-disable-next-line no-console -- the actual measured delta is part of the contract's evidence trail.
    console.log(`Tier 1b  ${layer} ${tileSpec}: max|delta| = ${delta}/255 (production renderer, not gated at ${TIER1_TOLERANCE})`)

    // Ratchet, not a parity gate: this bound is *measured* from the three
    // structural divergences named above, not derived from first principles.
    // Exact equality (not `<=`) so a regression AND an accidental drift the
    // other way both force a deliberate update to the pinned number above —
    // see the module comment for why exact equality is safe for this
    // pure-CPU, no-GPU render path. The renderer catching up to the server's
    // exact geometry, quantization and alpha rule is tracked separately (it
    // is a product decision, not something this harness should silently
    // paper over by loosening the number).
    const bound = TIER1B_MEASURED_MAX_DELTA[layer]?.[tileSpec]
    if (bound === undefined) throw new Error(`no committed Tier 1b ratchet for ${layer} ${tileSpec}`)
    expect(delta, `${layer} ${tileSpec} production-renderer delta`).toBe(bound)
  })
})
