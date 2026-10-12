import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CutoutBasemap, MapPoint, ShapeCollection } from '../types'

const here = dirname(fileURLToPath(import.meta.url))
const lab = (name: string) => resolve(here, '../../lab/data', name)

export const towns = JSON.parse(readFileSync(lab('towns.geojson'), 'utf8')) as ShapeCollection
const tiger = JSON.parse(readFileSync(lab('counties.tiger.json'), 'utf8')) as ShapeCollection
/** Census TIGERweb county outlines (public domain), with `fips` and `name` properties. */
export const counties: ShapeCollection = {
  ...tiger,
  features: tiger.features.map(f => ({
    ...f,
    properties: {
      fips: f.properties?.GEOID,
      name: String(f.properties?.NAME ?? '').replace(/ County$/, ''),
    },
  })),
}

/** A handful of marks on and around the town outlines, one of each shape. */
export const points: MapPoint[] = [
  {
    id: 'p1',
    lon: -71.2825,
    lat: 41.518,
    color: '#24689f',
    shape: 'dot',
    label: 'Culvert inventory',
    href: '#p1',
  },
  { id: 'p2', lon: -71.315, lat: 41.4785, color: '#8ea6c4', shape: 'ring', label: 'Road ranking' },
  { id: 'p3', lon: -71.29, lat: 41.52, color: '#1d5c3a', shape: 'core', label: 'Shoreline study' },
  { id: 'p4', lon: -71.25, lat: 41.6, color: '#c3cad0', shape: 'small', label: 'Not started' },
  { id: 'p5', lon: -71.27, lat: 41.56, color: '#8b96a0', shape: 'hollow', label: 'No status' },
]

/** Baked cutouts of the same two scenes (design/narduk-maps/gen), for the frame tests. */
export const aquidneckCutout = JSON.parse(
  readFileSync(lab('aquidneck.desk.json'), 'utf8'),
) as CutoutBasemap
export const marcCutout = JSON.parse(readFileSync(lab('marc.desk.json'), 'utf8')) as CutoutBasemap
