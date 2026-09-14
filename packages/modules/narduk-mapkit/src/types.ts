export interface MapKitLatLng {
  lat: number
  lng: number
}

export interface MapKitSpan {
  lat: number
  lng: number
}

export interface MapKitRegionSnapshot {
  centerLat: number
  centerLng: number
  latDelta: number
  lngDelta: number
}

export interface MapKitScreenPoint {
  pageX: number
  pageY: number
  x: number
  y: number
}

export interface MapKitOverlayStyle {
  fillColor: string
  fillOpacity?: number
  fillRule?: 'evenodd' | 'nonzero'
  lineCap?: 'butt' | 'round' | 'square'
  lineDash?: number[]
  lineJoin?: 'bevel' | 'miter' | 'round'
  lineWidth: number
  strokeColor: string
  strokeOpacity?: number
}

export interface MapKitMarkerDrawable<TData = unknown> extends MapKitLatLng {
  clusterId?: string
  data?: TData
  id: string
  title?: string
}

export interface MapKitLineDrawable<TData = unknown> {
  coordinates: MapKitLatLng[]
  data?: TData
  enabled?: boolean
  id: string
  style?: Partial<MapKitOverlayStyle>
  title?: string
}

export interface MapKitPolygonDrawable<TData = unknown> {
  data?: TData
  enabled?: boolean
  id: string
  rings: MapKitLatLng[][]
  style?: Partial<MapKitOverlayStyle>
  title?: string
}

export interface MapKitCircleDrawable<TData = unknown> {
  center?: MapKitLatLng
  color?: string
  data?: TData
  enabled?: boolean
  id?: string
  lat?: number
  lng?: number
  opacity?: number
  radius: number
  style?: Partial<MapKitOverlayStyle>
  title?: string
}

export type MapKitDrawableKind = 'circle' | 'geojson' | 'line' | 'marker' | 'polygon'

export interface MapKitOverlaySelection<TData = unknown> {
  coordinate?: MapKitLatLng
  data?: TData
  feature?: unknown
  id: string
  kind: Exclude<MapKitDrawableKind, 'marker'>
}

export interface MapKitMarkerElementResult {
  cleanup?: () => void
  element: HTMLElement
}

export type MapKitMarkerElementFactory<
  TMarker extends MapKitMarkerDrawable = MapKitMarkerDrawable,
> = (marker: TMarker, isSelected: boolean) => MapKitMarkerElementResult

export type MapKitClusterElementFactory = (
  cluster: { coordinate: unknown; memberAnnotations: unknown[] },
  count: number,
) => HTMLElement

export interface MapKitComponentHandle {
  clearSelection: () => void
  getMap: () => unknown
  projectCoordinate: (coordinate: MapKitLatLng) => MapKitScreenPoint | null
  releaseUserTracking: () => void
  scrollIntoView: () => void
  setRegion: (center: MapKitLatLng, span?: MapKitSpan) => void
  showUserLocation: (options?: { select?: boolean; track?: boolean }) => unknown
  zoomToFit: (zoomOutLevels?: number) => void
}

export interface MapKitPoint {
  lat: number
  lng: number
}

export interface MapKitRegionSpan {
  latDelta: number
  lngDelta: number
}

export interface MapKitRegion {
  center: MapKitPoint
  span: MapKitRegionSpan
}

export interface MapKitDrawableBaseV2 {
  id?: string
  kind: 'marker' | 'line' | 'polygon' | 'circle' | 'geojson-feature'
  metadata?: Record<string, unknown>
  version: 2
}

export interface MapKitMarkerDrawableV2 extends MapKitDrawableBaseV2 {
  kind: 'marker'
  point: MapKitPoint
  subtitle?: string
  title?: string
}

export interface MapKitLineDrawableV2 extends MapKitDrawableBaseV2 {
  closed?: boolean
  distanceMetres?: number
  kind: 'line'
  points: readonly MapKitPoint[]
}

export interface MapKitPolygonDrawableV2 extends MapKitDrawableBaseV2 {
  kind: 'polygon'
  rings: ReadonlyArray<readonly MapKitPoint[]>
}

