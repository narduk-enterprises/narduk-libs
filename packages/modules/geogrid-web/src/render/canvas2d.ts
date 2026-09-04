import { defaultBBoxAnchor, frameCacheKey, toGridFrame } from '../core/frame.js'
import {
  areaSampleBoundsFromUv,
  blendEncoded,
  dataUvTransform,
  displayValueFromEncoded,
  observationWeightForZoom,
  observationSupportModulatesWeight,
  texelPositionFromUv,
  viewportZoom,
} from '../core/math.js'
import { normalizeValue } from '../color/normalize.js'
import {
  isDrawableRange,
  referenceRgbCompositionPixel,
  referenceScalarPixel,
  sampleLutLinear,
  type ReferenceRgbCompositionLayer,
  type ReferenceRgbCompositionStyle,
  type ReferenceScalarLayer,
  type ReferenceScalarStyle,
} from '../core/reference-render.js'
import {
  isUsableViewport,
  type GridBBox,
  type GridBBoxAnchor,
  type GridFrame,
  type GridValueRange,
  type GridViewport,
} from '../core/models.js'
import { resolveRampStops, styleLut, styleSampling, styleScale } from './style.js'
import type {
  CreateBackendOptions,
  GridBackendRenderState,
  GridRenderBackend,
  GridStyle,
} from './types.js'

/**
 * Above this many CSS pixels per grid cell the layer is being magnified, and
 * the raster is built in screen space instead of grid space.
 *
 * Below it the grid is being minified — many cells land inside one pixel — and
 * the browser's own downscale is both adequate and far cheaper than a
 * per-screen-pixel loop in JavaScript.
 */
const SCREEN_SPACE_PIXELS_PER_CELL = 1.5

/**
 * Canvas2D fallback: CPU colorize + viewport blit. Used when WebGL2 is
 * unavailable.
 *
 * ## The two rasterization paths, and why magnification needs its own
 *
 * The straightforward implementation — color every cell, then let `drawImage`
 * scale the result — interpolates between **colors**, and a color ramp is not
 * a linear function of value. Stretched across a magnified cell, the midpoint
 * between a blue cell and a red one comes out muddy purple, when the value
 * halfway between them may sit on a bright green stop the ramp puts in between.
 * The error is largest exactly where a ramp is most informative, and it is
 * invisible in a unit test that only checks cell colors.
 *
 * So when a scalar layer is magnified past
 * {@link SCREEN_SPACE_PIXELS_PER_CELL}, this rasterizes in screen space: each
 * screen pixel bilinearly samples the *value* plane through the same NaN-aware
 * kernel the GPU uses, and only then looks up a color. Legacy precolored RGB
 * remains a premultiplied-alpha canvas resample. Scale-aware RGB needs
 * linear-sRGB composition, so it runs the explicit CPU reference per pixel.
 */
export class Canvas2DGridBackend implements GridRenderBackend {
  readonly kind = 'canvas2d' as const
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly mode: 'scalar' | 'rgb'
  private style: GridStyle
  private lut: Uint8Array | null = null
  private viewport: GridViewport | null = null
  private lastGoodViewport: GridViewport | null = null
  private opacity = 0.75
  private canvasWidth = 0
  private canvasHeight = 0
  private stencil: HTMLCanvasElement | null = null
  private stencilBBox: GridBBox | null = null
  private lastRaster: HTMLCanvasElement | null = null
  private lastRasterKey = ''
  private lastScreenKey = ''
  private destroyed = false

