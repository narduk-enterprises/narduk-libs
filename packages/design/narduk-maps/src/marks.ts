import { mix } from './tokens'

import type { MapMetrics, MapPoint, MapTokens, MarkShape } from './types'

/**
 * The five mark shapes as a list of stacked discs, shared by the SVG and GL engines so both
 * draw the same picture. A disc's `ring` is a stroke that sits OUTSIDE its radius (the GL
 * circle-stroke convention), so `r` is always the visible size of the fill.
 */

export type MarkColor = 'color' | 'outline' | 'ring' | 'core' | 'hatch'

export interface MarkDisc {
  r: number
  fill: MarkColor
  ring?: { color: MarkColor; width: number; dash?: [number, number] }
}

export function markRadius(shape: MarkShape, highlighted: boolean, m: MapMetrics): number {
  if (highlighted) return m.markRadiusHighlight
  return shape === 'small' ? m.markRadiusSmall : m.markRadius
}

export function markDiscs(shape: MarkShape, highlighted: boolean, m: MapMetrics): MarkDisc[] {
  const r = markRadius(shape, highlighted, m)
  const surface = { color: 'ring', width: m.markRingWidth } as const
  switch (shape) {
    case 'dot':
      return [{ r, fill: 'color', ring: surface }]
    case 'ring':
      return [
        { r, fill: 'color', ring: surface },
        { r: Math.max(1, r - m.markBandWidth), fill: 'core' },
      ]
    case 'core':
      return [
        { r, fill: 'color', ring: surface },
        { r: r * m.markCoreRatio, fill: 'core' },
      ]
    case 'small':
      return [
        { r: r + m.markOutlineWidth, fill: 'outline', ring: surface },
        { r, fill: 'color' },
      ]
    case 'hollow':
      return [
        { r, fill: 'core', ring: surface },
        {
          r: Math.max(1, r - m.markDashWidth - 1),
          fill: 'core',
          ring: { color: 'hatch', width: m.markDashWidth, dash: m.markDash },
        },
      ]
  }
}

/** The outer radius of a mark including its surface ring: what a label must keep clear of. */
export function markReach(shape: MarkShape, highlighted: boolean, m: MapMetrics): number {
  const discs = markDiscs(shape, highlighted, m)
  return Math.max(...discs.map(d => d.r + (d.ring?.width ?? 0)))
}

/** A literal hex for each colour role, for engines that cannot read CSS custom properties. */
export function resolveMarkColor(
  role: MarkColor,
  point: Pick<MapPoint, 'color'>,
  t: MapTokens,
): string {
  switch (role) {
    case 'color':
      return point.color
    case 'outline':
      return mix(point.color, t.ink, 0.45)
    case 'ring':
      return t.markRing
    case 'core':
      return t.markCore
    case 'hatch':
      return t.hatch
  }
}
