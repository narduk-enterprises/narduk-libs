/**
 * useRouteTab() — the selected tab, kept in the URL as `?tab=trades`.
 *
 * ```ts
 * const { tab } = useRouteTab({
 *   tabs: ['overview', 'trades', 'rules'],
 *   defaultTab: 'overview',
 * })
 * ```
 *
 * `tab` is a writable ref: reading it gives the current tab, assigning it moves
 * the URL. The point is a page whose tab can be linked, reloaded and shared,
 * and whose Back button leaves the page rather than stepping through every tab
 * the visitor clicked.
 *
 * - **`router.replace`, not `push`.** A tab is a view of one page, not a
 *   destination; switching it does not add a history entry.
 * - **The URL stays clean.** The default tab writes no parameter at all
 *   (`/games/42`, not `/games/42?tab=overview`). `keepDefault: true` writes it.
 * - **Other query keys and the hash survive.** `?range=1y&tab=trades#row-9` keeps
 *   `range` and `#row-9` when the tab changes.
 * - **An unknown value falls back.** `?tab=nope`, a repeated `?tab=a&tab=b`
 *   (the first wins) or an empty value read as the default, and assigning a name
 *   not in `tabs` is ignored. `tabs` may be a ref or getter, for a tab set that
 *   depends on the viewer.
 * - **No lag.** The new tab shows on the next frame; the route catches up behind
 *   it (and wins again if the navigation is refused).
 *
 * `NeTabs` takes the same two things through its `routeParam` prop; reach for
 * this composable directly when the tabs are not the shell's, or the panel
 * needs to know the tab outside the tab strip.
 *
 * Needs vue-router (every Nuxt app has one) and a component's setup.
 */
import { computed, ref, toValue } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import type { LocationQueryRaw, LocationQueryValue } from 'vue-router'
import type { MaybeRefOrGetter, WritableComputedRef } from 'vue'

export interface NeRouteTabOptions {
  /** The tab names that are allowed, in a value, ref or getter. */
  tabs: MaybeRefOrGetter<readonly string[]>
  /** The tab shown when the URL names none. Default: the first of `tabs`. */
  defaultTab?: MaybeRefOrGetter<string | undefined>
  /** The query key. Default `tab`. */
  param?: string
  /** Write the parameter even for the default tab. Default `false`. */
  keepDefault?: boolean
}

export interface NeRouteTab {
  /** The current tab. Assigning it moves the URL with `router.replace`. */
  tab: WritableComputedRef<string>
  /** The same as assigning `tab`, as an awaitable call. */
  setTab: (value: string) => Promise<void>
}

function firstValue(value: LocationQueryValue | LocationQueryValue[] | undefined): string {
  const one = Array.isArray(value) ? value[0] : value
  return typeof one === 'string' ? one : ''
}

export function useRouteTab(options: NeRouteTabOptions): NeRouteTab {
  const route = useRoute()
  const router = useRouter()
  if (!route || !router) {
    throw new Error(
      'useRouteTab() needs vue-router. Call it from a component inside a router (every Nuxt app is one).',
    )
  }
  const param = options.param ?? 'tab'

  const tabs = computed(() => toValue(options.tabs))
  const fallback = computed(() => {
    const wanted = toValue(options.defaultTab)
    return wanted !== undefined && tabs.value.includes(wanted) ? wanted : (tabs.value[0] ?? '')
  })

  // The tab the visitor just chose, shown before the route has caught up.
  const chosen = ref<string | null>(null)
  let pending = 0

  const fromRoute = computed(() => {
    const named = firstValue(route.query[param])
    return tabs.value.includes(named) ? named : fallback.value
  })

  async function setTab(value: string): Promise<void> {
    if (!tabs.value.includes(value)) return
    if (value === fromRoute.value && chosen.value === null) return
    chosen.value = value
    const mine = ++pending
    const query: LocationQueryRaw = { ...route.query }
    if (value === fallback.value && !options.keepDefault) delete query[param]
    else query[param] = value
    try {
      await router.replace({ query, hash: route.hash })
    } finally {
      // A later click owns `chosen` now; clearing it here would flash the
      // route's older tab for a frame.
      if (mine === pending) chosen.value = null
    }
  }

  const tab = computed<string>({
    get: () => chosen.value ?? fromRoute.value,
    set: (value) => {
      void setTab(value)
    },
  })

  return { tab, setTab }
}
