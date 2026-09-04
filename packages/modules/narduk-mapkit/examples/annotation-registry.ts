import { MapKitAnnotationRegistry } from '@narduk-enterprises/narduk-mapkit/client'

interface Coordinate {
  latitude: number
  longitude: number
}

interface MarkerAnnotation {
  color: string
  coordinate: Coordinate
  title: string
}

interface MapKitNamespace {
  Coordinate: new (latitude: number, longitude: number) => Coordinate
  MarkerAnnotation: new (
    coordinate: Coordinate,
    options?: Record<string, unknown>,
  ) => MarkerAnnotation
}

interface AnnotationMap {
  addAnnotations(annotations: readonly MarkerAnnotation[]): void
  removeAnnotations(annotations: readonly MarkerAnnotation[]): void
}

interface Buoy {
  id: string
  label: string
  lat: number
  lng: number
  status: 'go' | 'caution' | 'no-go'
}

const statusColors: Record<Buoy['status'], string> = {
  caution: '#f5a524',
  go: '#17c964',
  'no-go': '#f31260',
}

/**
 * Render a live marker set without rebuilding it.
 *
 * The naive update is `map.removeAnnotations(all)` then
 * `map.addAnnotations(next)`, which destroys and recreates every marker on
 * every pan, hover, and opacity tick — a few hundred markers blink each time.
 * Reconciling by key touches only what actually changed.
 */
export function createBuoyLayer(mapkit: MapKitNamespace, map: AnnotationMap) {
  const registry = new MapKitAnnotationRegistry<MarkerAnnotation>({ map })

  function render(buoys: readonly Buoy[]) {
    return registry.reconcile(
      buoys.map((buoy) => ({
        create: () =>
          new mapkit.MarkerAnnotation(new mapkit.Coordinate(buoy.lat, buoy.lng), {
            color: statusColors[buoy.status],
            title: buoy.label,
          }),
        key: buoy.id,
        // Everything that changes how the marker looks or reads. Anything left
        // out of the signature will not repaint.
        signature: `${buoy.lat},${buoy.lng}|${buoy.status}|${buoy.label}`,
        // With an update hook a moved or restyled marker is mutated in place
        // instead of being destroyed and rebuilt.
        update: (annotation) => {
          annotation.coordinate = new mapkit.Coordinate(buoy.lat, buoy.lng)
          annotation.color = statusColors[buoy.status]
          annotation.title = buoy.label
        },
      })),
    )
  }

  return {
    destroy: () => registry.destroy(),
    registry,
    // Re-rendering the same buoys returns all-zero counts except `unchanged`,
    // and makes no MapKit call at all.
    render,
  }
}
