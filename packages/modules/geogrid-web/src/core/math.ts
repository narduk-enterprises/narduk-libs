import type {
  GridBBox,
  GridBBoxAnchor,
  GridSampling,
  GridScale,
  GridRgbComposition,
  GridValueRange,
  GridViewport,
} from './models.js'

/**
 * Normalize a display value into 0…1 for ramp lookup.
 * Byte-compatible intent with GeoGridKit `GridValueMapper.normalizedValue`.
 */
export function normalizeValue(
  value: number,
  range: GridValueRange,
  scale: GridScale,
): number | null {
  if (!Number.isFinite(value)) return null
  const lower = range.lowerBound
  const upper = range.upperBound
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower === upper) return null

  let normalized: number
  if (scale === 'log') {
    if (!(value > 0) || !(lower > 0) || !(upper > 0)) return null
    normalized = (Math.log(value) - Math.log(lower)) / (Math.log(upper) - Math.log(lower))
  } else {
    normalized = (value - lower) / (upper - lower)
  }

  if (!Number.isFinite(normalized)) return null
  return Math.max(0, Math.min(1, normalized))
}

/**
 * Map a 0…65535 encoded scalar sample back to display units given the layer range/scale.
 * Used by Canvas2D and shared with WebGL fragment `displayValue` math.
 */
export function displayValueFromEncoded(
  encoded: number,
  range: GridValueRange,
  scale: GridScale | string,
): number {
  const normalized = Math.max(0, Math.min(1, encoded / 65535))
  const [min, max] = [range.lowerBound, range.upperBound]
  if (scale === 'log' && min > 0 && max > 0) {
    return 10 ** (Math.log10(min) + normalized * (Math.log10(max) - Math.log10(min)))
  }
  return min + normalized * (max - min)
}

/**
 * Inter-frame blend of two encoded uint16 samples (0…65535).
 * Both Canvas2D and WebGL must mix in encoded space so log-scale layers
 * interpolate along the wire quantization (geometric in display units).
 */
export function blendEncoded(lower: number, upper: number, progress: number): number {
  const t = Math.max(0, Math.min(1, progress))
  return lower + (upper - lower) * t
}

/**
 * Display value after encoded-space temporal blend — the single formula both backends share.
 */
export function blendedDisplayValue(
  lowerEncoded: number,
  upperEncoded: number,
  progress: number,
  range: GridValueRange,
  scale: GridScale | string,
): number {
  return displayValueFromEncoded(blendEncoded(lowerEncoded, upperEncoded, progress), range, scale)
}

export interface DataUvTransform {
  uvOffsetX: number
  uvOffsetY: number
  uvScaleX: number
  uvScaleY: number
}

/** Map screen UV → data-bbox texture UV for a viewport (same math as WebGL/Canvas blit). */
export function dataUvTransform(viewport: GridViewport, bbox: GridBBox): DataUvTransform {
  const span = viewport.span
  const viewportWest = viewport.center.longitude - span.longitudeDelta / 2
  const viewportNorth = viewport.center.latitude + span.latitudeDelta / 2
  const [west, south, east, north] = bbox
  const bboxWidth = Math.max(1e-9, east - west)
  const bboxHeight = Math.max(1e-9, north - south)
  return {
    uvScaleX: span.longitudeDelta / bboxWidth,
    uvScaleY: span.latitudeDelta / bboxHeight,
    uvOffsetX: (viewportWest - west) / bboxWidth,
    uvOffsetY: (north - viewportNorth) / bboxHeight,
  }
}

/** Slippy-map tile width used to derive zoom from a visible longitude span. */
const WEB_MERCATOR_TILE_CSS_PIXELS = 256

/**
 * Resolve a continuous map zoom for scale-aware RGB composition.
 *
 * A host-supplied finite zoom is authoritative. MapKit exposes only a region,
 * so the fallback uses the Web-Mercator world-width identity
 * `z = log2(360 * cssWidth / (256 * longitudeSpan))`. A bad viewport never
 * promotes detail: `null` makes the caller choose the base-only weight.
 */
