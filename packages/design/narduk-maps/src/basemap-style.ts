import { metricsFor, mix, tokensFor } from './tokens'

import type { MapMetrics, MapScheme, MapTokens } from './types'

/**
 * createBasemapStyle: a muted style we own, over OpenFreeMap's keyless OpenMapTiles vector
 * tiles. Pure data: this module imports no GL library. No sprite, no icons, no POIs, no road
 * labels, no house numbers, no buildings below z14.
 */

export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet'
export const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
export const BASEMAP_SOURCE = 'openmaptiles'

export const BASEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'

const FONT_BOLD = 'Noto Sans Bold'
const FONT_ITALIC = 'Noto Sans Italic'

export interface BasemapOptions {
  scheme?: MapScheme
  /** `places` draws town, city and village names and water names; `none` draws no text at all. */
  labels?: 'places' | 'none'
  /** Overrides on top of the scheme's tokens. */
  tokens?: Partial<MapTokens>
  metrics?: Partial<MapMetrics>
  /** Place names to leave out, because the caller draws its own label for them. */
  hideNames?: string[]
  tilejson?: string
  glyphs?: string
}

/** Where the caller's own layers go: fills under the water, lines and overlays under the labels. */
export interface BasemapSlots {
  fills: string
  lines: string | null
}

export type StyleLayer = Record<string, unknown> & { id: string; type: string }

export interface BasemapStyle {
  version: 8
  name: string
  metadata: { 'narduk:slots': BasemapSlots; 'narduk:attribution': string }
  sources: Record<string, Record<string, unknown>>
  glyphs: string
  layers: StyleLayer[]
}

type Expr = unknown[]

const zoomWidth = (stops: Array<[number, number]>): Expr => [
  'interpolate',
  ['exponential', 1.4],
  ['zoom'],
  ...stops.flat(),
]

const inList = (list: string[]): Expr => ['in', ['get', 'class'], ['literal', list]]

/**
 * Names try the centre first, then step off it, so a pin (a symbol in the caller's layer)
 * moves a name aside instead of hiding it.
 */
const MOVE_OFF_PINS = {
  'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
  'text-radial-offset': 0.8,
}

