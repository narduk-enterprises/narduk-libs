import {
  normalizeValue,
  toValueRangeTuple,
  type ValueRangeInput,
} from '../color/normalize.js'
import { rampLut } from '../color/ramp.js'
import {
  coastalFeather,
  dataUvTransform,
  displayValueFromEncoded,
  linearChannelToSrgb,
  nearestMaskValid,
  sampleRgbBilinearSoft,
  sampleScalarBilinearSoft,
  srgbChannelToLinear,
  texelPositionFromUv,
  validSideFeather,
} from './math.js'
import type {
  GridBBox,
  GridBBoxAnchor,
  GridSampling,
  GridScale,
  GridValueKind,
  GridValueRange,
  GridViewport,
  RampStop,
} from './models.js'

/**
 * The scalar and explicit mask-aware RGB render paths, on the CPU, with no
 * canvas and no GL.
 *
 * ## Why this exists
 *
 * Both shipping backends draw through an API that only a browser has — a
 * WebGL2 context or a 2D canvas — so neither can be asserted in a Node test.
 * The result was that the *math* of the render path, which is the part most
 * likely to be subtly wrong and least likely to be noticed, had no coverage at
 * all: kernel weights, coverage rules, the log-scale normalization, the LUT
 * lookup, the alpha composition. This module is that math, extracted and
 * executable anywhere, and it is the reference the two backends are asserted
 * against rather than a fourth opinion about how a grid should look.
 *
 * The parity contract the golden harness holds these to:
 *
 * - **Canvas2D scalar === reference, exactly.** Both are CPU float paths
 *   running the same functions, so any difference is a bug and the tolerance
 *   is zero.
 * - **Legacy Canvas2D RGB is a separate fallback contract.** It scales a
 *   masked RGBA raster through the browser's premultiplied-alpha filter for
 *   playback speed. Scale-aware RGB calls this reference directly and is
 *   byte-exact with it.
 * - **WebGL2 === reference, within a count or two per channel.** The GPU
 *   samples the LUT with hardware linear filtering, whose subtexel weights are
 *   fixed-point on most drivers, and rasterizes in `highp` rather than double.
 *   Neither is worth chasing to the last bit; a drift beyond a couple of counts
 *   is a real disagreement.
 *
 * ## Where it deviates from GeoGridKit, on purpose
 *
 * The kernel and the normalization are literal ports. Two things are not:
 *
 * 1. **Per-stop alpha flows through.** GeoGridKit's `ColorStop` is RGB-only, so
 *    its fragment reads `lutColor(...).rgb` and drops the alpha channel. The
 *    canonical `./color` engine carries RGBA, and ramps like FRONT put real
 *    meaning in alpha, so it is composed into the output here.
 * 2. **Output is non-premultiplied.** GeoGridKit writes premultiplied tiles;
 *    the web backends run a `premultipliedAlpha: false` context with a
 *    `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` blend, and this matches them.
 *
 * GeoGridKit's grid-edge feathering (`gridEdgeFade`, `gridEdgeFeatherCoverage`)
 * is *not* ported. It is driven by tile uniforms this package has no analogue
 * for, and the coastline stencil plays that role on web.
 */

/** Non-premultiplied RGBA8, row-major, top row first. */
export interface ReferenceRaster {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

export interface ReferenceScalarLayer {
  values: ArrayLike<number>
  mask: ArrayLike<number>
  width: number
  height: number
  /** `float32` samples are display units already; `encoded-u16` needs decoding. */
  valueKind: GridValueKind
}

export interface ReferenceRgbLayer {
  channels: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>]
  mask: ArrayLike<number>
  width: number
  height: number
}

/** Base/detail payload for the scale-aware temporal RGB contract. */
export interface ReferenceRgbCompositionLayer {
  baseChannels: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>]
  observedChannels: readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>]
  /** `0…255`, spatially sampled through `observedMask`. */
  confidence: ArrayLike<number>
  baseMask: ArrayLike<number>
  observedMask: ArrayLike<number>
  width: number
  height: number
}