export interface MapKitCircleDrawableV2 extends MapKitDrawableBaseV2 {
  center: MapKitPoint
  kind: 'circle'
  radiusMetres: number
}

export type MapKitGeoJSONPositionV2 = Readonly<[lng: number, lat: number]>

export interface MapKitGeoJSONFeaturePropertiesV2 {
  [key: string]: unknown
  centerLat?: number | null
  centerLng?: number | null
  city?: string
  name?: string
  region?: string
  slug?: string
  source?: string
}

export interface MapKitGeoJSONPointGeometryV2 {
  coordinates: MapKitGeoJSONPositionV2
  type: 'Point'
}

export interface MapKitGeoJSONLineStringGeometryV2 {
  coordinates: readonly MapKitGeoJSONPositionV2[]
  type: 'LineString'
}

export interface MapKitGeoJSONMultiLineStringGeometryV2 {
  coordinates: ReadonlyArray<readonly MapKitGeoJSONPositionV2[]>
  type: 'MultiLineString'
}

export interface MapKitGeoJSONPolygonGeometryV2 {
  coordinates: ReadonlyArray<readonly MapKitGeoJSONPositionV2[]>
  type: 'Polygon'
}

export interface MapKitGeoJSONMultiPolygonGeometryV2 {
  coordinates: ReadonlyArray<ReadonlyArray<readonly MapKitGeoJSONPositionV2[]>>
  type: 'MultiPolygon'
}

export type MapKitGeoJSONGeometryV2 =
  | MapKitGeoJSONPointGeometryV2
  | MapKitGeoJSONLineStringGeometryV2
  | MapKitGeoJSONMultiLineStringGeometryV2
  | MapKitGeoJSONPolygonGeometryV2
  | MapKitGeoJSONMultiPolygonGeometryV2

export interface MapKitGeoJSONFeatureV2<
  TProperties extends MapKitGeoJSONFeaturePropertiesV2 = MapKitGeoJSONFeaturePropertiesV2,
> {
  geometry: MapKitGeoJSONGeometryV2
  id?: string | number
  properties: TProperties
  type: 'Feature'
}

export interface MapKitGeoJSONFeatureCollectionV2<
  TProperties extends MapKitGeoJSONFeaturePropertiesV2 = MapKitGeoJSONFeaturePropertiesV2,
> {
  features: ReadonlyArray<MapKitGeoJSONFeatureV2<TProperties>>
  type: 'FeatureCollection'
}

export type MapKitDrawableV2 =
  | MapKitMarkerDrawableV2
  | MapKitLineDrawableV2
  | MapKitPolygonDrawableV2
  | MapKitCircleDrawableV2
  | MapKitGeoJSONFeatureDrawableV2

export interface MapKitGeoJSONFeatureDrawableV2 extends MapKitDrawableBaseV2 {
  feature: MapKitGeoJSONFeatureV2
  kind: 'geojson-feature'
}

export interface MapKitLineHitV2 {
  closestPoint: MapKitPoint
  distanceDegrees: number
  distanceMetres: number
  latOffset: number
  line: MapKitLineDrawableV2
  lineIndex: number
  lngOffset: number
  segmentIndex: number
}

export interface UseMapKitLineDrawingOptions {
  enabled?: boolean
  id?: string
  style?: Partial<MapKitOverlayStyle>
}

export interface MapKitLineDrawingFinishOptions {
  closed?: boolean
  id?: string
  metadata?: Record<string, unknown>
}

export interface MapKitPlaybackPoint<TData = unknown> extends MapKitPoint {
  data?: TData
  label?: string
  timestamp?: Date | number | string | null
}

export interface MapKitPlaybackLineOptions {
  remainingLineId?: string
  remainingStyle?: Partial<MapKitOverlayStyle>
  trailLineId?: string
  trailStyle?: Partial<MapKitOverlayStyle>
}

export interface UseMapKitRoutePlaybackOptions extends MapKitPlaybackLineOptions {
  autoPlay?: boolean
  durationMs?: number | null
  initialIndex?: number
  intervalMs?: number
  loop?: boolean
  markerId?: string
  markerTitle?: string
  speed?: number
}