export function viewportZoom(viewport: GridViewport, cssWidth: number): number | null {
  if (viewport.zoom !== undefined) {
    return Number.isFinite(viewport.zoom) ? viewport.zoom : null
  }
  if (!(cssWidth > 0) || !Number.isFinite(cssWidth)) return null
  const longitudeSpan = viewport.span.longitudeDelta
  if (!(longitudeSpan > 0) || !Number.isFinite(longitudeSpan)) return null
  const zoom = Math.log2((360 * cssWidth) / (WEB_MERCATOR_TILE_CSS_PIXELS * longitudeSpan))
  return Number.isFinite(zoom) ? zoom : null
}

/**
 * Observation contribution at a continuous map zoom.
 *
 * Exact anchors are `0` through z7, `0.25` at z8, `0.40` at z9 and `1` at
 * z10 and above. Fractional zooms interpolate linearly between adjacent
 * anchors so a pinch zoom cannot introduce a visible step.
 */
export function observationWeightForZoom(zoom: number | null | undefined): number {
  if (zoom === null || zoom === undefined || !Number.isFinite(zoom) || zoom <= 7) return 0
  if (zoom < 8) return (zoom - 7) * 0.25
  if (zoom < 9) return 0.25 + (zoom - 8) * 0.15
  if (zoom < 10) return 0.4 + (zoom - 9) * 0.6
  return 1
}

