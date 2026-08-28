import {
  createMapKitFullscreenController,
  refreshMapKitMapLayout,
} from '@narduk-geo/narduk-mapkit/client'

import type { MapKitFullscreenMode } from '@narduk-geo/narduk-mapkit/client'

interface FullscreenMapElements {
  /** The toggle the user presses. Usually rendered inside `wrapper`. */
  button: HTMLButtonElement
  /**
   * The element that becomes fullscreen. Use the wrapper holding the map *plus
   * its chrome*, not the MapKit canvas, so legends and readouts come along.
   *
   * It must have no ancestor with `transform`, `filter`, `backdrop-filter`,
   * `perspective`, or `contain: paint`: such an ancestor becomes the containing
   * block for fixed positioning, and viewport mode would be trapped inside it.
   */
  wrapper: HTMLElement
}

/**
 * Add a fullscreen toggle to a map.
 *
 * `'viewport'` is the default and the mode to reach for: a fixed overlay that
 * works in every browser. `'fullscreen'` uses the Fullscreen API and silently
 * falls back to viewport where it is unavailable — iPhone Safari has no element
 * fullscreen at all — so the consumer always gets a working result.
 */
export function attachFullscreenToggle(
  map: { region: unknown },
  elements: FullscreenMapElements,
  mode: MapKitFullscreenMode = 'viewport',
) {
  const controller = createMapKitFullscreenController({
    defaultMode: mode,
    element: elements.wrapper,
    // Runs after every geometry change, before the subscribers. MapKit keeps
    // stale viewport geometry when its host element is resized underneath it.
    onLayout: () => refreshMapKitMapLayout(map),
  })

  const unsubscribe = controller.subscribe((event) => {
    elements.button.setAttribute('aria-pressed', String(event.active))
    elements.button.textContent = event.active ? 'Exit fullscreen' : 'Fullscreen'

    // The user asked for native fullscreen and the browser could not give it.
    // The map is still presented — in viewport mode — so this is a note, not an
    // error, and `event.fallbackCause` says whether the API was missing or the
    // request was refused.
    if (event.fallback) reportFallback(event.fallbackCause)
  })

  const onClick = () => void controller.toggle()
  elements.button.addEventListener('click', onClick)

  return () => {
    elements.button.removeEventListener('click', onClick)
    unsubscribe()
    // Restores the wrapper's inline styles and the document scroll lock even if
    // it is torn down while presented.
    controller.destroy()
  }
}

declare function reportFallback(cause: 'rejected' | 'unsupported' | null): void
