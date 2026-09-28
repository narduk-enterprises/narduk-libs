import { onScopeDispose } from 'vue'

import { refreshMapKitMapLayout } from '../../../client/layout.js'
import { asMkMap } from '../../../marks/runtime.js'

import type { MkMap } from '../../../marks/runtime.js'

/**
 * Refresh a bare AppMapKit host after it acquires a real layout box. A one-time
 * height nudge makes the real renderer reschedule tiles on initially collapsed
 * hosts. Vue scope disposal cancels retries, disconnects the observer and
 * restores the original inline height, including when a map is replaced.
 */
export function useMapKitLayoutSettle(): { handleMapReady: (rawMap: unknown) => void } {
  let liveMap: MkMap | null = null
  let observer: ResizeObserver | null = null
  const frames = new Set<number>()
  let retries = 0
  let retryPending = false
  let nudged = false
  let restoreHeight: (() => void) | null = null

  function frame(callback: () => void): void {
    if (typeof requestAnimationFrame !== 'function') return
    const id = requestAnimationFrame(() => {
      frames.delete(id)
      callback()
    })
    frames.add(id)
  }

  function cleanup(): void {
    observer?.disconnect()
    observer = null
    if (typeof cancelAnimationFrame === 'function') {
      for (const id of frames) cancelAnimationFrame(id)
    }
    frames.clear()
    restoreHeight?.()
    restoreHeight = null
    liveMap = null
    retryPending = false
  }

  function settle(): void {
    if (!liveMap) return
    const element = liveMap.element
    if (element.clientWidth <= 0 || element.clientHeight <= 0) {
      if (!retryPending && retries < 16 && typeof requestAnimationFrame === 'function') {
        retryPending = true
        retries += 1
        frame(() => {
          retryPending = false
          settle()
        })
      }
      return
    }
    refreshMapKitMapLayout(liveMap)
    if (nudged || typeof requestAnimationFrame !== 'function') return
    nudged = true
    const height = element.style.height
    const priority = element.style.getPropertyPriority('height')
    restoreHeight = () => {
      element.style.setProperty('height', height, priority)
    }
    element.style.height = `${element.clientHeight + 1}px`
    frame(() => {
      frame(() => {
        restoreHeight?.()
        restoreHeight = null
      })
    })
  }

  function handleMapReady(rawMap: unknown): void {
    cleanup()
    liveMap = asMkMap(rawMap)
    retries = 0
    nudged = false
    settle()
    if (liveMap && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(settle)
      observer.observe(liveMap.element)
    }
  }

  onScopeDispose(cleanup)
  return { handleMapReady }
}