export interface ReferenceScalarStyle {
  /** Canonical normalized-position stops. `normalizeWireStops` builds these. */
  stops: readonly RampStop[]
  /**
   * The wire/decode domain. Decodes an `encoded-u16` sample and nothing else.
   * Narrowing it mis-decodes the frame rather than stretching it.
   */
  valueRange: ValueRangeInput
  /** The render stretch. Defaults to {@link ReferenceScalarStyle.valueRange}. */
  displayRange?: ValueRangeInput
  scale: GridScale
  /** Defaults to `soft`. */
  sampling?: GridSampling
  /**
   * A flat multiplier on the output alpha, default `1`.
   *
   * The backends leave this alone: layer opacity is a CSS property on the
   * canvas element, and applying it here as well would square it.
   */
  opacity?: number
  /** LUT resolution. `256` matches GeoGridKit and should not normally change. */
  lutCount?: number
}

export interface ReferenceRgbStyle {
  /**
   * Coverage at partial neighborhoods. The CPU reference and WebGL2 RGB kernel
   * default to `coastal`. Legacy Canvas2D RGB uses its separate
   * premultiplied-alpha image resample and does not consume this style;
   * scale-aware Canvas2D RGB does.
   */
  sampling?: GridSampling
  /** Flat output-alpha multiplier, default `1`. */
  opacity?: number
}

/** Scale-aware RGB style resolved for the viewport's continuous zoom. */
export interface ReferenceRgbCompositionStyle extends ReferenceRgbStyle {
  /** Zoom anchor weight before per-pixel confidence, clamped to `0…1`. */
  observationWeight: number
}

export interface ReferenceTileOptions {
  /** Output size. Defaults to the layer's own geometry. */
  width?: number
  height?: number
  /** Defaults per {@link GridValueKind}: `cell-center` for `float32`. */
  anchor?: GridBBoxAnchor
}

export interface ReferenceRgbTileOptions extends ReferenceTileOptions {
  /** A second frame to blend toward, for temporal playback. */
  blend?: ReferenceRgbBlend
}

export interface ReferenceRgbCompositionTileOptions extends ReferenceTileOptions {
  /** A second composed frame to blend toward, for temporal playback. */
  blend?: ReferenceRgbCompositionBlend
}

export interface ReferenceViewportOptions {
  viewport: GridViewport
  bbox: GridBBox
  width: number
  height: number
  anchor?: GridBBoxAnchor
  /** A second frame to blend toward, for temporal playback. */
  blend?: ReferenceScalarBlend
}

export interface ReferenceRgbViewportOptions {
  viewport: GridViewport
  bbox: GridBBox
  width: number
  height: number
  /** RGB temporal manifests span cell edges, so this defaults to `cell-edge`. */
  anchor?: GridBBoxAnchor
  /** A second frame to blend toward, for temporal playback. */
  blend?: ReferenceRgbBlend
}

export interface ReferenceRgbCompositionViewportOptions {
  viewport: GridViewport
  bbox: GridBBox
  width: number
  height: number
  /** RGB temporal manifests span cell edges, so this defaults to `cell-edge`. */
  anchor?: GridBBoxAnchor
  /** A second composed frame to blend toward, for temporal playback. */
  blend?: ReferenceRgbCompositionBlend
}

/**
 * Sample a baked LUT the way a `LINEAR` / `CLAMP_TO_EDGE` texture read does.
 *
 * GeoGridKit samples its 1×256 LUT at `(normalized, 0.5)` through a linear
 * sampler, so the color for a position is an interpolation *between* two baked
 * entries, offset by the half texel that separates a normalized coordinate from
 * a texel center. Sampling `sampleRamp01` directly here instead would be
 * marginally more accurate and would disagree with both GPUs.
 */