/** Decode one normalized display-sRGB channel into linear-sRGB. */
export function srgbChannelToLinear(channel: number): number {
  const value = Math.max(0, Math.min(1, channel))
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** Encode one normalized linear-sRGB channel into display-sRGB. */
export function linearChannelToSrgb(channel: number): number {
  const value = Math.max(0, Math.min(1, channel))
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055
}

const bitsScratch = new DataView(new ArrayBuffer(8))

/**
 * A hashable 32-bit stand-in for a value the integer mixer cannot digest.
 *
 * The mixer below truncates with `| 0`, which is exactly right for the
 * `0…65535` samples of an encoded-u16 plane and exactly wrong for a `float32`
 * plane, where it discards the entire fractional part — a KD490 grid runs
 * `0.01…6.6`, so truncation maps nearly every distinct cell onto `0`. Worse,
 * `NaN | 0` is `0`, and a gulf grid is mostly `NaN` over land: fingerprinting
 * one through the integer path collapses it toward a constant and lets two
 * genuinely different grids share a cache entry.
 *
 * Folding the IEEE-754 halves together keeps every bit of the mantissa in play
 * and gives `NaN` one stable, non-degenerate image.
 */
function hashableBits(value: number): number {
  bitsScratch.setFloat64(0, value)
  return (bitsScratch.getUint32(0) ^ bitsScratch.getUint32(4)) | 0
}

function mix(hash: number, value: number): number {
  // Integers — every encoded-u16 and mask sample — take the original path, so
  // the temporal dialect's fingerprints are byte-for-byte what they always were.
  return (hash * 31 + (Number.isInteger(value) ? value : hashableBits(value))) | 0
}

/**
 * Fold an entire plane into a 32-bit hash.
 *
 * This used to sample roughly 64 elements spread across the plane, which is a
 * reasonable fingerprint for a *change detector* and a bad one for a **cache
 * key**. On a 512×512 grid it inspected about 65 of 262,144 cells, so two grids
 * differing in tens of thousands of cells could hash identically — and for a
 * `/grid` frame the hash *is* the identity (there is no date to discriminate
 * on, unlike a temporal frame), so a collision means the GPU keeps showing the
 * previous dataset.
 *
 * Reading every element costs well under a millisecond even at 512², which is
 * nothing against the texture upload it guards.
 *
 * The trailing re-mix of the last element is kept rather than tidied away: with
 * the old stride it was the one thing guaranteeing the final cell was seen, and
 * keeping it means every plane of 64 elements or fewer — every fixture, and the
 * pinned temporal keys — hashes to exactly what it did before.
 */
function hashPlane(values: ArrayLike<number>, seed: number): number {
  const n = values.length
  let hash = (seed ^ (n * 83492791)) | 0
  for (let i = 0; i < n; i += 1) {
    hash = mix(hash, values[i] ?? 0)
  }
  if (n > 0) hash = mix(hash, values[n - 1] ?? 0)
  return hash
}

/**
 * Content fingerprint for a frame's sample payload (not the date alone).
 * Used so GPU/CPU caches invalidate when the same date is re-decoded with new bytes.
 * Includes all RGB planes when present so G/B-only updates bust the cache.
 */
export function frameContentKey(
  date: string,
  width: number,
  height: number,
  values: ArrayLike<number>,
  mask: ArrayLike<number>,
  channels?: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>],
  rgbComposition?: GridRgbComposition,
): string {
  let hash = (width * 73856093) ^ (height * 19349663)
  if (rgbComposition) {
    // The composed renderer reads this payload exclusively. Hash every
    // render-relevant plane once; `values`, `mask`, and `channels` are legacy
    // aliases of the base and intentionally do not make the same bytes walk
    // the mixer a second or third time. The legacy branch below stays exactly
    // unchanged, including its historical hash values.
    hash = hashPlane(rgbComposition.baseChannels[0], hash ^ 0x41414141)
    hash = hashPlane(rgbComposition.baseChannels[1], hash ^ 0x42424242)
    hash = hashPlane(rgbComposition.baseChannels[2], hash ^ 0x43434343)
    hash = hashPlane(rgbComposition.observedChannels[0], hash ^ 0x51515151)
    hash = hashPlane(rgbComposition.observedChannels[1], hash ^ 0x52525252)
    hash = hashPlane(rgbComposition.observedChannels[2], hash ^ 0x53535353)
    hash = hashPlane(rgbComposition.confidence, hash ^ 0x61616161)
    hash = hashPlane(rgbComposition.baseMask, hash ^ 0x71717171)
    hash = hashPlane(rgbComposition.observedMask, hash ^ 0x72727272)
    return `${date}|${width}x${height}|${values.length}|${mask.length}|${hash >>> 0}`
  }
  hash = hashPlane(values, hash)
  hash = hashPlane(mask, hash)
  if (channels) {
    hash = hashPlane(channels[0], hash ^ 0x11111111)
    hash = hashPlane(channels[1], hash ^ 0x22222222)
    hash = hashPlane(channels[2], hash ^ 0x33333333)
  }
  return `${date}|${width}x${height}|${values.length}|${mask.length}|${hash >>> 0}`
}

/** The result of one scalar kernel evaluation. */
export interface ScalarSample {
  /**
   * Weighted mean of the finite neighbors, renormalized over the weights that
   * actually survived. `0` when nothing survived — read `coverage` first.
   */
  value: number
  /** `0…1`. See {@link GridSampling} for what each mode puts here. */
  coverage: number
  /** Sum of the surviving weights, before the mode's coverage rule is applied. */
  weight: number
}

/** The result of one precolored RGB kernel evaluation. */
export interface RgbSample {
  /** Weighted mean of the real neighboring colors, in normalized RGB space. */
  color: [red: number, green: number, blue: number]
  /** `0…1`. See {@link GridSampling} for what each mode puts here. */
  coverage: number
  /** Sum of the surviving weights, before the mode's coverage rule is applied. */
  weight: number
}

