import { displayValueFromEncoded } from '../core/math.js'
import { sampleRamp } from '../core/color.js'
import { isUsableViewport, type GridBBox, type GridViewport } from '../core/models.js'
import type { TemporalRasterFrame } from '../core/decode/temporal.js'
import type {
  CreateBackendOptions,
  GridBackendRenderState,
  GridRenderBackend,
  GridStyle,
} from './types.js'

/**
 * Canvas2D fallback: CPU colorize + viewport blit.
 * Used when WebGL2 is unavailable.
 */
export class Canvas2DGridBackend implements GridRenderBackend {
  readonly kind = 'canvas2d' as const
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private style: GridStyle
  private viewport: GridViewport | null = null
  private lastGoodViewport: GridViewport | null = null
  private opacity = 0.75
  private canvasWidth = 0
  private canvasHeight = 0
  private stencil: HTMLCanvasElement | null = null
  private stencilBBox: GridBBox | null = null
  private lastRaster: HTMLCanvasElement | null = null
  private lastRasterKey = ''
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
    this.lastRaster = null
    this.lastRasterKey = ''
  }

  setCoastlineStencil(image: HTMLCanvasElement | null, stencilBBox: GridBBox | null): void {
    this.stencil = image
    this.stencilBBox = stencilBBox
  }

  render(state: GridBackendRenderState): void {
    if (this.destroyed) return
    if (!this.canvas.parentElement) return
    const viewport = isUsableViewport(this.viewport) ? this.viewport : this.lastGoodViewport
    if (!isUsableViewport(viewport)) return

    const progress = Math.max(0, Math.min(1, state.progress))
    const key = `${state.lower.date}|${state.upper.date}|${progress.toFixed(4)}|${this.style.scale}|${this.style.valueRange.lowerBound}:${this.style.valueRange.upperBound}|${this.style.ramp.length}`
    if (!this.lastRaster || this.lastRasterKey !== key) {
      this.lastRaster =
        state.lower === state.upper || progress === 0
          ? this.rasterize(state.lower)
          : progress >= 1
            ? this.rasterize(state.upper)
            : this.rasterizeBlend(state.lower, state.upper, progress)
      this.lastRasterKey = key
    }
    this.blit(this.lastRaster, state.bbox, viewport)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.canvas.remove()
  }

  private blit(image: HTMLCanvasElement, bbox: GridBBox, viewport: GridViewport): void {
    const parent = this.canvas.parentElement
    if (!parent) return
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
    }
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.context.clearRect(0, 0, rect.width, rect.height)
    const span = viewport.span
    const [west, south, east, north] = bbox
    const x = ((west - (viewport.center.longitude - span.longitudeDelta / 2)) / span.longitudeDelta) * rect.width
    const y = ((viewport.center.latitude + span.latitudeDelta / 2 - north) / span.latitudeDelta) * rect.height
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
    if (sw <= 0 || sh <= 0 || sx > rect.width || sy > rect.height || sx + sw < 0 || sy + sh < 0) return
    this.context.save()
    this.context.globalCompositeOperation = 'destination-in'
    this.context.filter = 'blur(1px)'
    this.context.drawImage(stencil, sx, sy, sw, sh)
    this.context.restore()
  }

  private rasterize(frame: TemporalRasterFrame): HTMLCanvasElement {
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
      const values = frame.values instanceof Uint16Array ? frame.values : new Uint16Array(frame.values)
      for (let i = 0; i < frame.values.length; i += 1) {
        const offset = i * 4
        if (!frame.mask[i]) {
          image.data[offset + 3] = 0
          continue
        }
        const color = this.colorFor(values[i] ?? 0)
        image.data[offset] = color[0]
        image.data[offset + 1] = color[1]
        image.data[offset + 2] = color[2]
        image.data[offset + 3] = 255
      }
    }
    const offscreen = document.createElement('canvas')
    offscreen.width = frame.width
    offscreen.height = frame.height
    offscreen.getContext('2d')?.putImageData(image, 0, 0)
    return offscreen
  }

  private rasterizeBlend(
    lower: TemporalRasterFrame,
    upper: TemporalRasterFrame,
    progress: number,
  ): HTMLCanvasElement {
    const image = new ImageData(lower.width, lower.height)
    if (lower.renderMode === 'rgb' && upper.renderMode === 'rgb' && lower.channels && upper.channels) {
      for (let i = 0; i < lower.channels[0].length; i += 1) {
        const offset = i * 4
        const lowerValid = Boolean(lower.mask[i])
        const upperValid = Boolean(upper.mask[i])
        if (!lowerValid && !upperValid) {
          image.data[offset + 3] = 0
          continue
        }
        for (let channel = 0; channel < 3; channel += 1) {
          const first = lowerValid ? lower.channels[channel]![i] ?? 0 : upper.channels[channel]![i] ?? 0
          const second = upperValid ? upper.channels[channel]![i] ?? 0 : lower.channels[channel]![i] ?? 0
          image.data[offset + channel] = Math.round(first + (second - first) * progress)
        }
        image.data[offset + 3] = 255
      }
    } else {
      const lowerValues =
        lower.values instanceof Uint16Array ? lower.values : new Uint16Array(lower.values)
      const upperValues =
        upper.values instanceof Uint16Array ? upper.values : new Uint16Array(upper.values)
      for (let i = 0; i < lower.values.length; i += 1) {
        const lowerValid = Boolean(lower.mask[i])
        const upperValid = Boolean(upper.mask[i])
        const offset = i * 4
        if (!lowerValid && !upperValid) {
          image.data[offset + 3] = 0
          continue
        }
        const lowerValue = lowerValid ? lowerValues[i] ?? 0 : upperValues[i] ?? 0
        const upperValue = upperValid ? upperValues[i] ?? 0 : lowerValues[i] ?? 0
        const value = lowerValue + (upperValue - lowerValue) * progress
        const color = this.colorFor(value)
        image.data[offset] = color[0]
        image.data[offset + 1] = color[1]
        image.data[offset + 2] = color[2]
        image.data[offset + 3] = 255
      }
    }
    const offscreen = document.createElement('canvas')
    offscreen.width = lower.width
    offscreen.height = lower.height
    offscreen.getContext('2d')?.putImageData(image, 0, 0)
    return offscreen
  }

  private colorFor(encoded: number): [number, number, number] {
    const value = displayValueFromEncoded(encoded, this.style.valueRange, this.style.scale)
    const rgb = sampleRamp(this.style.ramp, value)
    return [rgb[0], rgb[1], rgb[2]]
  }
}
