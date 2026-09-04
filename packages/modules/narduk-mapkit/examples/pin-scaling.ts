import {
  createMapKitPinScalingController,
  MapKitAnnotationRegistry,
  mapKitZoomForSpan,
} from '@narduk-enterprises/narduk-mapkit/client'

import type { MapKitPinPresentation } from '@narduk-enterprises/narduk-mapkit/client'

interface Structure {
  /** Whatever the app uses to rank a class: platform, reef, buoy, launch. */
  class: string
  id: string
  lat: number
  lng: number
}

interface Coordinate {
  latitude: number
  longitude: number
}

interface Annotation {
  element: HTMLElement
  visible: boolean
}

interface MapKitNamespace {
  Annotation: new (
    coordinate: Coordinate,
    factory: () => HTMLElement,
    options?: Record<string, unknown>,
  ) => Annotation
  Coordinate: new (latitude: number, longitude: number) => Coordinate
}

interface StructureMap {
  addAnnotations(annotations: readonly Annotation[]): void
  addEventListener(type: string, listener: () => void): void
  element: HTMLElement
  region: { span: { longitudeDelta: number } }
  removeAnnotations(annotations: readonly Annotation[]): void
}

/**
 * Zoom-adaptive pins over a keyed annotation set.
 *
 * The registry owns *which* annotations exist; the scaling controller owns what
 * they look like at the current zoom. Between thresholds nothing is repainted
 * at all -- the container's `--mapkit-pin-scale` moves and CSS does the rest --
 * so a pinch over a few thousand pins costs two style writes per frame.
 *
 * The CSS this expects, applied to the app's own pin markup:
 *
 * ```css
 * .pin {
 *   width: 26px;            // the size the artwork is authored at
 *   height: 26px;
 *   transform: translate(-50%, -50%) scale(var(--mapkit-pin-scale, 1));
 *   transform-origin: center;
 * }
 * ```
 *
 * `transform` is deliberate: it composites without layout or paint, which is
 * what keeps the gesture smooth. Reach for `width: var(--mapkit-pin-size)` only
 * when the pin must affect layout around it.
 */
export function createScaledPinLayer(
  mapkit: MapKitNamespace,
  map: StructureMap,
  wrapper: HTMLElement,
) {
  const registry = new MapKitAnnotationRegistry<Annotation>({ map })

  const scaling = createMapKitPinScalingController<Annotation>({
    // Composition, not a fork: the controller reads the registry's live
    // annotations by key and never touches its membership.
    annotations: registry,
    classes: {
      // Rank orders the cull: the least distinctive class drops out first.
      'artificial-reef': { rank: 3 },
      buoy: { rank: 4 },
      // A launch point is a wayfinding mark, so it never collapses to a dot.
      launch: { dotBelowPx: 0, rank: 9 },
      'oil-gas-platform': { rank: 2 },
      'tx-state-platform': { rank: 1 },
    },
    // The element the CSS custom properties are published on. One write per
    // frame here replaces one write per pin.
    container: wrapper,
    onChange: (event) => {
      // Only the pins that actually crossed a threshold, batched into one
      // frame. A culled pin is never named here.
      for (const key of event.changed) {
        const annotation = registry.get(key)
        const presentation = scaling.presentationFor(key)
        if (annotation && presentation) paintPin(annotation.element, presentation)
      }
    },
    // MapKit publishes no zoom level, so derive it from the documented region
    // span and the rendered element width.
    readZoom: () =>
      mapKitZoomForSpan({
        longitudeDelta: map.region.span.longitudeDelta,
        widthPx: map.element.clientWidth,
      }),
    // Repaint what the user can see now; the rest is released on the next pan.
    shouldPaint: (key) => isOnScreen(key),
  })

  function render(structures: readonly Structure[]): void {
    registry.reconcile(
      structures.map((structure) => ({
        create: () =>
          new mapkit.Annotation(
            new mapkit.Coordinate(structure.lat, structure.lng),
            () => createPinElement(structure),
          ),
        key: structure.id,
        // Zoom is deliberately absent: presentation is the scaling
        // controller's job, so a zoom change must not re-signature a marker.
        signature: `${structure.lat},${structure.lng}|${structure.class}`,
      })),
    )
    scaling.reconcile(
      structures.map((structure) => ({ classId: structure.class, key: structure.id })),
    )
  }

  // `zoom-start` / `zoom-end` bracket a user zoom; between them there is no
  // MapKit event at all, so the controller polls the camera once per frame.
  map.addEventListener('zoom-start', () => scaling.beginGesture())
  map.addEventListener('zoom-end', () => scaling.endGesture())
  // A programmatic region change never fires the zoom pair, and a pan brings
  // deferred pins on screen without changing the zoom.
  map.addEventListener('region-change-end', () => {
    scaling.sample()
    scaling.flushDeferred()
  })

  return {
    destroy: () => {
      // Restores the pins it culled and drops the properties it published.
      scaling.destroy()
      registry.destroy()
    },
    registry,
    render,
    scaling,
    select: (id: string | null) => scaling.setSelection(id === null ? [] : [id]),
  }
}

declare function createPinElement(structure: Structure): HTMLElement
declare function paintPin(element: HTMLElement, presentation: MapKitPinPresentation): void
declare function isOnScreen(key: string): boolean
