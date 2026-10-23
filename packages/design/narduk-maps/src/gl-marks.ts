import { markDiscs, markReach, resolveMarkColor } from './marks'

import type { MapMetrics, MapTokens, MarkShape } from './types'

/**
 * The marks as GL symbol images. A symbol takes part in MapLibre's collision detection, a
 * circle layer does not, so drawing pins as symbols is what lets the basemap's place names
 * move off them. The picture is the same stacked discs the SVG draws, rasterised once per
 * (shape, colour, size) on a canvas at pixel ratio 2.
 */

export interface MarkImageDisc {
  r: number
  fill: string
  ring?: { color: string; width: number; dash?: [number, number] }
}

export interface MarkImage {
  /** Registered with `map.addImage`; encodes everything that changes the picture. */
  id: string
  /** Side of the square image in CSS pixels. */
  size: number
  discs: MarkImageDisc[]
}

export const MARK_PIXEL_RATIO = 2

const hex = (value: string) => value.replaceAll(/[^\da-z]/gi, '')

export function markImage(
  shape: MarkShape,
  color: string,
  highlighted: boolean,
  tokens: MapTokens,
  metrics: MapMetrics,
): MarkImage {
  const point = { color }
  const discs = markDiscs(shape, highlighted, metrics).map<MarkImageDisc>(disc => ({
    r: disc.r,
    fill: resolveMarkColor(disc.fill, point, tokens),
    ...(disc.ring
      ? {
          ring: {
            color: resolveMarkColor(disc.ring.color, point, tokens),
            width: disc.ring.width,
            ...(disc.ring.dash ? { dash: disc.ring.dash } : {}),
          },
        }
      : {}),
  }))
  // Even, with a pixel of slack, so the picture sits on the pixel grid at ratio 2.
  const size = Math.ceil(markReach(shape, highlighted, metrics)) * 2 + 2
  const key = [color, tokens.markRing, tokens.markCore, tokens.hatch].map(hex).join('-')
  return { id: `nm-mark-${shape}${highlighted ? '-hl' : ''}-${size}-${key}`, size, discs }
}

/** Draw a mark image to RGBA pixels. Browser only: it needs a canvas. */
export function renderMark(image: MarkImage, pixelRatio = MARK_PIXEL_RATIO): ImageData | null {
  if (typeof document === 'undefined') return null
  const px = image.size * pixelRatio
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.scale(pixelRatio, pixelRatio)
  const c = image.size / 2
  for (const disc of image.discs) {
    if (disc.ring) {
      // A ring sits outside the disc's radius: a stroke twice as wide, painted under the fill.
      ctx.beginPath()
      ctx.arc(c, c, disc.r, 0, Math.PI * 2)
      ctx.lineWidth = disc.ring.width * 2
      ctx.strokeStyle = disc.ring.color
      ctx.setLineDash(disc.ring.dash ?? [])
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.beginPath()
    ctx.arc(c, c, disc.r, 0, Math.PI * 2)
    ctx.fillStyle = disc.fill
    ctx.fill()
  }
  return ctx.getImageData(0, 0, px, px)
}