/**
 * The 2×2 NaN-aware bilinear kernel — the one sampler every backend shares.
 *
 * `x` and `y` are continuous coordinates in **texel-center space**: integer `i`
 * is the center of cell `i`, which is what {@link texelPositionFromUv}
 * produces. Sampling outside the grid clamps to the edge cell, matching
 * `CLAMP_TO_EDGE` and GeoGridKit's own clamp.
 *
 * One deliberate deviation from the Metal reference: it bails to zero coverage
 * for a grid narrower or shorter than two cells, which would drop a legal 1×N
 * `/grid` response on the floor. Here a single-cell axis simply puts all of its
 * weight on the one cell it has.
 *
 * ## Why 2×2 and not a wider tent
 *
 * The kernel this replaces was a 3×3 radius-1.5 tent, which is a blur: it pulls
 * in cells up to a cell and a half away and smears a front that the data
 * resolves sharply. The server's tiles and GeoGridKit's Metal renderer both use
 * this 2×2 form, so a wider kernel on web was not a different aesthetic — it
 * was the web client disagreeing with every other renderer in the estate about
 * what the same bytes look like.
 *
 * ## Why the weights are renormalized
 *
 * Missing neighbors are dropped from the average rather than substituted, and
 * the surviving weights are divided by their own sum. Substituting a zero (or
 * the range floor, or a neighbor's value) for a missing cell drags the average
 * toward a number nobody measured — visible as a dark halo hugging every
 * coastline. Renormalizing instead says the honest thing: this pixel is the
 * mean of the real data near it, and `coverage` reports how much real data that
 * was.
 *
 * A neighbor whose weight is exactly `0` — the right column when `fx` is `0`,
 * say — is not "missing" in any sense that matters, so it never suppresses a
 * `soft` sample. The test is on weight, not on presence, and the zero is exact
 * in IEEE arithmetic rather than approximate, so the GLSL and TypeScript
 * kernels agree without an epsilon.
 */
export function sampleScalarBilinearSoft(
  values: ArrayLike<number>,
  mask: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  mode: GridSampling = 'soft',
): ScalarSample {
  const maxX = width - 1
  const maxY = height - 1
  // Clamp the position before flooring, exactly as the Metal kernel does, so
  // the fractional part outside the grid is the reference's and not a
  // separately-derived one.
  const px = x < 0 ? 0 : x > maxX ? maxX : x
  const py = y < 0 ? 0 : y > maxY ? maxY : y
  const baseX = Math.floor(px)
  const baseY = Math.floor(py)
  const fx = px - baseX
  const fy = py - baseY

  const x0 = baseX
  const x1 = baseX + 1 > maxX ? maxX : baseX + 1
  const y0 = baseY
  const y1 = baseY + 1 > maxY ? maxY : baseY + 1

  let accumulated = 0
  let weight = 0
  let missingWeight = 0

  for (let corner = 0; corner < 4; corner += 1) {
    const right = (corner & 1) === 1
    const down = (corner & 2) === 2
    const w = (right ? fx : 1 - fx) * (down ? fy : 1 - fy)
    if (w <= 0) continue
    const index = (down ? y1 : y0) * width + (right ? x1 : x0)
    if (mask[index]) {
      accumulated += w * (values[index] ?? 0)
      weight += w
    } else {
      missingWeight += w
    }
  }

  if (weight <= 0) return { value: 0, coverage: 0, weight: 0 }
  return {
    value: accumulated / weight,
    coverage: mode === 'coastal' ? weight : missingWeight > 0 ? 0 : 1,
    weight,
  }
}

/**
 * The RGB twin of {@link sampleScalarBilinearSoft}.
 *
 * Each channel is sampled from the same 2×2 neighborhood and the companion
 * mask decides which texels may contribute. Missing texels are never read and
 * never substituted with black; surviving weights are renormalized, while
 * `coverage` reports how much real support remains. Inputs are 8-bit channel
 * planes and the returned color is normalized to `0…1`, matching an `R8`
 * texture read in WebGL2.
 */
