import './styles/map.css'

/** The SVG engine: no GL library is ever imported from this entry. */
export { default as NardukGeoMap } from './components/NardukGeoMap.vue'

export {
  createMapView,
  fitBounds,
  geometryBounds,
  mercatorX,
  mercatorY,
  mergeBounds,
  projectGeometry,
  unmercatorX,
  unmercatorY,
} from './projection'
export type { FitResult, ProjectedGeometry, ViewOptions, ViewPoint } from './projection'
export { labelAnchor, placeLabels, poleOfInaccessibility } from './labels'
export type { LabelInput, Obstacle, PlacedLabel } from './labels'
export { markDiscs, markReach } from './marks'
export type { MarkDisc } from './marks'
export { DARK_TOKENS, DEFAULT_METRICS, LIGHT_TOKENS, metricsFor, mix, tokensFor } from './tokens'
export type * from './types'
