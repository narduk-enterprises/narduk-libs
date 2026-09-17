import {
  createMapKitRegionForPoints,
  initializeMapKit,
} from '@narduk-enterprises/narduk-mapkit/client'

import type { MapKitPoint } from '@narduk-enterprises/narduk-mapkit'

interface MapKitNamespace {
  Annotation: new (
    coordinate: unknown,
    elementFactory: () => HTMLElement,
    options?: Record<string, unknown>,
  ) => unknown
  Coordinate: new (latitude: number, longitude: number) => unknown
  CoordinateRegion: new (center: unknown, span: unknown) => unknown
  CoordinateSpan: new (latitudeDelta: number, longitudeDelta: number) => unknown
  FeatureVisibility: { Adaptive: unknown; Hidden: unknown }
  Map: new (
    container: HTMLElement,
    options?: Record<string, unknown>,
  ) => {
    region?: unknown
    showItems(items: unknown[], options?: Record<string, unknown>): void
  }
}

declare global {
  interface Window {
    mapkit?: MapKitNamespace
  }
}

export interface MarkerPoint extends MapKitPoint {
  color: string
  id: string
  title: string
}

export async function mountMarkerMap(container: HTMLElement, points: readonly MarkerPoint[]) {
  // `libraries` is mandatory in MapKit JS 6; annotations are not in the stub.
  await initializeMapKit({
    libraries: ['map', 'annotations'],
    tokenEndpoint: '/api/mapkit-token',
  })
  const mapkit = window.mapkit
  if (!mapkit) throw new Error('MapKit JS did not expose window.mapkit')

  const map = new mapkit.Map(container, {
    isRotationEnabled: false,
    showsCompass: mapkit.FeatureVisibility.Hidden,
    showsScale: mapkit.FeatureVisibility.Adaptive,
  })

  const region = createMapKitRegionForPoints(mapkit, points, {
    fallbackCenter: { lat: 30.2672, lng: -97.7431 },
    fallbackSpan: { latDelta: 0.12, lngDelta: 0.12 },
    padding: 0.16,
  })
  if (region) map.region = region

  const annotations = points.map((point) => {
    return new mapkit.Annotation(
      new mapkit.Coordinate(point.lat, point.lng),
      () => markerElement(point),
      {
        clusteringIdentifier: 'markers',
        data: point,
        title: point.title,
      },
    )
  })

  if (annotations.length) map.showItems(annotations, { animate: false })
  return map
}

function markerElement(point: MarkerPoint): HTMLElement {
  const marker = document.createElement('span')
  marker.style.background = point.color
  marker.style.border = '2px solid white'
  marker.style.borderRadius = '999px'
  marker.style.boxShadow = '0 2px 8px rgb(0 0 0 / 24%)'
  marker.style.display = 'block'
  marker.style.height = '18px'
  marker.style.width = '18px'
  marker.title = point.title
  return marker
}