export function sampleLutLinear(lut: Uint8Array, position: number): [number, number, number, number] {
  const count = lut.length / 4
  if (count < 1) return [0, 0, 0, 0]
  const coordinate = position * count - 0.5
  const lower = Math.floor(coordinate)
  const t = coordinate - lower
  const i0 = clampIndex(lower, count) * 4
  const i1 = clampIndex(lower + 1, count) * 4
  return [
    lerp(lut[i0]!, lut[i1]!, t),
    lerp(lut[i0 + 1]!, lut[i1 + 1]!, t),
    lerp(lut[i0 + 2]!, lut[i1 + 2]!, t),
    lerp(lut[i0 + 3]!, lut[i1 + 3]!, t),
  ]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clampIndex(index: number, count: number): number {
  if (index < 0) return 0
  const last = count - 1
  return index > last ? last : index
}

/** A second frame to blend toward, for temporal playback. */
export interface ReferenceScalarBlend {
  upper: ReferenceScalarLayer
  progress: number
}

/** A second RGB frame to blend toward. */
export interface ReferenceRgbBlend {
  upper: ReferenceRgbLayer
  progress: number
}

/** A second scale-aware RGB frame to blend toward. */
export interface ReferenceRgbCompositionBlend {
  upper: ReferenceRgbCompositionLayer
  progress: number
}

/**
 * The per-pixel body of the precolored RGB path.
 *
 * Spatial interpolation happens independently inside each frame through the
 * mask-aware 2×2 kernel. The two real colors are then blended in time. If one
 * frame has no support at a pixel, the other is used rather than blending
 * toward black; the same fallback rule powers the scalar path.
 */
export function referenceRgbPixel(
  layer: ReferenceRgbLayer,
  style: ReferenceRgbStyle,
  x: number,
  y: number,
  blend?: ReferenceRgbBlend,
): [number, number, number, number] {
  const sampling = style.sampling ?? 'coastal'
  const upperLayer = blend?.upper
  const validLower = nearestMaskValid(layer.mask, layer.width, layer.height, x, y)
  const validUpper = upperLayer
    ? nearestMaskValid(upperLayer.mask, upperLayer.width, upperLayer.height, x, y)
    : validLower
  if (!validLower && !validUpper) return [0, 0, 0, 0]

  // Preserve the legacy R8UI nearest-mask footprint. The new 2×2 kernel may
  // see a valid neighbor across a boundary, but it is never even evaluated
  // when the current nearest support cell is invalid.
  const lower = validLower
    ? sampleRgbBilinearSoft(
        layer.channels,
        layer.mask,
        layer.width,
        layer.height,
        x,
        y,
        sampling,
      )
    : null
  const upper = upperLayer
    ? validUpper
      ? sampleRgbBilinearSoft(
          upperLayer.channels,
          upperLayer.mask,
          upperLayer.width,
          upperLayer.height,
          x,
          y,
          sampling,
        )
      : null
    : lower

  const progress = blend ? Math.max(0, Math.min(1, blend.progress)) : 0
  const lowerColor = validLower ? lower!.color : upper!.color
  const upperColor = validUpper ? upper!.color : lower!.color
  const coverageLower = validLower ? lower!.coverage : upper!.coverage
  const coverageUpper = validUpper ? upper!.coverage : lower!.coverage
  const blendedCoverage = coverageLower + (coverageUpper - coverageLower) * progress
  const coverage = sampling === 'coastal' ? validSideFeather(blendedCoverage) : blendedCoverage
  const alpha = coverage * (style.opacity ?? 1)
  if (alpha <= 0) return [0, 0, 0, 0]

  return [
    (lowerColor[0] + (upperColor[0] - lowerColor[0]) * progress) * 255,
    (lowerColor[1] + (upperColor[1] - lowerColor[1]) * progress) * 255,
    (lowerColor[2] + (upperColor[2] - lowerColor[2]) * progress) * 255,
    alpha * 255,
  ]
}

interface LinearRgbSample {
  color: [red: number, green: number, blue: number]
  coverage: number
  nearestValid: boolean
}

/**
 * Compose base and observed RGB, then blend temporal frames, entirely in
 * linear-sRGB.
 *
 * Spatial support remains independently honest for the base and observation.
 * If one component is absent the other real component wins without inventing
 * a color; only two valid components use `observationWeight * confidence`.
 * The same fallback is applied across time, so a missing date never fades a
 * real neighboring date toward black or transparency.
 */
export function referenceRgbCompositionPixel(
  layer: ReferenceRgbCompositionLayer,
  style: ReferenceRgbCompositionStyle,
  x: number,
  y: number,
  blend?: ReferenceRgbCompositionBlend,
): [number, number, number, number] {
  const lower = sampleRgbCompositionFrame(layer, style, x, y)
  const upper = blend ? sampleRgbCompositionFrame(blend.upper, style, x, y) : lower
  const validLower = lower.nearestValid
  const validUpper = upper.nearestValid
  if (!validLower && !validUpper) return [0, 0, 0, 0]

  const progress = blend ? Math.max(0, Math.min(1, blend.progress)) : 0
  const lowerColor = validLower ? lower.color : upper.color
  const upperColor = validUpper ? upper.color : lower.color
  const lowerCoverage = validLower ? lower.coverage : upper.coverage
  const upperCoverage = validUpper ? upper.coverage : lower.coverage
  const blendedCoverage = lowerCoverage + (upperCoverage - lowerCoverage) * progress
  const sampling = style.sampling ?? 'coastal'
  const coverage = sampling === 'coastal' ? validSideFeather(blendedCoverage) : blendedCoverage
  const alpha = coverage * (style.opacity ?? 1)
  if (alpha <= 0) return [0, 0, 0, 0]

  return [
    linearChannelToSrgb(lowerColor[0] + (upperColor[0] - lowerColor[0]) * progress) * 255,
    linearChannelToSrgb(lowerColor[1] + (upperColor[1] - lowerColor[1]) * progress) * 255,
    linearChannelToSrgb(lowerColor[2] + (upperColor[2] - lowerColor[2]) * progress) * 255,
    alpha * 255,
  ]
}

function sampleRgbCompositionFrame(
  layer: ReferenceRgbCompositionLayer,
  style: ReferenceRgbCompositionStyle,
  x: number,
  y: number,
): LinearRgbSample {
  const sampling = style.sampling ?? 'coastal'
  // This is the CPU reference for the shaders' `floor(p + .5)` hard gates.
  // Do not even enter a component's color kernel when its current nearest
  // support cell is invalid: the neighboring 2x2 weights may polish color,
  // but they are not permission to create support.
  const hasBaseSupport = nearestMaskValid(
    layer.baseMask,
    layer.width,
    layer.height,
    x,
    y,
  )
  const hasObservedSupport = nearestMaskValid(
    layer.observedMask,
    layer.width,
    layer.height,
    x,
    y,
  )
  if (!hasBaseSupport && !hasObservedSupport) {
    return { color: [0, 0, 0], coverage: 0, nearestValid: false }
  }

  const base = hasBaseSupport
    ? sampleRgbBilinearSoft(
        layer.baseChannels,
        layer.baseMask,
        layer.width,
        layer.height,
        x,
        y,
        sampling,
      )
    : null
  const observed = hasObservedSupport
    ? sampleRgbBilinearSoft(
        layer.observedChannels,
        layer.observedMask,
        layer.width,
        layer.height,
        x,
        y,
        sampling,
      )
    : null
  const confidence = hasObservedSupport
    ? sampleScalarBilinearSoft(
        layer.confidence,
        layer.observedMask,
        layer.width,
        layer.height,
        x,
        y,
        sampling,
      )
    : null
  const validBase = base !== null && base.coverage > 0
  const validObserved = observed !== null && confidence !== null && observed.coverage > 0 && confidence.coverage > 0
  if (!validBase && !validObserved) {
    return { color: [0, 0, 0], coverage: 0, nearestValid: true }
  }

  const baseLinear = validBase ? toLinearRgb(base.color) : null
  const observedLinear = validObserved ? toLinearRgb(observed.color) : null
  if (!validBase) return { color: observedLinear!, coverage: observed!.coverage, nearestValid: true }
  if (!validObserved) return { color: baseLinear!, coverage: base.coverage, nearestValid: true }

  const zoomWeight = Math.max(0, Math.min(1, style.observationWeight))
  const observedWeight = zoomWeight * Math.max(0, Math.min(1, confidence!.value / 255))
  return {
    color: [
      baseLinear![0] + (observedLinear![0] - baseLinear![0]) * observedWeight,
      baseLinear![1] + (observedLinear![1] - baseLinear![1]) * observedWeight,
      baseLinear![2] + (observedLinear![2] - baseLinear![2]) * observedWeight,
    ],
    coverage: base.coverage + (observed!.coverage - base.coverage) * observedWeight,
    nearestValid: true,
  }
}

function toLinearRgb(
  color: readonly [number, number, number],
): [red: number, green: number, blue: number] {
  return [
    srgbChannelToLinear(color[0]),
    srgbChannelToLinear(color[1]),
    srgbChannelToLinear(color[2]),
  ]
}

/**
 * The per-pixel body of the scalar path: sample, blend, normalize, color,
 * compose. Statement for statement, this is `scalarFragmentShader`'s `main`.
 *
 * Exported because both backends and the golden harness want the single-pixel
 * answer without standing up a raster around it.
 *
 * The blend happens in **sample space** — encoded counts for the temporal
 * dialect, display units for `float32` — and the decode runs once afterward.
 * That ordering is load-bearing on a log layer: the wire quantization is linear
 * in encoded space and geometric in display units, so decoding first and then
 * mixing would walk between two frames along the wrong curve.
 */
export function referenceScalarPixel(
  layer: ReferenceScalarLayer,
  lut: Uint8Array,
  style: ReferenceScalarStyle,
  x: number,
  y: number,
  blend?: ReferenceScalarBlend,
): [number, number, number, number] {
  const sampling = style.sampling ?? 'soft'
  const lower = sampleScalarBilinearSoft(
    layer.values,
    layer.mask,
    layer.width,
    layer.height,
    x,
    y,
    sampling,
  )
  const upperLayer = blend?.upper
  const upper = upperLayer
    ? sampleScalarBilinearSoft(
        upperLayer.values,
        upperLayer.mask,
        upperLayer.width,
        upperLayer.height,
        x,
        y,
        sampling,
      )
    : lower

  const validLower = lower.coverage > 0
  const validUpper = upper.coverage > 0
  if (!validLower && !validUpper) return [0, 0, 0, 0]

  const progress = blend ? Math.max(0, Math.min(1, blend.progress)) : 0
  const rawLower = validLower ? lower.value : upper.value
  const rawUpper = validUpper ? upper.value : lower.value
  const raw = rawLower + (rawUpper - rawLower) * progress

  // The two ranges, and the two jobs they do. `valueRange` decodes the wire
  // sample; `displayRange` spreads the ramp. They are the same object until a
  // stretch says otherwise, so an unstretched layer takes exactly the path it
  // always took — including both guards collapsing onto one range.
  const range = style.valueRange
  const displayRange = style.displayRange ?? range
  if (!isDrawableRange(range) || !isDrawableRange(displayRange)) return [0, 0, 0, 0]

  const value =
    layer.valueKind === 'float32'
      ? raw
      : displayValueFromEncoded(raw, toRange(range), style.scale)

  const position = normalizeValue(value, displayRange, style.scale)
  if (position === null) return [0, 0, 0, 0]

  const coverageLower = validLower ? lower.coverage : upper.coverage
  const coverageUpper = validUpper ? upper.coverage : lower.coverage
  const blended = coverageLower + (coverageUpper - coverageLower) * progress
  const coverage = sampling === 'coastal' ? coastalFeather(blended) : blended

  const color = sampleLutLinear(lut, position)
  const alpha = (color[3] / 255) * coverage * (style.opacity ?? 1)
  if (alpha <= 0) return [0, 0, 0, 0]
  return [color[0], color[1], color[2], alpha * 255]
}

function toRange(range: ValueRangeInput): GridValueRange {
  const [lowerBound, upperBound] = toValueRangeTuple(range)
  return { lowerBound, upperBound }
}

/**
 * Whether a value range can be rendered at all.
 *
 * `normalizeValue` **throws** on `lo >= hi`, matching the server's `raise`.
 * Right for a pure function, wrong inside a render loop: the exception escapes
 * through `requestAnimationFrame` and takes the frame with it, when the
 * documented contract for a renderer handed a bad style is to draw nothing and
 * keep running.
 *
 * Written `!(lo < hi)` rather than `lo >= hi` so a `NaN` bound is rejected too.
 * Every comparison against `NaN` is false, so `NaN >= hi` would *pass* a
 * `>=` guard and paint the entire layer the ramp's first color out of a range
 * nobody can interpret. The GLSL guard in `normalizedScalar` is written
 * identically and deliberately: a corrupt range has to produce the same nothing
 * on both backends, or the CPU/GPU parity this module exists to anchor has a
 * hole in it exactly where the inputs are worst.
 */
export function isDrawableRange(range: ValueRangeInput): boolean {
  const [lowerBound, upperBound] = toValueRangeTuple(range)
  return lowerBound < upperBound
}

/** Bake the LUT this style renders through. */
export function referenceLut(style: ReferenceScalarStyle): Uint8Array {
  return rampLut(style.stops, style.lutCount ?? 256)
}

/**
 * Render a layer's full extent into a raster — the tile-shaped parity leg.
 *
 * Output pixel centers map to `uv = (i + 0.5) / size`, matching how a fragment
 * shader sees a full-screen quad.
 */
export function referenceRenderScalarTile(
  layer: ReferenceScalarLayer,
  style: ReferenceScalarStyle,
  options: ReferenceTileOptions = {},
): ReferenceRaster {
  const width = options.width ?? layer.width
  const height = options.height ?? layer.height
  const anchor = options.anchor ?? (layer.valueKind === 'float32' ? 'cell-center' : 'cell-edge')
  const lut = referenceLut(style)
  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let py = 0; py < height; py += 1) {
    const v = (py + 0.5) / height
    const gy = texelPositionFromUv(v, layer.height, anchor)
    for (let px = 0; px < width; px += 1) {
      const u = (px + 0.5) / width
      const gx = texelPositionFromUv(u, layer.width, anchor)
      writePixel(pixels, (py * width + px) * 4, referenceScalarPixel(layer, lut, style, gx, gy))
    }
  }
  return { width, height, pixels }
}