  static create(options: CreateBackendOptions): Canvas2DGridBackend {
    if (typeof document === 'undefined') {
      throw new Error('Canvas2DGridBackend requires a DOM document')
    }
    const canvas = document.createElement('canvas')
    canvas.className = options.className ?? 'temporal-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas2D context unavailable')
    return new Canvas2DGridBackend(canvas, context, options)
  }

  private constructor(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    options: CreateBackendOptions,
  ) {
    this.canvas = canvas
    this.context = context
    this.mode = options.mode
    this.style = options.style
    this.opacity = options.style.opacity ?? 0.75
    this.canvas.style.opacity = String(this.opacity)
  }

  element(): HTMLCanvasElement {
    return this.canvas
  }

  setOpacity(opacity: number): void {
    this.opacity = Math.max(0, Math.min(1, opacity))
    this.canvas.style.opacity = String(this.opacity)
  }

  setViewport(viewport: GridViewport | null): void {
    this.viewport = viewport
    if (isUsableViewport(viewport)) this.lastGoodViewport = viewport
  }

  setStyle(style: GridStyle): void {
    this.style = style
    if (style.opacity !== undefined) this.setOpacity(style.opacity)
    this.lut = null
    this.lastRaster = null
    this.lastRasterKey = ''
    this.lastScreenKey = ''
  }

  setCoastlineStencil(image: HTMLCanvasElement | null, stencilBBox: GridBBox | null): void {
    this.stencil = image
    this.stencilBBox = stencilBBox
    this.lastScreenKey = ''
  }

  render(state: GridBackendRenderState): void {
    if (this.destroyed) return
    if (!this.canvas.parentElement) return
    const viewport = isUsableViewport(this.viewport) ? this.viewport : this.lastGoodViewport
    if (!isUsableViewport(viewport)) return

    const lower = toGridFrame(state.lower)
    const upper = toGridFrame(state.upper)
    if (lower.renderMode !== this.mode || upper.renderMode !== this.mode) return
    if (this.mode === 'scalar' && lower.valueKind !== upper.valueKind) return

    const progress = Math.max(0, Math.min(1, state.progress))
    const anchor = state.bboxAnchor ?? defaultBBoxAnchor(lower.valueKind)
    const size = this.ensureSize()
    if (!size) return

    const lowerComposed = lower.rgbComposition !== undefined
    const upperComposed = upper.rgbComposition !== undefined
    if (this.mode === 'rgb' && lowerComposed !== upperComposed) {
      this.clear()
      return
    }
    if (this.mode === 'rgb' && lowerComposed && upperComposed) {
      this.renderRgbCompositionScreen(
        lower,
        upper,
        progress,
        state.bbox,
        anchor,
        viewport,
        size.rect.width,
        size.rect.height,
        size.dpr,
      )
      return
    }

    if (
      this.mode === 'scalar' &&
      this.shouldUseScreenSpace(lower, state.bbox, viewport, size.rect)
    ) {
      this.renderScreenSpace(lower, upper, progress, state.bbox, anchor, viewport, size.dpr)
      return
    }

    const key = [
      this.frameKey(lower),
      this.frameKey(upper),
      progress.toFixed(4),
      this.styleKey(),
    ].join('|')
    if (!this.lastRaster || this.lastRasterKey !== key) {
      this.lastRaster =
        lower === upper || progress === 0
          ? this.rasterize(lower)
          : progress >= 1
            ? this.rasterize(upper)
            : this.rasterizeBlend(lower, upper, progress)
      this.lastRasterKey = key
    }
    this.lastScreenKey = ''
    this.blit(this.lastRaster, state.bbox, viewport, size.rect, size.dpr)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.canvas.remove()
  }

  private frameKey(frame: GridFrame): string {
    return frameCacheKey(frame)
  }

  /**
   * The range the ramp is spread over — the stretch, or the wire domain when
   * there is none. Never the range an `encoded-u16` sample is decoded through;
   * {@link Canvas2DGridBackend.displayValue} keeps that one.
   */
  private effectiveDisplayRange(): GridValueRange {
    return this.style.displayRange ?? this.style.valueRange
  }

  /**
   * The style component of the raster cache key.
   *
   * The display range is included as **defense in depth, not as the invalidation
   * mechanism** — being precise about that, because the comment this replaces
   * claimed otherwise and was wrong. Every style change arrives through
   * {@link Canvas2DGridBackend.setStyle}, which drops the cached raster and both
   * keys outright, so no two keys compared against each other are ever built
   * from different styles. What this line actually buys is that the key stays
   * honest if that clearing is ever relaxed; today it cannot be reached, and a
   * test asserting otherwise would be asserting nothing.
   */
  private styleKey(): string {
    const { valueRange, scale, sampling } = this.style
    const display = this.effectiveDisplayRange()
    const stops = resolveRampStops(this.style)
    return [
      scale,
      `${valueRange.lowerBound}:${valueRange.upperBound}`,
      `${display.lowerBound}:${display.upperBound}`,
      stops.length,
      sampling ?? 'soft',
    ].join('|')
  }

  private ensureLut(): Uint8Array {
    if (!this.lut) this.lut = styleLut(this.style)
    return this.lut
  }

  private referenceStyle(): ReferenceScalarStyle {
    return {
      stops: resolveRampStops(this.style),
      valueRange: this.style.valueRange,
      scale: styleScale(this.style),
      ...(this.style.displayRange !== undefined ? { displayRange: this.style.displayRange } : {}),
      ...(this.style.sampling !== undefined ? { sampling: this.style.sampling } : {}),
    }
  }

  private ensureSize(): { rect: DOMRect; dpr: number } | null {
    const parent = this.canvas.parentElement
    if (!parent) return null
    const rect = parent.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr))
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr))
    if (pixelWidth !== this.canvasWidth || pixelHeight !== this.canvasHeight) {
      this.canvas.width = pixelWidth
      this.canvas.height = pixelHeight
      this.canvasWidth = pixelWidth
      this.canvasHeight = pixelHeight
      this.canvas.style.width = `${rect.width}px`
      this.canvas.style.height = `${rect.height}px`
      this.lastScreenKey = ''
    }
    return { rect, dpr }
  }

  private shouldUseScreenSpace(
    frame: GridFrame,
    bbox: GridBBox,
    viewport: GridViewport,
    rect: DOMRect,
  ): boolean {
    if (frame.width < 1 || frame.height < 1) return false
    const [west, south, east, north] = bbox
    const perCellX = (((east - west) / viewport.span.longitudeDelta) * rect.width) / frame.width
    const perCellY = (((north - south) / viewport.span.latitudeDelta) * rect.height) / frame.height
    return Math.max(perCellX, perCellY) > SCREEN_SPACE_PIXELS_PER_CELL
  }

  /**
   * Rasterize one screen pixel at a time, sampling values and coloring after.
   *
   * The loop is bounded to the pixels the data bbox actually covers, solved
   * from the UV transform rather than tested per pixel, because the fallback
   * backend running a full-screen JavaScript loop over a layer occupying a
   * corner of the viewport is the difference between usable and not.
   */
  private renderScreenSpace(
    lower: GridFrame,
    upper: GridFrame,
    progress: number,
    bbox: GridBBox,
    anchor: GridBBoxAnchor,
    viewport: GridViewport,
    dpr: number,
  ): void {
    const width = this.canvasWidth
    const height = this.canvasHeight
    const key = [
      this.frameKey(lower),
      this.frameKey(upper),
      progress.toFixed(4),
      this.styleKey(),
      anchor,
      `${width}x${height}`,
      `${viewport.center.longitude},${viewport.center.latitude}`,
      `${viewport.span.longitudeDelta},${viewport.span.latitudeDelta}`,
      bbox.join(','),
    ].join('|')
    if (key === this.lastScreenKey) return

    const { uvOffsetX, uvOffsetY, uvScaleX, uvScaleY } = dataUvTransform(viewport, bbox)
    const image = new ImageData(width, height)
    const lut = this.ensureLut()
    const style = this.referenceStyle()
    const layer = toReferenceLayer(lower)
    const blend = lower === upper ? undefined : { upper: toReferenceLayer(upper), progress }

    const [pxMin, pxMax] = pixelSpan(uvOffsetX, uvScaleX, width)
    const [pyMin, pyMax] = pixelSpan(uvOffsetY, uvScaleY, height)

    for (let py = pyMin; py <= pyMax; py += 1) {
      const v = uvOffsetY + ((py + 0.5) / height) * uvScaleY
      if (v < 0 || v > 1) continue
      const gy = texelPositionFromUv(v, lower.height, anchor)
      for (let px = pxMin; px <= pxMax; px += 1) {
        const u = uvOffsetX + ((px + 0.5) / width) * uvScaleX
        if (u < 0 || u > 1) continue
        const gx = texelPositionFromUv(u, lower.width, anchor)
        const rgba = referenceScalarPixel(layer, lut, style, gx, gy, blend)
        if (rgba[3] <= 0) continue
        const offset = (py * width + px) * 4
        image.data[offset] = Math.round(rgba[0])
        image.data[offset + 1] = Math.round(rgba[1])
        image.data[offset + 2] = Math.round(rgba[2])
        image.data[offset + 3] = Math.round(rgba[3])
      }
    }

    this.context.setTransform(1, 0, 0, 1, 0, 0)
    this.context.clearRect(0, 0, width, height)
    // putImageData writes device pixels and ignores the transform, which is
    // exactly what is wanted: the raster was built at device resolution.
    this.context.putImageData(image, 0, 0)
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.clipToStencil(viewport)
    this.lastScreenKey = key
    this.lastRasterKey = ''
  }

  /**
   * Render scale-aware RGB per device pixel through the shared CPU reference.
   *
   * The legacy RGB fallback intentionally keeps its fast premultiplied-alpha
   * `drawImage` contract. The additive composition cannot use that shortcut:
   * Canvas would blend display-sRGB colors, while WebGL composes both detail
   * and time in linear-sRGB. Running the reference here makes the new path
   * exact across the two backends without moving a legacy pixel.
   */
  private renderRgbCompositionScreen(
    lower: GridFrame,
    upper: GridFrame,
    progress: number,
    bbox: GridBBox,
    anchor: GridBBoxAnchor,
    viewport: GridViewport,
    cssWidth: number,
    cssHeight: number,
    dpr: number,
  ): void {
    const lowerLayer = toReferenceRgbCompositionLayer(lower)
    const upperLayer = toReferenceRgbCompositionLayer(upper)
    if (!lowerLayer || !upperLayer) {
      this.clear()
      return
    }
    const compositionVersion = lower.rgbComposition?.version ?? 'base-observed-confidence-v1'
    const upperCompositionVersion = upper.rgbComposition?.version ?? 'base-observed-confidence-v1'
    if (compositionVersion !== upperCompositionVersion) {
      this.clear()
      return
    }
    const width = this.canvasWidth
    const height = this.canvasHeight
    const zoom = viewportZoom(viewport, cssWidth)
    const observationWeight = observationWeightForZoom(zoom, compositionVersion)
    const supportModulatesWeight = observationSupportModulatesWeight(zoom, compositionVersion)
    const key = [
      this.frameKey(lower),
      this.frameKey(upper),
      progress.toFixed(4),
      this.styleKey(),
      anchor,
      `rgb-composition:${compositionVersion}:${observationWeight}:${supportModulatesWeight}`,
      `${width}x${height}`,
      `${cssWidth}x${cssHeight}css`,
      `${viewport.center.longitude},${viewport.center.latitude}`,
      `${viewport.span.longitudeDelta},${viewport.span.latitudeDelta}`,
      bbox.join(','),
    ].join('|')
    if (key === this.lastScreenKey) return

    const { uvOffsetX, uvOffsetY, uvScaleX, uvScaleY } = dataUvTransform(viewport, bbox)
    const image = new ImageData(width, height)
    const style: ReferenceRgbCompositionStyle = {
      observationWeight,
      supportModulatesWeight,
      sampling: styleSampling(this.style, 'rgb'),
    }
    const blend = lower === upper ? undefined : { upper: upperLayer, progress }
    const [pxMin, pxMax] = pixelSpan(uvOffsetX, uvScaleX, width)
    const [pyMin, pyMax] = pixelSpan(uvOffsetY, uvScaleY, height)

    for (let py = pyMin; py <= pyMax; py += 1) {
      const v = uvOffsetY + ((py + 0.5) / height) * uvScaleY
      if (v < 0 || v > 1) continue
      const gy = texelPositionFromUv(v, lower.height, anchor)
      for (let px = pxMin; px <= pxMax; px += 1) {
        const u = uvOffsetX + ((px + 0.5) / width) * uvScaleX
        if (u < 0 || u > 1) continue
        const gx = texelPositionFromUv(u, lower.width, anchor)
        const cssColumn = Math.floor(((px + 0.5) / width) * cssWidth)
        const cssRow = Math.floor(((py + 0.5) / height) * cssHeight)
        const overviewArea = supportModulatesWeight
          ? areaSampleBoundsFromUv(
              uvOffsetX + (cssColumn / cssWidth) * uvScaleX,
              uvOffsetY + (cssRow / cssHeight) * uvScaleY,
              uvOffsetX + ((cssColumn + 1) / cssWidth) * uvScaleX,
              uvOffsetY + ((cssRow + 1) / cssHeight) * uvScaleY,
              lower.width,
              lower.height,
              anchor,
            )
          : undefined
        const upperOverviewArea = supportModulatesWeight
          ? areaSampleBoundsFromUv(
              uvOffsetX + (cssColumn / cssWidth) * uvScaleX,
              uvOffsetY + (cssRow / cssHeight) * uvScaleY,
              uvOffsetX + ((cssColumn + 1) / cssWidth) * uvScaleX,
              uvOffsetY + ((cssRow + 1) / cssHeight) * uvScaleY,
              upper.width,
              upper.height,
              anchor,
            )
          : undefined
        const rgba = referenceRgbCompositionPixel(
          lowerLayer,
          style,
          gx,
          gy,
          blend,
          overviewArea,
          upperOverviewArea,
        )
        if (rgba[3] <= 0) continue
        const offset = (py * width + px) * 4
        image.data[offset] = Math.round(rgba[0])
        image.data[offset + 1] = Math.round(rgba[1])
        image.data[offset + 2] = Math.round(rgba[2])
        image.data[offset + 3] = Math.round(rgba[3])
      }
    }

    this.context.setTransform(1, 0, 0, 1, 0, 0)
    this.context.clearRect(0, 0, width, height)
    this.context.putImageData(image, 0, 0)
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.clipToStencil(viewport)
    this.lastScreenKey = key
    this.lastRasterKey = ''
    this.lastRaster = null
  }

  private clear(): void {
    this.context.setTransform(1, 0, 0, 1, 0, 0)
    this.context.clearRect(0, 0, Math.max(1, this.canvasWidth), Math.max(1, this.canvasHeight))
    this.lastScreenKey = ''
    this.lastRasterKey = ''
    this.lastRaster = null
  }

  private blit(
    image: HTMLCanvasElement,
    bbox: GridBBox,
    viewport: GridViewport,
    rect: DOMRect,
    dpr: number,
  ): void {
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.context.clearRect(0, 0, rect.width, rect.height)
    const span = viewport.span
    const [west, south, east, north] = bbox
    const x =
      ((west - (viewport.center.longitude - span.longitudeDelta / 2)) / span.longitudeDelta) *
      rect.width
    const y =
      ((viewport.center.latitude + span.latitudeDelta / 2 - north) / span.latitudeDelta) *
      rect.height
    const width = ((east - west) / span.longitudeDelta) * rect.width
    const height = ((north - south) / span.latitudeDelta) * rect.height
    this.context.drawImage(image, x, y, width, height)
    this.clipToStencil(viewport)
  }

  private clipToStencil(viewport: GridViewport): void {
    const stencil = this.stencil
    const stencilBBox = this.stencilBBox
    if (!stencil || !stencilBBox) return
    const [stencilWest, stencilSouth, stencilEast, stencilNorth] = stencilBBox
    const span = viewport.span
    const viewportWest = viewport.center.longitude - span.longitudeDelta / 2
    const viewportNorth = viewport.center.latitude + span.latitudeDelta / 2
    const rect = this.canvas.getBoundingClientRect()
    const sx = ((stencilWest - viewportWest) / span.longitudeDelta) * rect.width
    const sy = ((viewportNorth - stencilNorth) / span.latitudeDelta) * rect.height
    const sw = ((stencilEast - stencilWest) / span.longitudeDelta) * rect.width
    const sh = ((stencilNorth - stencilSouth) / span.latitudeDelta) * rect.height
    // Match WebGL: alpha 0 everywhere outside the stencil geo bbox.
    // Build a full-viewport alpha mask that is only non-zero under the stencil.
    const mask = document.createElement('canvas')
    mask.width = Math.max(1, Math.round(rect.width))
    mask.height = Math.max(1, Math.round(rect.height))
    const maskCtx = mask.getContext('2d')
    if (!maskCtx) return
    maskCtx.clearRect(0, 0, mask.width, mask.height)
    if (sw > 0 && sh > 0) {
      maskCtx.filter = 'blur(1px)'
      maskCtx.drawImage(stencil, sx, sy, sw, sh)
      maskCtx.filter = 'none'
    }
    this.context.save()
    this.context.globalCompositeOperation = 'destination-in'
    this.context.drawImage(mask, 0, 0, rect.width, rect.height)
    this.context.restore()
  }

  private rasterize(frame: GridFrame): HTMLCanvasElement {
    const image = new ImageData(frame.width, frame.height)
    if (frame.renderMode === 'rgb' && frame.channels) {
      for (let i = 0; i < frame.channels[0].length; i += 1) {
        const offset = i * 4
        if (!frame.mask[i]) {
          image.data[offset + 3] = 0
          continue
        }
        image.data[offset] = frame.channels[0][i] ?? 0
        image.data[offset + 1] = frame.channels[1][i] ?? 0
        image.data[offset + 2] = frame.channels[2][i] ?? 0
        image.data[offset + 3] = 255
      }
    } else {
      for (let i = 0; i < frame.values.length; i += 1) {
        const offset = i * 4
        if (!frame.mask[i]) {
          image.data[offset + 3] = 0
          continue
        }
        this.writeColor(image.data, offset, this.displayValue(frame, frame.values[i] ?? 0))
      }
    }
    return toCanvas(image, frame.width, frame.height)
  }

  private rasterizeBlend(lower: GridFrame, upper: GridFrame, progress: number): HTMLCanvasElement {
    const image = new ImageData(lower.width, lower.height)
    if (
      lower.renderMode === 'rgb' &&
      upper.renderMode === 'rgb' &&
      lower.channels &&
      upper.channels
    ) {
      for (let i = 0; i < lower.channels[0].length; i += 1) {
        const offset = i * 4
        const lowerValid = Boolean(lower.mask[i])
        const upperValid = Boolean(upper.mask[i])
        if (!lowerValid && !upperValid) {
          image.data[offset + 3] = 0
          continue
        }
        for (let channel = 0; channel < 3; channel += 1) {
          const first = lowerValid
            ? (lower.channels[channel]![i] ?? 0)
            : (upper.channels[channel]![i] ?? 0)
          const second = upperValid
            ? (upper.channels[channel]![i] ?? 0)
            : (lower.channels[channel]![i] ?? 0)
          image.data[offset + channel] = Math.round(first + (second - first) * progress)
        }
        image.data[offset + 3] = 255
      }
    } else {
      for (let i = 0; i < lower.values.length; i += 1) {
        const lowerValid = Boolean(lower.mask[i])
        const upperValid = Boolean(upper.mask[i])
        const offset = i * 4
        if (!lowerValid && !upperValid) {
          image.data[offset + 3] = 0
          continue
        }
        const lowerValue = lowerValid ? (lower.values[i] ?? 0) : (upper.values[i] ?? 0)
        const upperValue = upperValid ? (upper.values[i] ?? 0) : (lower.values[i] ?? 0)
        this.writeColor(
          image.data,
          offset,
          this.displayValue(lower, blendEncoded(lowerValue, upperValue, progress)),
        )
      }
    }
    return toCanvas(image, lower.width, lower.height)
  }

  private displayValue(frame: GridFrame, raw: number): number {
    return frame.valueKind === 'float32'
      ? raw
      : displayValueFromEncoded(raw, this.style.valueRange, this.style.scale)
  }

  /**
   * Color one cell through the same baked LUT the magnified path and the GPU
   * use, so the two Canvas2D paths cannot disagree about a ramp.
   */
  private writeColor(data: Uint8ClampedArray, offset: number, value: number): void {
    // `normalizeValue` throws on a degenerate range, and this runs inside the
    // frame loop: a bad style has to draw nothing, not take the frame down with
    // it. `isDrawableRange` documents why the test is `!(lo < hi)`.
    const displayRange = this.effectiveDisplayRange()
    if (!isDrawableRange(this.style.valueRange) || !isDrawableRange(displayRange)) {
      data[offset + 3] = 0
      return
    }
    const position = normalizeValue(value, displayRange, styleScale(this.style))
    if (position === null) {
      data[offset + 3] = 0
      return
    }
    const rgba = sampleLutLinear(this.ensureLut(), position)
    data[offset] = Math.round(rgba[0])
    data[offset + 1] = Math.round(rgba[1])
    data[offset + 2] = Math.round(rgba[2])
    data[offset + 3] = Math.round(rgba[3])
  }
}

