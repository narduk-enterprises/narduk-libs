import {
  createMapKitCalloutController,
  MapKitAnnotationRegistry,
} from '@narduk-enterprises/narduk-mapkit/client'

import type { MapKitCalloutEvent } from '@narduk-enterprises/narduk-mapkit/client'

interface Station {
  id: string
  lat: number
  lng: number
  name: string
  reading: string
}

interface Coordinate {
  latitude: number
  longitude: number
}

interface StationAnnotation {
  coordinate: Coordinate
}

interface MapKitNamespace {
  Annotation: new (
    coordinate: Coordinate,
    factory: () => HTMLElement,
    options?: Record<string, unknown>,
  ) => StationAnnotation
  Coordinate: new (latitude: number, longitude: number) => Coordinate
}

interface CalloutMap {
  addAnnotations(annotations: readonly StationAnnotation[]): void
  addEventListener(type: string, listener: (event: any) => void): void
  convertCoordinateToPointOnPage(coordinate: Coordinate): { x: number; y: number } | null
  removeAnnotations(annotations: readonly StationAnnotation[]): void
  removeEventListener(type: string, listener: (event: any) => void): void
}

interface CalloutMapElements {
  /**
   * The positioned box the callout layer is appended to. Use the wrapper
   * holding the map *plus its chrome*, not the MapKit canvas: it is the element
   * that already establishes a containing block, so callouts clip to the map
   * and travel with it into fullscreen.
   *
   * It needs `position: relative` (or better). Without it the absolutely
   * positioned callouts resolve against the page instead of the map.
   */
  wrapper: HTMLElement
}

/**
 * Anchored callouts for keyed marker annotations.
 *
 * The controller is headless: it owns placement, edge-avoidance, following the
 * camera, and dismissal, and knows nothing about what a callout looks like.
 * `render()` mounts whatever the app wants into the host it is handed and
 * returns the teardown for it, so a listener or a subscription created there is
 * always unwound -- on close, on a re-open without an `update` hook, and on
 * `destroy()`.
 *
 * Callout keys are the annotation keys, so one string identifies a marker and
 * the callout that belongs to it.
 */
export function attachStationCallouts(
  map: CalloutMap,
  elements: CalloutMapElements,
  stations: readonly Station[],
) {
  const annotations = new MapKitAnnotationRegistry<StationAnnotation>({ map })
  /** Nodes `render()` built, so `update()` can write into them by key. */
  const readings = new Map<string, HTMLElement>()

  const callouts = createMapKitCalloutController<Station, Station>({
    container: elements.wrapper,
    // Subscribing to the map is what makes callouts follow a pan or a zoom.
    // One frame loop drives every open callout, so this stays flat however many
    // are open.
    map,
    // One at a time. `'multi'` lets a user compare two stations side by side --
    // something MapKit's own callout cannot express, because it is bound to the
    // single selected annotation.
    mode: 'single',
    placement: 'above',
    // Lift the anchor clear of the pin so the callout does not cover it.
    projectCoordinate: (station) =>
      map.convertCoordinateToPointOnPage(new mapkit.Coordinate(station.lat, station.lng)),
    render: (context, host) => {
      const article = document.createElement('article')
      article.className = 'station-callout'

      const title = document.createElement('h3')
      title.textContent = context.item.name
      const reading = document.createElement('p')
      reading.textContent = context.item.reading
      const dismiss = document.createElement('button')
      dismiss.type = 'button'
      dismiss.textContent = 'Close'
      dismiss.addEventListener('click', context.close)

      article.append(title, reading, dismiss)
      ;(host as unknown as HTMLElement).append(article)
      readings.set(context.key, reading)

      return () => {
        dismiss.removeEventListener('click', context.close)
        article.remove()
        readings.delete(context.key)
      }
    },
    // Supplying this is how a re-open of an already-open key becomes an
    // in-place update: the mounted nodes survive and their cleanup is not run.
    // Drop it and a re-open tears the content down and builds it again.
    update: (context) => {
      const reading = readings.get(context.key)
      if (reading) reading.textContent = context.item.reading
    },
  })

  const unsubscribe = callouts.subscribe((event: MapKitCalloutEvent<Station>) => {
    // `reason` says what dismissed it: 'escape', 'map-click', 'deselect',
    // 'pan', 'replaced', 'api', or 'destroy'.
    if (event.phase === 'close') reportCalloutClosed(event.key, event.reason)
  })

  annotations.reconcile(
    stations.map((station) => ({
      create: () =>
        new mapkit.Annotation(
          new mapkit.Coordinate(station.lat, station.lng),
          () => {
            const element = document.createElement('div')
            element.className = 'station-pin'
            element.addEventListener('click', (browserEvent) => {
              // Stop the click here, or it reaches the controller's own
              // outside-click handler and dismisses what this just opened.
              browserEvent.stopPropagation()
              callouts.toggle({ coordinate: station, item: station, key: station.id })
            })
            return element
          },
          { calloutEnabled: false },
        ),
      key: station.id,
      signature: `${station.lat},${station.lng},${station.reading}`,
    })),
  )

  /** Apply new readings without closing, rebuilding, or blinking anything. */
  function applyReadings(next: readonly Station[]): void {
    for (const station of next) {
      if (!callouts.isOpen(station.id)) continue
      callouts.open({ coordinate: station, item: station, key: station.id })
    }
  }

  return {
    applyReadings,
    destroy: () => {
      unsubscribe()
      // Closes every open callout -- running each render cleanup -- removes the
      // layer, and detaches the map, document, and frame listeners.
      callouts.destroy()
      annotations.destroy()
    },
  }
}

declare const mapkit: MapKitNamespace
declare function reportCalloutClosed(key: string, reason: string): void