export function sampleRgbBilinearSoft(
  channels: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>],
  mask: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
  mode: GridSampling = 'soft',
): RgbSample {
  const maxX = width - 1
  const maxY = height - 1
  const px = x < 0 ? 0 : x > maxX ? maxX : x
  const py = y < 0 ? 0 : y > maxY ? maxY : y
  const baseX = Math.floor(px)
  const baseY = Math.floor(py)
  const fx = px - baseX
  const fy = py - baseY

  const x0 = baseX
  const x1 = baseX + 1 > maxX ? maxX : baseX + 1
  const y0 = baseY
  const y1 = baseY + 1 > maxY ? maxY : baseY + 1

  const accumulated: [number, number, number] = [0, 0, 0]
  let weight = 0
  let missingWeight = 0

  for (let corner = 0; corner < 4; corner += 1) {
    const right = (corner & 1) === 1
    const down = (corner & 2) === 2
    const sampleWeight = (right ? fx : 1 - fx) * (down ? fy : 1 - fy)
    if (sampleWeight <= 0) continue
    const index = (down ? y1 : y0) * width + (right ? x1 : x0)
    if (mask[index]) {
      accumulated[0] += sampleWeight * (channels[0][index] ?? 0)
      accumulated[1] += sampleWeight * (channels[1][index] ?? 0)
      accumulated[2] += sampleWeight * (channels[2][index] ?? 0)
      weight += sampleWeight
    } else {
      missingWeight += sampleWeight
    }
  }

  if (weight <= 0) return { color: [0, 0, 0], coverage: 0, weight: 0 }
  return {
    color: [
      accumulated[0] / weight / 255,
      accumulated[1] / weight / 255,
      accumulated[2] / weight / 255,
    ],
    coverage: mode === 'coastal' ? weight : missingWeight > 0 ? 0 : 1,
    weight,
  }
}

/**
 * The integer texel selected by the legacy RGB validity sampler.
 *
 * The old shader read its `R8UI` mask through a nearest-filtered `texture()`
 * lookup while colors used a linearly-filtered texture.  RGB now samples color
 * through a valid-aware 2×2 kernel, but its visible footprint must remain a
 * subset of that legacy mask footprint: a cosmetic edge pass must never turn a
 * formerly transparent cell into data.  `x`/`y` are texel-center coordinates
 * (`uv * size - 0.5` for cell-edge grids), hence `floor(x + 0.5)` is the same
 * cell that the old nearest lookup selected away from measure-zero boundaries.
 */
export function nearestMaskValid(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  const column = Math.max(0, Math.min(width - 1, Math.floor(x + 0.5)))
  const row = Math.max(0, Math.min(height - 1, Math.floor(y + 0.5)))
  return Boolean(mask[row * width + column])
}

/**
 * Feather a surviving RGB kernel only inside the cell selected by the legacy
 * nearest-validity rule.
 *
 * In a 2×2 kernel the selected cell can contribute as little as one quarter of
 * the weight at a cell corner.  Remapping that honest support range gives the
 * edge a visible, continuous fade without extending alpha across a cell whose
 * nearest source mask is zero.  The caller owns the nearest-mask gate.
 */
export function validSideFeather(coverage: number): number {
  const t = Math.max(0, Math.min(1, (coverage - 0.25) / 0.75))
  return t * t * (3 - 2 * t)
}

/**
 * The feather GeoGridKit's `scalarFragment` applies to a `coastal` coverage.
 *
 * The kernel returns the raw surviving weight sum; the fragment is what shapes
 * it into an alpha, and it does so with this smoothstep rather than using the
 * weight directly. Keeping the two separate is not ceremony — it is what lets
 * the kernel stay a literal port while the composition stays inspectable.
 */
export function coastalFeather(coverage: number): number {
  const t = Math.max(0, Math.min(1, coverage / 0.55))
  return t * t * (3 - 2 * t)
}

/**
 * Map a normalized data-space coordinate onto the sampler's texel-center axis.
 *
 * The two anchors differ by exactly half a cell — see {@link GridBBoxAnchor}
 * for why both exist. Getting this wrong does not fail; it misregisters every
 * pixel by half a cell, which reads as a coastline that does not quite line up.
 */
export function texelPositionFromUv(uv: number, size: number, anchor: GridBBoxAnchor): number {
  return anchor === 'cell-center' ? uv * (size - 1) : uv * size - 0.5
}