function toReferenceLayer(frame: GridFrame): ReferenceScalarLayer {
  return {
    values: frame.values,
    mask: frame.mask,
    width: frame.width,
    height: frame.height,
    valueKind: frame.valueKind,
  }
}

function toReferenceRgbCompositionLayer(frame: GridFrame): ReferenceRgbCompositionLayer | null {
  const composition = frame.rgbComposition
  if (!composition) return null
  const pixelCount = frame.width * frame.height
  const planes = [
    ...composition.baseChannels,
    ...composition.observedChannels,
    composition.confidence,
    composition.baseMask,
    composition.observedMask,
  ]
  if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0) return null
  if (planes.some((plane) => plane.length !== pixelCount)) return null
  return {
    baseChannels: composition.baseChannels,
    observedChannels: composition.observedChannels,
    confidence: composition.confidence,
    baseMask: composition.baseMask,
    observedMask: composition.observedMask,
    width: frame.width,
    height: frame.height,
  }
}

/** The inclusive pixel range whose data UV lands inside `0…1`. */
function pixelSpan(offset: number, scale: number, extent: number): [number, number] {
  if (!(scale > 0)) return [0, extent - 1]
  const low = Math.floor((-offset / scale) * extent - 0.5)
  const high = Math.ceil(((1 - offset) / scale) * extent - 0.5)
  return [Math.max(0, low), Math.min(extent - 1, high)]
}

function toCanvas(image: ImageData, width: number, height: number): HTMLCanvasElement {
  const offscreen = document.createElement('canvas')
  offscreen.width = width
  offscreen.height = height
  offscreen.getContext('2d')?.putImageData(image, 0, 0)
  return offscreen
}
