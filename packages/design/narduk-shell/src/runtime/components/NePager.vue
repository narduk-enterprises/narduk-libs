<script setup lang="ts">
/**
 * NePager — the foot of a paged list (components backlog item 11,
 * narduk-libs#258). pacc-trac's `DenseListPager` is `density="dense"`.
 *
 * It wraps Nuxt UI's `UPagination` and owns no state of its own: the whole
 * reading comes in through `v-model:state`, and the only thing the pager can
 * write back is the page number. `useCollection()` is what enforces the rest
 * (the page reset, the clamp, single-flight), so a pager that could also
 * change `q` or `sort` would be a way around those rules rather than a feature.
 *
 * ## Two shapes, because `total` is genuinely optional
 *
 * `listResponse` returns `total: null` unless the route opts into counting it
 * (that is the contract's one-statement path). A page-numbered control is a
 * lie without a count — it cannot know how many pages there are — so:
 *
 * - `total` is a number → `UPagination`, real page numbers.
 * - `total` is `null` → Previous / Next only, driven by the collection's own
 *   `hasPrevious` / `hasNext`.
 *
 * ## `:to` emits real hrefs
 *
 * With `:to`, every control renders as an `<a href>` — Nuxt UI's `UButton`
 * resolves the location through the router — so a crawler follows page two and
 * a middle-click opens it in a tab. riverstatus's rivers list is the SEO pilot
 * for exactly this. `test/NePager.ssr.test.ts` renders the REAL `UPagination`
 * through a real router and asserts the hrefs in the server output, because a
 * stub asserting its own markup would prove nothing about that claim.
 *
 * Nothing here is ever disabled while a request is in flight. Disabling a link
 * is how a pager takes middle-click and "open in new tab" away from a reader
 * for 200ms; the summary carries `aria-busy` instead.
 *
 * Window and total counts go through `formatNumber` (fixed `en-US`), never
 * `new Intl.NumberFormat()` — the same SSR-stability rule as `NeKpiTile`.
 *
 * ## Page size and "Show more" (narduk-libs#528)
 *
 * The page-size select and the phone "Show 25 more" button both change the
 * LIMIT, which this pager's model deliberately cannot write. They emit
 * `update:limit` instead, for `useCollection().setLimit` — which resets to page
 * one by its own rule, so a grown page is rows 1–50 in one request and the list
 * keeps its scroll. "Show more" only offers itself on page one with more to
 * come and headroom under `maxLimit`; anywhere else the numbered pages show,
 * because a button that cannot do what it says is worse than a page link.
 */
import UButton from '@nuxt/ui/components/Button.vue'
import UPagination from '@nuxt/ui/components/Pagination.vue'
import USelect from '@nuxt/ui/components/Select.vue'
import { computed } from 'vue'

import { formatNumber } from '../../format'

import type { NeCollectionState } from '../composables/use-collection'
import type { NePagerProps } from './ne-pager-types'

const props = withDefaults(defineProps<NePagerProps>(), {
  density: 'default',
  maxLimit: undefined,
  mode: 'pages',
  moreStep: undefined,
  noun: 'results',
  pageSizes: undefined,
  siblingCount: 2,
  showControls: true,
  showSummary: true,
  to: undefined,
})

/**
 * Assigning to this model applies `page` only — `useCollection`'s setter
 * ignores every other field on purpose. See the composable's `state` doc.
 */
const state = defineModel<NeCollectionState<unknown>>('state', { required: true })

const emit = defineEmits<{ 'update:limit': [limit: number] }>()

const dense = computed(() => props.density === 'dense')

const first = computed(() => state.value.offset + 1)
const last = computed(() => state.value.offset + state.value.items.length)

/**
 * Four readings, and none of them invents a number it does not have:
 * a counted route gets `1–25 of 712 rivers`, an uncounted one gets the window
 * it is actually showing, and an empty set says so instead of `0–0 of 0`.
 */
const summary = computed(() => {
  const { items, total } = state.value
  if (items.length === 0) {
    return total === null || total === 0 ? `No ${props.noun}` : `No ${props.noun} on this page`
  }
  const window = `${formatNumber(first.value)}–${formatNumber(last.value)}`
  return total === null
    ? `${window} ${props.noun}`
    : `${window} of ${formatNumber(total)} ${props.noun}`
})

