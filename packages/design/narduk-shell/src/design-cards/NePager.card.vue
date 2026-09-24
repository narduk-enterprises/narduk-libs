<script setup lang="ts">
/*
 * NE Base design card for NePager — components backlog item 11
 * (narduk-libs#258).
 *
 * Three readings, because `total` is genuinely optional in the list-query
 * contract: a counted collection gets page numbers, an uncounted one gets
 * Previous/Next, and an empty one says so rather than rendering `0–0 of 0`.
 * `density="dense"` is the fourth row — pacc-trac's `DenseListPager` is that
 * prop and nothing else.
 *
 * No `:to` here on purpose. The gallery is prerendered by `nuxt generate` and
 * `test/design-cards.test.ts` server-renders every card with NO router
 * installed, so a card that asked Nuxt UI to resolve a location would throw in
 * both. The href claim is proved where it can be proved honestly, against a
 * real router, in `test/NePager.ssr.test.ts`.
 */
import NePager from '../runtime/components/NePager.vue'

import type { NeCollectionState } from '../runtime/composables/use-collection'

/** A reading the pager can render, written out rather than fetched. */
const state = (over: Partial<NeCollectionState<unknown>>): NeCollectionState<unknown> => ({
  error: null,
  filters: {},
  hasNext: true,
  hasPrevious: true,
  items: Array.from({ length: 25 }, (_, index) => ({ id: index })),
  limit: 25,
  offset: 50,
  page: 3,
  pageCount: 29,
  pending: false,
  q: '',
  sort: null,
  total: 712,
  ...over,
})

const counted = state({})
const dense = state({})
const uncounted = state({ pageCount: null, total: null })
const firstPage = state({ hasPrevious: false, offset: 0, page: 1, pageCount: 11, total: 264 })
const empty = state({
  hasNext: false,
  hasPrevious: false,
  items: [],
  offset: 0,
  page: 1,
  pageCount: 0,
  total: 0,
})
</script>

<template>
  <section class="preview-card" data-design-card="ne-pager" data-name="Pager" data-group="Shell">
    <h2>Pager</h2>
    <p>
      The foot of a paged list. It owns no state: the whole reading arrives through
      <code>v-model:state</code> from <code>useCollection()</code>, and the only thing it writes
      back is the page number.
    </p>
    <div class="preview-row">
      <NePager :state="counted" noun="runners" />
    </div>
    <div class="preview-row">
      <NePager :state="dense" density="dense" noun="runners" />
    </div>
    <div class="preview-row">
      <NePager :state="uncounted" noun="runners" />
    </div>
    <div class="preview-row">
      <NePager :state="empty" noun="runners" />
    </div>
    <div class="preview-row">
      <NePager :state="firstPage" noun="stations" :page-sizes="[25, 50, 100]" />
    </div>
    <div class="preview-row">
      <NePager :state="firstPage" noun="stations" mode="more" :max-limit="100" />
    </div>
  </section>
</template>