/** Render a precolored RGB layer through the mask-aware reference kernel. */
export function referenceRenderRgbTile(
  layer: ReferenceRgbLayer,
  style: ReferenceRgbStyle,
  options: ReferenceRgbTileOptions = {},
): ReferenceRaster {
  const width = options.width ?? layer.width
  const height = options.height ?? layer.height
  const anchor = options.anchor ?? 'cell-edge'
  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let py = 0; py < height; py += 1) {
    const v = (py + 0.5) / height
    const gy = texelPositionFromUv(v, layer.height, anchor)
    for (let px = 0; px < width; px += 1) {
      const u = (px + 0.5) / width
      const gx = texelPositionFromUv(u, layer.width, anchor)
      writePixel(
        pixels,
        (py * width + px) * 4,
        referenceRgbPixel(layer, style, gx, gy, options.blend),
      )
    }
  }
  return { width, height, pixels }
}

/** Render a scale-aware RGB layer through the CPU composition contract. */
export function referenceRenderRgbCompositionTile(
  layer: ReferenceRgbCompositionLayer,
  style: ReferenceRgbCompositionStyle,
  options: ReferenceRgbCompositionTileOptions = {},
): ReferenceRaster {
  const width = options.width ?? layer.width
  const height = options.height ?? layer.height
  const anchor = options.anchor ?? 'cell-edge'
  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let py = 0; py < height; py += 1) {
    const gy = texelPositionFromUv((py + 0.5) / height, layer.height, anchor)
    for (let px = 0; px < width; px += 1) {
      const gx = texelPositionFromUv((px + 0.5) / width, layer.width, anchor)
      writePixel(
        pixels,
        (py * width + px) * 4,
        referenceRgbCompositionPixel(layer, style, gx, gy, options.blend),
      )
    }
  }
  return { width, height, pixels }
}

