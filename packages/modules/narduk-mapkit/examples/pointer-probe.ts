import { attachMapKitPointerProbe } from '@narduk-enterprises/narduk-mapkit/client'

import type {
  MapKitProbeEvent,
  MapKitProbePointerSample,
} from '@narduk-enterprises/narduk-mapkit/client'

interface MapCoordinate {
  latitude: number
  longitude: number
}

interface MapHandle {
  convertPointOnPageToCoordinate(point: { x: number; y: number }): MapCoordinate | null
}

/**
 * Attach probe plumbing to a map container.
 *
 * The recognizer is engine-agnostic: it takes an element plus one coordinate
 * conversion callback, so the same state machine covers desktop hover,
 * click-to-pin, touch tap, long-press, and pin dragging without the core ever
 * importing MapKit JS.
 *
 * The element should carry `touch-action: none` so Safari does not swallow the
 * gesture as a page scroll before the recognizer sees it.
 */
export function attachProbe(element: HTMLElement, map: MapHandle) {
  const probe = attachMapKitPointerProbe<MapCoordinate>({
    coordinateForPoint: (sample: MapKitProbePointerSample) =>
      // Page coordinates, not element-relative ones: that is what MapKit JS
      // expects, and the sample carries all three spaces.
      map.convertPointOnPageToCoordinate({ x: sample.page.x, y: sample.page.y }),
    element,
    hoverThrottleMs: 90,
    // Pin markup is app-owned, so the core cannot hit-test it; say which
    // pointerdown targets are the pin.
    isPinHandle: (target) => target instanceof Element && target.closest('.probe-pin') !== null,
    longPressDurationMs: 500,
    moveSlopPx: 8,
    onEvent: (event: MapKitProbeEvent<MapCoordinate>) => {
      if (event.phase === 'dismiss' || event.phase === 'end') {
        if (event.mode === 'hover') clearReadout()
        return
      }
      if (event.phase === 'cancel') return
      if (!event.coordinate) return
      renderReadout({
        coordinate: event.coordinate,
        pinned: event.mode === 'pinned',
        point: event.point,
      })
    },
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') probe.dismiss()
  })

  return probe
}

declare function renderReadout(readout: {
  coordinate: MapCoordinate
  pinned: boolean
  point: { x: number; y: number }
}): void
declare function clearReadout(): void
