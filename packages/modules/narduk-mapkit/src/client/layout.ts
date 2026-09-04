/**
 * Re-apply the current MapKit region after its host element changes size.
 *
 * MapKit JS can keep stale viewport geometry when a map moves between a
 * drawer, a full-screen surface, or a resized split view. Keeping this small
 * workaround in the MapKit package means consumers do not need to reach into
 * MapKit internals or duplicate the browser-specific refresh behavior.
 */
export interface MapKitMapLayoutTarget {
  region: unknown
}

export function refreshMapKitMapLayout(map: MapKitMapLayoutTarget): void {
  const region = map.region
  if (region !== null && region !== undefined) map.region = region
}