/**
 * Render a layer as the backends blit it — through a viewport onto a screen.
 *
 * Screen pixels whose data UV falls outside `0…1` are transparent, which is the
 * `uv` bounds check both fragment shaders open with.
 */
export function referenceRenderScalarViewport(
  layer: ReferenceScalarLayer,
  style: ReferenceScalarStyle,
  options: ReferenceViewportOptions,
): ReferenceRaster {
  const { viewport, bbox, width, height } = options
  const anchor = options.anchor ?? (layer.valueKind === 'float32' ? 'cell-center' : 'cell-edge')
  const { uvOffsetX, uvOffsetY, uvScaleX, uvScaleY } = dataUvTransform(viewport, bbox)
  const lut = referenceLut(style)
  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let py = 0; py < height; py += 1) {
    const v = uvOffsetY + ((py + 0.5) / height) * uvScaleY
    for (let px = 0; px < width; px += 1) {
      const u = uvOffsetX + ((px + 0.5) / width) * uvScaleX
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      const gx = texelPositionFromUv(u, layer.width, anchor)
      const gy = texelPositionFromUv(v, layer.height, anchor)
      writePixel(
        pixels,
        (py * width + px) * 4,
        referenceScalarPixel(layer, lut, style, gx, gy, options.blend),
      )
    }
  }
  return { width, height, pixels }
}

