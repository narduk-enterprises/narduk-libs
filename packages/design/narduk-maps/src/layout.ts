import { labelAnchor, placeLabels, type LabelInput, type PlacedLabel } from './labels'
import { markDiscs, markReach, type MarkDisc } from './marks'
import { projectGeometry, type ProjectedGeometry, type ViewPoint } from './projection'

import type {
  LabelMode,
  MapMetrics,
  MapPoint,
  MapView,
  CutoutLabel,
  ShapeCollection,
  ShapeFeature,
} from './types'

/** Layout shared by the SVG map and the GL map's labels, so both place names the same way. */

export interface DrawnShape {
  id: string
  name: string
  feature: ShapeFeature
  d: string
  anchor: ViewPoint | null
}

export interface DrawnPoint {
  point: MapPoint
  x: number
  y: number
  highlighted: boolean
  discs: MarkDisc[]
  reach: number
}

const anchorCache = new WeakMap<ProjectedGeometry, ViewPoint | null>()

function anchorOf(geo: ProjectedGeometry): ViewPoint | null {
  if (!anchorCache.has(geo)) anchorCache.set(geo, labelAnchor(geo.polygons))
  return anchorCache.get(geo) ?? null
}

export function shapeId(feature: ShapeFeature, idKey: string, index: number): string {
  return String(feature.properties?.[idKey] ?? feature.id ?? index)
}

export function drawShapes(
  shapes: ShapeCollection | null | undefined,
  idKey: string,
  nameKey: string,
  view: MapView,
): DrawnShape[] {
  return (shapes?.features ?? []).map((feature, index) => {
    const id = shapeId(feature, idKey, index)
    const name = String(feature.properties?.[nameKey] ?? id)
    const geo = projectGeometry(feature.geometry, view)
    return { id, name, feature, d: geo.d, anchor: anchorOf(geo) }
  })
}

export function drawPoints(
  points: MapPoint[],
  highlight: string | null | undefined,
  view: MapView,
  metrics: MapMetrics,
): DrawnPoint[] {
  const list = points.map(point => {
    const [x, y] = view.project(point.lon, point.lat)
    const highlighted = point.id === highlight
    return {
      point,
      x,
      y,
      highlighted,
      discs: markDiscs(point.shape, highlighted, metrics),
      reach: markReach(point.shape, highlighted, metrics),
    }
  })
  // The highlighted mark draws last, on top.
  return [...list.filter(p => !p.highlighted), ...list.filter(p => p.highlighted)]
}

export interface LabelLayoutInput {
  drawn: DrawnShape[]
  points: DrawnPoint[]
  labels: LabelMode
  plain: boolean
  levelText: Record<string, string> | undefined
  view: MapView
  metrics: MapMetrics
  /** Names baked into a cutout: placed after the caller's own, dropped on any clash. */
  basemapLabels?: CutoutLabel[]
}

export function layoutLabels(input: LabelLayoutInput): PlacedLabel[] {
  const { labels, plain, levelText, view, metrics } = input
  const items: LabelInput[] =
    labels === 'none'
      ? []
      : labels === 'shapes'
        ? input.drawn.flatMap(s => {
            if (!s.anchor) return []
            const text = levelText?.[s.id]
            return [
              {
                id: s.id,
                text: s.name,
                x: s.anchor[0],
                y: s.anchor[1],
                ...(plain && text ? { sub: [text] } : {}),
              },
            ]
          })
        : labels.map((l, i) => {
            const [x, y] = view.project(l.lon, l.lat)
            return { id: `label-${i}`, text: l.text, x, y }
          })
  const baked: LabelInput[] = [...(input.basemapLabels ?? [])]
    .sort((a, b) => a.rank - b.rank)
    .map((l, i) => ({
      id: `bm-${i}`,
      text: l.text,
      x: l.x,
      y: l.y,
      kind: l.kind,
      fontSize: metrics.bmLabelSize,
      charWidth: metrics.bmLabelCharWidth,
      optional: true,
    }))
  return placeLabels(
    [...items, ...baked],
    input.points.map(p => ({ x: p.x, y: p.y, r: p.reach })),
    {
      width: view.width,
      height: view.height,
      fontSize: metrics.labelSize,
      charWidth: metrics.labelCharWidth,
    },
  )
}