/** `UPagination` cannot page an uncounted collection; the fallback can. */
const counted = computed(() => state.value.total !== null)

/** Captured once: "Show 25 more" keeps saying 25 after the page has grown to 50. */
const initialLimit = state.value.limit
const step = computed(() => Math.max(1, props.moreStep ?? initialLimit))

const canGrow = computed(
  () =>
    state.value.page === 1 &&
    state.value.hasNext &&
    (props.maxLimit === undefined || state.value.limit < props.maxLimit),
)
const showMore = computed(() => props.mode !== 'pages' && canGrow.value)
/** In `'more'` mode the numbered pages give way entirely while "Show more" can work. */
const showPages = computed(() => !(showMore.value && props.mode === 'more'))
const pagesClass = computed(() => (showMore.value && props.mode === 'auto' ? 'max-sm:hidden' : ''))

const moreLabel = computed(() => {
  const { items, offset, total } = state.value
  const remaining = total === null ? step.value : total - offset - items.length
  return `Show ${formatNumber(Math.max(1, Math.min(step.value, remaining)))} more`
})

function more(): void {
  const next = state.value.limit + step.value
  emit('update:limit', props.maxLimit === undefined ? next : Math.min(next, props.maxLimit))
}

const pageSizeItems = computed(() =>
  props.pageSizes?.map((size) => ({ label: `${formatNumber(size)} per page`, value: size })),
)

function pickLimit(value: unknown): void {
  const limit = Number(value)
  if (Number.isInteger(limit) && limit > 0 && limit !== state.value.limit) {
    emit('update:limit', limit)
  }
}

function goTo(page: number): void {
  if (page === state.value.page) return
  state.value = { ...state.value, page }
}
</script>

<template>
  <div
    data-ne-pager
    :data-ne-pager-density="density"
    :data-ne-pager-mode="mode"
    class="flex flex-wrap items-center justify-between"
    :class="dense ? 'gap-2 text-xs' : 'gap-3 text-sm'"
  >
    <UButton
      v-if="showMore"
      data-ne-pager-more
      color="neutral"
      variant="outline"
      block
      class="basis-full"
      :class="mode === 'auto' ? 'sm:hidden' : ''"
      :label="moreLabel"
      :size="dense ? 'xs' : 'sm'"
      @click="more"
    />

    <div v-if="showSummary || pageSizeItems" class="flex flex-wrap items-center gap-3">
      <p
        v-if="showSummary"
        data-ne-pager-summary
        aria-live="polite"
        :aria-busy="state.pending ? 'true' : undefined"
        class="text-muted tabular-nums"
      >
        <slot name="summary" :state="state" :summary="summary">{{ summary }}</slot>
      </p>
      <USelect
        v-if="pageSizeItems"
        data-ne-pager-size
        aria-label="Rows per page"
        color="neutral"
        variant="outline"
        :items="pageSizeItems"
        :model-value="state.limit"
        :size="dense ? 'xs' : 'sm'"
        @update:model-value="pickLimit"
      />
    </div>

    <template v-if="showPages">
      <UPagination
        v-if="counted"
        aria-label="Pagination"
        class="ms-auto"
        :class="pagesClass"
        :items-per-page="state.limit"
        :page="state.page"
        :show-controls="showControls"
        :sibling-count="siblingCount"
        :size="dense ? 'xs' : 'sm'"
        :to="to"
        :total="state.total ?? 0"
        @update:page="goTo"
      />
      <nav
        v-else
        aria-label="Pagination"
        class="ms-auto flex items-center"
        :class="[dense ? 'gap-1' : 'gap-2', pagesClass]"
      >
        <UButton
          data-ne-pager-previous
          color="neutral"
          variant="outline"
          :disabled="!state.hasPrevious"
          label="Previous"
          :size="dense ? 'xs' : 'sm'"
          :to="state.hasPrevious ? to?.(state.page - 1) : undefined"
          @click="goTo(state.page - 1)"
        />
        <UButton
          data-ne-pager-next
          color="neutral"
          variant="outline"
          :disabled="!state.hasNext"
          label="Next"
          :size="dense ? 'xs' : 'sm'"
          :to="state.hasNext ? to?.(state.page + 1) : undefined"
          @click="goTo(state.page + 1)"
        />
      </nav>
    </template>
  </div>
</template>
