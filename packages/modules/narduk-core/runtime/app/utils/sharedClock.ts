// Explicit import (not a Nuxt auto-import): packed package consumers compile this file outside the owning Nuxt source tree, and isolated Vitest has no auto-imports.
import { onBeforeUnmount, onMounted, readonly } from 'vue'

import type { Ref } from 'vue'

/**
 * The per-app half of `useSharedNow()`: which readers are mounted, the cadence
 * each asked for, and the one timer that serves them all. It lives on the Nuxt
 * app (one per request on the server, one per tab in the browser), never at
 * module level, so two server requests can never share readers.
 */
export interface SharedClockRegistry {
  /** Mounted readers that asked the clock to tick, by reader id. */
  cadences: Map<number, number>
  /** Mounted readers of any kind; the visibility listener lives while this is above zero. */
  mounted: number
  nextReader: number
  onVisibility: (() => void) | undefined
  timer: ReturnType<typeof setInterval> | undefined
  timerCadence: number
}

export function createSharedClockRegistry(): SharedClockRegistry {
  return {
    cadences: new Map(),
    mounted: 0,
    nextReader: 0,
    timer: undefined,
    timerCadence: Number.POSITIVE_INFINITY,
    onVisibility: undefined,
  }
}

function validCadence(cadenceMs: number | undefined): cadenceMs is number {
  return cadenceMs !== undefined && Number.isFinite(cadenceMs) && cadenceMs > 0
}

/** Re-arm the one timer at the fastest cadence any mounted reader asked for. */
function retime(state: Ref<number>, registry: SharedClockRegistry) {
  const cadence = Math.min(Number.POSITIVE_INFINITY, ...registry.cadences.values())
  if (cadence === registry.timerCadence) return
  if (registry.timer !== undefined) clearInterval(registry.timer)
  registry.timer = undefined
  registry.timerCadence = cadence
  if (Number.isFinite(cadence)) {
    registry.timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') state.value = Date.now()
    }, cadence)
  }
}

/**
 * The lifecycle half of `useSharedNow()`, with the `useState` ref and the
 * per-app registry injected.
 *
 * `state` holds the server's reading (on the server) or the hydrated payload
 * value (on the client), so the first client render matches the server's
 * markup. On mount the reader takes the browser clock. Readers that pass
 * `cadenceMs` make the clock tick at the fastest cadence any mounted reader
 * asked for; a reader without one only reads it. The tick skips while the page
 * is hidden, and the clock is re-read when the page becomes visible again.
 * Call from component `setup()`.
 */
export function createSharedClock(
  state: Ref<number>,
  registry: SharedClockRegistry,
  cadenceMs?: number,
): Readonly<Ref<number>> {
  const reader = registry.nextReader++
  let mounted = false

  onMounted(() => {
    mounted = true
    state.value = Date.now()
    registry.mounted++
    if (registry.onVisibility === undefined) {
      registry.onVisibility = () => {
        if (document.visibilityState === 'visible') state.value = Date.now()
      }
      document.addEventListener('visibilitychange', registry.onVisibility)
    }
    if (validCadence(cadenceMs)) {
      registry.cadences.set(reader, cadenceMs)
      retime(state, registry)
    }
  })

  onBeforeUnmount(() => {
    if (!mounted) return
    mounted = false
    registry.mounted--
    if (registry.cadences.delete(reader)) retime(state, registry)
    if (registry.mounted === 0 && registry.onVisibility !== undefined) {
      document.removeEventListener('visibilitychange', registry.onVisibility)
      registry.onVisibility = undefined
    }
  })

  return readonly(state)
}
