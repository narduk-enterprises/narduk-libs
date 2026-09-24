<script setup lang="ts">
/*
 * NE Base design card for NeCardList (narduk-libs#264): the card reading of
 * the same collection state a table draws. Populated, empty, and loading —
 * NeStatePanel and NePager are built in. No `:to` on the pager: this card
 * server-renders with no router, the same constraint NePager.card.vue has.
 */
import NeCard from '../runtime/components/NeCard.vue'
import NeCardList from '../runtime/components/NeCardList.vue'

import type { NeCollectionState } from '../runtime/composables/use-collection'

interface River {
  id: string
  name: string
  stage: number | null
}

const state = (over: Partial<NeCollectionState<River>> = {}): NeCollectionState<River> => ({
  error: null,
  filters: {},
  hasNext: false,
  hasPrevious: false,
  items: [
    { id: 'des-plaines', name: 'Des Plaines', stage: 5.2 },
    { id: 'fox', name: 'Fox', stage: 3.1 },
    { id: 'kishwaukee', name: 'Kishwaukee', stage: null },
  ],
  limit: 25,
  offset: 0,
  page: 1,
  pageCount: 1,
  pending: false,
  q: '',
  sort: null,
  total: 3,
  ...over,
})

const populated = state({})
const empty = state({ items: [], total: 0 })
const loading = state({ items: [], pending: true, total: null })
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-card-list"
    data-name="Card list"
    data-group="Shell"
  >
    <h2>Card list</h2>
    <p>
      Same <code>v-model:state</code> as the table, so one page toggles cards and table.
      <code>NeStatePanel</code> and <code>NePager</code> are built in.
    </p>

    <div class="preview-row">
      <NeCardList :state="populated" noun="rivers" :columns="{ base: 1, md: 2, xl: 3 }">
        <template #card="{ item }">
          <NeCard
            :title="item.name"
            :stats="[{ label: 'Stage', unit: 'foot', value: item.stage }]"
          />
        </template>
      </NeCardList>
      <p class="mono">populated · three cards, pager under the grid</p>
    </div>

    <div class="preview-row">
      <NeCardList :state="empty" empty-title="No rivers" empty-message="Nothing matches." />
      <p class="mono">empty · NeStatePanel, not an empty grid</p>
    </div>

    <div class="preview-row">
      <NeCardList :state="loading" loading-title="Loading rivers" />
      <p class="mono">loading · aria-busy, last good page would stay if it existed</p>
    </div>
  </section>
</template>
