/**
 * useRowLimit() — the first `n` rows of a list, then every row on request.
 *
 * The same rule as `NeCollectionTable`'s `limit`, for the lists that are not a
 * table: an agenda, a feed, a stack of cards. Pass the WHOLE list, flattened
 * across any grouping, so the cap runs across groups and `hidden` counts what
 * `NeShowMore` would add. It slices; it does not sort, filter or fetch.
 *
 * ```vue
 * const limit = useRowLimit(() => items.value, 5)
 * <li v-for="item in limit.visible.value" :key="item.id">…</li>
 * <NeShowMore :total="limit.total.value" :hidden="limit.hidden.value" @expand="limit.expand" />
 * ```
 *
 * `n` may follow the viewport (five on a phone, ten on a desk): pass a ref or a
 * getter. The expanded state lives in the composable and nothing enters the
 * URL. It stays expanded when `items` changes; call `collapse()` to cap again.
 */
import { computed, ref, toValue } from 'vue'

import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'

export interface NeRowLimit<T> {
  /** Cap again after `expand()`. */
  collapse: () => void
  /** Show every row. */
  expand: () => void
  /** How many rows are cut. `0` when the list fits or is expanded. */
  hidden: ComputedRef<number>
  /** `true` once expanded. Writable, so a caller can bind it. */
  showAll: Ref<boolean>
  /** The whole list's length, not the visible slice's. */
  total: ComputedRef<number>
  /** The rows to draw: the first `n`, or all of them once expanded. */
  visible: ComputedRef<readonly T[]>
}

/** `n` as a whole, non-negative count. A non-finite `n` (`NaN`, `undefined` cast) shows no cap. */
function capOf(n: number): number {
  if (Number.isNaN(n)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor(n))
}

export function useRowLimit<T>(
  items: MaybeRefOrGetter<readonly T[]>,
  n: MaybeRefOrGetter<number>,
): NeRowLimit<T> {
  const showAll = ref(false)
  const total = computed(() => toValue(items).length)
  const visible = computed<readonly T[]>(() =>
    showAll.value ? toValue(items) : toValue(items).slice(0, capOf(toValue(n))),
  )
  const hidden = computed(() => total.value - visible.value.length)
  return {
    visible,
    hidden,
    showAll,
    total,
    expand: () => {
      showAll.value = true
    },
    collapse: () => {
      showAll.value = false
    },
  }
}
