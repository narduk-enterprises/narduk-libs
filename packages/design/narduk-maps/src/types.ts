/** Longitude, latitude in degrees (GeoJSON order). */
export type LonLat = [lon: number, lat: number]

/** West, south, east, north in degrees. */
export type Bounds = [west: number, south: number, east: number, north: number]

export type Position = number[]
export type PolygonCoordinates = Position[][]

export interface PolygonGeometry {
  type: 'Polygon'
  coordinates: PolygonCoordinates
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon'
  coordinates: PolygonCoordinates[]
}

export type ShapeGeometry = PolygonGeometry | MultiPolygonGeometry

export interface ShapeFeature {
  type: 'Feature'
  id?: string | number
  properties: Record<string, unknown> | null
  geometry: ShapeGeometry
}

/** A GeoJSON FeatureCollection of Polygon or MultiPolygon features. */
export interface ShapeCollection {
  type: 'FeatureCollection'
  features: ShapeFeature[]
}

/** The five mark shapes. The caller picks the shape and the colour; the package never does. */
export type MarkShape = 'dot' | 'ring' | 'core' | 'small' | 'hollow'

export interface MapPoint {
  id: string
  lon: number
  lat: number
  /** Any CSS colour. Status colour comes from the caller. */
  color: string
  shape: MarkShape
  /** When set the mark is an `<a>` with this destination. */
  href?: string
  /** The accessible name, also the tooltip title. Never a native SVG title. */
  label: string
}

export interface MapLabel {
  text: string
  lon: number
  lat: number
}

export interface Padding {
  top: number
  right: number
  bottom: number
  left: number
}

export type FillFunction = (feature: ShapeFeature) => string | undefined | null
export type Fills = Record<string, string> | FillFunction

export type MapScheme = 'light' | 'dark'

/** Resolved colours for GL style JSON, which cannot hold `var()` or `color-mix()`. */
export interface MapTokens {
  water: string
  land: string
  shore: string
  /** Boundary line colour; drawn at `boundaryOpacity`. */
  boundary: string
  boundaryOpacity: number
  boundaryFocus: string
  ink: string
  /** Muted ink for water names. */
  muted: string
  /** Ink of basemap place names, quieter than the caller's own labels. */
  placeInk: string
  labelHalo: string
  road: string
  markRing: string
  markCore: string
  /** Stroke of the dashed `hollow` mark and the "no data" hatch. */
  hatch: string
  /** Faint green used for landcover and parks. */
  green: string
  /** The soft band drawn on the water side of a baked shoreline. */
  shoreHalo: string
  roadMajor: string
}

export interface MapOverlay {
  id: string
  label: string
  type: 'raster'
  tiles: string[]
  minzoom?: number
  maxzoom?: number
  tileSize?: number
  opacity?: number
  visible?: boolean
  attribution?: string
}

export type LabelMode = 'shapes' | 'none' | MapLabel[]

export type MapLoadMode = 'eager' | 'visible' | 'idle' | 'interaction'

/** One baked layer: SVG path data already projected into the cutout's own viewBox. */
export interface CutoutLayer {
  id: 'water' | 'green' | 'shore' | 'roadMinor' | 'roadMajor' | 'state'
  d: string
}

export interface CutoutLabel {
  text: string
  x: number
  y: number
  kind: 'place' | 'water'
  /** Lower is more important: placed first, so it wins a collision. */
  rank: number
}

export type BasemapLabels = 'places' | 'cities' | 'none'

/**
 * A baked basemap (a build-time cutout of open data). `NardukGeoMap` draws it under and over
 * the data and uses its bbox and viewBox as the projection frame, so shapes and points land in
 * the same pixels as the baked layers and no tiles or engine are needed.
 */
export interface CutoutBasemap {
  name: string
  /** West, south, east, north in degrees, already widened to the frame's aspect. */
  bbox: Bounds
  viewBox: [width: number, height: number]
  /** The zoom the cutout was baked for. */
  zoom: number
  layers: CutoutLayer[]
  labels: CutoutLabel[]
  attribution: string
}