export function createBasemapStyle(
  tokensInput: Partial<MapTokens> = {},
  options: BasemapOptions = {},
): BasemapStyle {
  const scheme = options.scheme ?? 'light'
  const t = tokensFor(scheme, { ...options.tokens, ...tokensInput })
  const m = metricsFor(options.metrics)
  const showText = (options.labels ?? 'places') === 'places'
  const hidden = options.hideNames ?? []
  const nameFilter: Expr[] =
    hidden.length > 0 ? [['!', ['in', ['get', 'name'], ['literal', hidden]]]] : []
  const name: Expr = ['coalesce', ['get', 'name:latin'], ['get', 'name']]
  const halo = {
    'text-opacity': 0.72,
    'text-halo-color': t.labelHalo,
    'text-halo-width': 1.6,
  }

  const layers: StyleLayer[] = [
    { id: 'background', type: 'background', paint: { 'background-color': t.land } },
    {
      id: 'landcover',
      type: 'fill',
      source: BASEMAP_SOURCE,
      'source-layer': 'landcover',
      filter: inList(['wood', 'grass', 'farmland']),
      paint: { 'fill-color': t.green, 'fill-opacity': 0.7 },
    },
    {
      id: 'park',
      type: 'fill',
      source: BASEMAP_SOURCE,
      'source-layer': 'park',
      paint: { 'fill-color': t.green, 'fill-opacity': 0.8 },
    },
    {
      id: 'water',
      type: 'fill',
      source: BASEMAP_SOURCE,
      'source-layer': 'water',
      paint: { 'fill-color': t.water },
    },
    {
      id: 'waterway',
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'waterway',
      minzoom: 8,
      paint: {
        'line-color': t.water,
        'line-width': zoomWidth([
          [8, 0.6],
          [14, 3],
        ]),
      },
    },
    // The shoreline is the water polygons' outline. The halo is a soft band on the water side
    // (a positive offset points into the water); the narrow line is the coastline.
    {
      id: 'shore-halo',
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'water',
      minzoom: 3,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': t.shoreHalo,
        'line-opacity': m.haloOpacity,
        'line-blur': 2,
        'line-width': zoomWidth([
          [8, 3],
          [14, 10],
        ]),
        'line-offset': zoomWidth([
          [8, 1.5],
          [14, 5],
        ]),
      },
    },
    {
      id: 'shore',
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'water',
      minzoom: 3,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': t.shore,
        'line-width': zoomWidth([
          [8, 0.6],
          [14, 1.4],
        ]),
      },
    },
    {
      id: 'building',
      type: 'fill',
      source: BASEMAP_SOURCE,
      'source-layer': 'building',
      minzoom: 14,
      paint: { 'fill-color': mix(t.land, t.ink, 0.06) },
    },
    {
      id: 'road-minor',
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: inList(['tertiary', 'minor']),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': t.road,
        'line-width': zoomWidth([
          [12, 0.5],
          [16, 3],
        ]),
      },
    },
    {
      id: 'road-major',
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'transportation',
      minzoom: 5,
      filter: inList(['motorway', 'trunk', 'primary', 'secondary']),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': t.roadMajor,
        'line-width': zoomWidth([
          [5, 0.4],
          [12, 1.6],
          [16, 5],
        ]),
      },
    },
    {
      id: 'boundary-region',
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'boundary',
      minzoom: 3,
      filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': t.boundary,
        'line-opacity': t.boundaryOpacity,
        'line-width': m.boundaryWidth,
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source: BASEMAP_SOURCE,
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': t.boundary,
        'line-opacity': t.boundaryOpacity,
        'line-width': m.boundaryWidth,
      },
    },
  ]

  if (showText) {
    layers.push(
      {
        id: 'water-name',
        type: 'symbol',
        source: BASEMAP_SOURCE,
        'source-layer': 'water_name',
        minzoom: 4,
        layout: {
          'text-field': name,
          'text-font': [FONT_ITALIC],
          'text-size': m.labelSize,
          'text-letter-spacing': 0.05,
          'text-max-width': 6,
          ...MOVE_OFF_PINS,
        },
        paint: {
          'text-color': t.muted,
          'text-halo-color': t.water,
          'text-halo-width': 1.2,
        },
      },
      {
        id: 'place-city',
        type: 'symbol',
        source: BASEMAP_SOURCE,
        'source-layer': 'place',
        minzoom: 4,
        filter: ['all', ['==', ['get', 'class'], 'city'], ...nameFilter],
        layout: placeLayout(name, 13, FONT_BOLD),
        paint: { 'text-color': t.placeInk, ...halo },
      },
      {
        id: 'place-town',
        type: 'symbol',
        source: BASEMAP_SOURCE,
        'source-layer': 'place',
        minzoom: 7,
        filter: ['all', ['==', ['get', 'class'], 'town'], ...nameFilter],
        layout: placeLayout(name, m.labelSize, FONT_BOLD),
        paint: { 'text-color': t.placeInk, ...halo },
      },
      {
        id: 'place-village',
        type: 'symbol',
        source: BASEMAP_SOURCE,
        'source-layer': 'place',
        minzoom: 11,
        filter: ['all', ['==', ['get', 'class'], 'village'], ...nameFilter],
        layout: placeLayout(name, m.labelSize - 1, FONT_BOLD),
        paint: { 'text-color': t.placeInk, ...halo },
      },
    )
  }

  return {
    version: 8,
    name: `narduk-maps-${scheme}`,
    metadata: {
      'narduk:slots': { fills: 'water', lines: showText ? 'water-name' : null },
      'narduk:attribution': BASEMAP_ATTRIBUTION,
    },
    sources: {
      [BASEMAP_SOURCE]: { type: 'vector', url: options.tilejson ?? OPENFREEMAP_TILEJSON },
    },
    glyphs: options.glyphs ?? OPENFREEMAP_GLYPHS,
    layers,
  }
}

function placeLayout(name: Expr, size: number, font: string) {
  return {
    'text-field': name,
    'text-font': [font],
    'text-size': size,
    // The GL engine has no small caps; upper case with tracking is the closest.
    'text-transform': 'uppercase',
    'text-letter-spacing': 0.08,
    'text-max-width': 8,
    ...MOVE_OFF_PINS,
  }
}
