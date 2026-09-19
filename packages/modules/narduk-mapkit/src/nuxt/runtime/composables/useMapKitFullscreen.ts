/**
 * `useMapKitFullscreen()` -- fullscreen presentation for a map surface, as a
 * Vue ref plus a toggle over `createMapKitFullscreenController`.
 *
 * Lifted unchanged from buoys. `surface` must resolve to the element
 * holding the map *and* its chrome, and that element must have no `transform`
 * / `filter` / `backdrop-filter` / `perspective` / `contain: paint` ancestor --
 * see the containing-block caveat in the controller's own module doc.
 * `onLayout` runs after every geometry change and before subscribers, which is
 * where MapKit's viewport is refreshed.
 */
import { onScopeDispose, shallowRef } from 'vue'

import { createMapKitFullscreenController } from '../../../client/fullscreen.js'

import type { MapKitFullscreenController } from '../../../client/fullscreen.js'
import type { Ref } from 'vue'

export interface UseMapKitFullscreenOptions {
  onLayout: () => void
  surface: () => HTMLElement | null
}

export interface UseMapKitFullscreenResult {
  active: Readonly<Ref<boolean>>
  toggle: () => void
}

export function useMapKitFullscreen(
  options: UseMapKitFullscreenOptions,
): UseMapKitFullscreenResult {
  const active = shallowRef(false)
  let controller: MapKitFullscreenController | null = null

  function ensure(): MapKitFullscreenController | null {
    if (controller) return controller
    const element = options.surface()
    if (!element) return null
    controller = createMapKitFullscreenController({
      element,
      onLayout: () => options.onLayout(),
    })
    controller.subscribe((event) => {
      active.value = event.active
    })
    return controller
  }

  function toggle() {
    void ensure()?.toggle()
  }

  onScopeDispose(() => {
    controller?.destroy()
    controller = null
  })

  return { active, toggle }
}