/** Props shared by the SVG map and the GL map's poster. */
export interface GeoMapProps {
  shapes?: ShapeCollection | null
  idKey?: string
  nameKey?: string
  fills?: Fills
  /** shape id to "no data": drawn as an SVG hatch pattern. */
  hatch?: Record<string, boolean>
  /** Paint the sea and the shoreline halo. */
  water?: boolean
  points?: MapPoint[]
  /** A point id; drawn at radius 10. */
  highlight?: string | null
  /** A shape id. */
  selected?: string | null
  interactive?: boolean
  /** Print mode: no tab stops, each shape's `levelText` is drawn under its name. */
  plain?: boolean
  levelText?: Record<string, string>
  labels?: LabelMode
  /** ViewBox width. */
  width?: number
  /** ViewBox height; derived from the bounds when omitted. */
  height?: number
  padding?: number
  bounds?: Bounds | null
  ariaLabel?: string
  /** Render a visually hidden table of the shapes and points. */
  table?: boolean
  scheme?: MapScheme | null
  /** A baked basemap drawn under the data; its viewBox and bbox become the projection frame. */
  basemap?: CutoutBasemap | null
  /**
   * Which baked basemap names to draw: `places` (all), `cities` (rank 0 only) or `none`.
   * Shape names and the caller's own labels are not affected.
   */
  basemapLabels?: BasemapLabels
}

/**
 * Every number the look depends on, in CSS pixels. Provisional until the design round
 * lands; change a value here (or pass `metrics`) and both engines follow.
 */
export interface MapMetrics {
  markRadius: number
  markRadiusSmall: number
  markRadiusHighlight: number
  /** Radius of the invisible hit target around each SVG mark (24px diameter for WCAG 2.5.8). */
  markHitRadius: number
  /** Surface ring around every mark. */
  markRingWidth: number
  /** Coloured band of the `ring` shape. */
  markBandWidth: number
  /** Core radius of the `core` shape, as a share of the mark radius. */
  markCoreRatio: number
  /** Outline of the `small` shape. */
  markOutlineWidth: number
  /** Dashed ring of the `hollow` shape. */
  markDashWidth: number
  markDash: [number, number]
  boundaryWidth: number
  boundaryFocusWidth: number
  shoreWidth: number
  haloWidth: number
  haloOpacity: number
  labelSize: number
  labelWeight: number
  labelSpacing: number
  labelHaloWidth: number
  /** Average glyph advance as a share of the label size, used to size label boxes. */
  labelCharWidth: number
  /** Baked place and water names: smaller than the caller's own labels, mixed case. */
  bmLabelSize: number
  bmLabelCharWidth: number
  /** Place names are bold capitals with tracking, so they run wider than water names. */
  bmPlaceCharWidth: number
  hatchSize: number
  hatchWidth: number
  hatchAngle: number
}

/** An immutable mapping from lon/lat to viewBox units (see `createMapView`). */
export interface MapView {
  width: number
  height: number
  padding: Padding
  bounds: Bounds
  /** Pixels per unit of mercator world (0..1). */
  scale: number
  /** The camera centre and 512px-tile zoom that frame the same bounds at this size. */
  center: LonLat
  zoom: number
  project: (lon: number, lat: number) => [x: number, y: number]
  unproject: (x: number, y: number) => LonLat
}

/** Props of the GL map: everything the SVG map takes, plus the live-map options. */
export interface GlMapProps extends Omit<GeoMapProps, 'basemap'> {
  overlays?: MapOverlay[]
  /** Overlay ids to show; when omitted each overlay's own `visible` decides. */
  visibleLayers?: string[]
  /** When to import the GL library and mount: default `visible`. */
  load?: MapLoadMode
  tokens?: Partial<MapTokens>
  metrics?: Partial<MapMetrics>
}
