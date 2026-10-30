/**
 * A reactive `matchMedia` result that is hydration-safe (ten apps carried a
 * copy: `useMapPhone`, `usePhoneLayout`, `usePhoneWidth`, …).
 *
 * The server has no viewport, so the ref starts at `initial` (default
 * `false`) on the server *and* on the client's first render, and reads the
 * real query on mount. The first client render therefore matches the server
 * HTML, and the layout change arrives with the first effect rather than as a
 * hydration mismatch. Outside a component it reads the query immediately.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/app/media-query`.
 * It is not under `app/composables`, so it adds no auto-imported name.
 */

import { getCurrentInstance, onBeforeUnmount, onMounted, readonly, shallowRef } from 'vue'

import type { Ref } from 'vue'

export interface MediaQueryOptions {
  /** The value before mount and on the server. Default `false`. */
  readonly initial?: boolean
}

export function useMediaQuery(
  query: string,
  options: MediaQueryOptions = {},
): Readonly<Ref<boolean>> {
  const matches = shallowRef(options.initial ?? false)
  let media: MediaQueryList | null = null

  function onChange(event: MediaQueryListEvent): void {
    matches.value = event.matches
  }

  function start(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    media = window.matchMedia(query)
    matches.value = media.matches
    media.addEventListener('change', onChange)
  }

  if (getCurrentInstance()) {
    onMounted(start)
    onBeforeUnmount(() => media?.removeEventListener('change', onChange))
  } else {
    start()
  }

  return readonly(matches)
}