/** Render an RGB layer through the same viewport transform as both backends. */
export function referenceRenderRgbViewport(
  layer: ReferenceRgbLayer,
  style: ReferenceRgbStyle,
  options: ReferenceRgbViewportOptions,
): ReferenceRaster {
  const { viewport, bbox, width, height } = options
  const anchor = options.anchor ?? 'cell-edge'
  const { uvOffsetX, uvOffsetY, uvScaleX, uvScaleY } = dataUvTransform(viewport, bbox)
  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let py = 0; py < height; py += 1) {
    const v = uvOffsetY + ((py + 0.5) / height) * uvScaleY
    for (let px = 0; px < width; px += 1) {
      const u = uvOffsetX + ((px + 0.5) / width) * uvScaleX
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      const gx = texelPositionFromUv(u, layer.width, anchor)
      const gy = texelPositionFromUv(v, layer.height, anchor)
      writePixel(
        pixels,
        (py * width + px) * 4,
        referenceRgbPixel(layer, style, gx, gy, options.blend),
      )
    }
  }
  return { width, height, pixels }
}

/** Render scale-aware RGB through the viewport transform both backends use. */
export function referenceRenderRgbCompositionViewport(
  layer: ReferenceRgbCompositionLayer,
  style: ReferenceRgbCompositionStyle,
  options: ReferenceRgbCompositionViewportOptions,
): ReferenceRaster {
  const { viewport, bbox, width, height } = options
  const anchor = options.anchor ?? 'cell-edge'
  const { uvOffsetX, uvOffsetY, uvScaleX, uvScaleY } = dataUvTransform(viewport, bbox)
  const pixels = new Uint8ClampedArray(width * height * 4)

  for (let py = 0; py < height; py += 1) {
    const v = uvOffsetY + ((py + 0.5) / height) * uvScaleY
    for (let px = 0; px < width; px += 1) {
      const u = uvOffsetX + ((px + 0.5) / width) * uvScaleX
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      const gx = texelPositionFromUv(u, layer.width, anchor)
      const gy = texelPositionFromUv(v, layer.height, anchor)
      writePixel(
        pixels,
        (py * width + px) * 4,
        referenceRgbCompositionPixel(layer, style, gx, gy, options.blend),
      )
    }
  }
  return { width, height, pixels }
}

function writePixel(
  pixels: Uint8ClampedArray,
  offset: number,
  rgba: [number, number, number, number],
): void {
  pixels[offset] = Math.round(rgba[0])
  pixels[offset + 1] = Math.round(rgba[1])
  pixels[offset + 2] = Math.round(rgba[2])
  pixels[offset + 3] = Math.round(rgba[3])
}
