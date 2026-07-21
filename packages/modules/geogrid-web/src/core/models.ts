/** Matches GeoGridKit `GridScale`. */
export type GridScale = 'linear' | 'log'

/** V1 host modes: scalar field + optional precolored RGB. Vector is future. */
export type GridRenderMode = 'scalar' | 'rgb'

/** Matches GeoGridKit `GridValueRange` (array-coded on the wire as [lo, hi]). */
export interface GridValueRange {
  lowerBound: number
  upperBound: number
}

/** [west, south, east, north] degrees. Dateline-crossing bboxes are unsupported in v1. */
export type GridBBox = readonly [west: number, south: number, east: number, north: number]

export interface GridViewport {
  center: { latitude: number; longitude: number }
  span: { latitudeDelta: number; longitudeDelta: number }
}

export interface ColorStop {
  value: number
  r: number
  g: number
  b: number
  a?: number
}

export interface ColorRamp {
  id?: string
  stops: readonly ColorStop[]
}

export function valueRangeFromTuple(range: readonly [number, number]): GridValueRange {
  return { lowerBound: range[0], upperBound: range[1] }
}

export function valueRangeToTuple(range: GridValueRange): [number, number] {
  return [range.lowerBound, range.upperBound]
}

export function isUsableViewport(viewport: GridViewport | null | undefined): viewport is GridViewport {
  if (!viewport) return false
  const { latitudeDelta, longitudeDelta } = viewport.span
  return (
    Number.isFinite(viewport.center.latitude) &&
    Number.isFinite(viewport.center.longitude) &&
    Number.isFinite(latitudeDelta) &&
    Number.isFinite(longitudeDelta) &&
    latitudeDelta > 0 &&
    longitudeDelta > 0
  )
}
