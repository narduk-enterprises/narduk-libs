<script setup lang="ts">
/*
 * NE Base design card for NeFilterBar (narduk-libs#261): the three kinds, and
 * the state a reviewer most needs to see — a filter whose rows do not exist
 * yet, still in the row rather than quietly dropped.
 *
 * Each row is live and selectable, because the thing worth reviewing is what
 * selection looks like next to the controls beside it: a chip that changes
 * size on click reflows its neighbours, and that is only visible by clicking.
 */
import { ref } from 'vue'

import NeFilterBar from '../runtime/components/NeFilterBar.vue'

import type { NeFilterBarItem } from '../runtime/components/ne-filter-bar-types'

const states: NeFilterBarItem[] = [
  { key: 'all', label: 'All', count: 24 },
  { key: 'open', label: 'Open', count: 7 },
  { key: 'done', label: 'Done', count: 17 },
  { key: 'draft', label: 'Draft' },
]

const scopes: NeFilterBarItem[] = [
  { key: 'mine', label: 'Mine', count: 4 },
  { key: 'team', label: 'Team', count: 19 },
  { key: 'owner', label: 'By owner', disabled: true, title: 'Lands with the owner ledger' },
]

const views: NeFilterBarItem[] = [
  { key: 'board', label: 'Board' },
  { key: 'table', label: 'Table' },
  { key: 'timeline', label: 'Timeline' },
]

const state = ref<string | null>('open')
const scope = ref<string | null>('team')
const view = ref<string | null>('board')
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-filter-bar"
    data-name="Filter bar"
    data-group="Shell"
  >
    <h2>Filter bar</h2>
    <p>
      The row above a collection. Three kinds share one DOM shape and differ in what they mean:
      <code>chips</code> toggle, <code>facets</code> scope, <code>tabs</code> are a real
      <code>tablist</code> with the APG keyboard model. A count is the caller's figure, never
      derived here.
    </p>

    <div class="preview-row">
      <NeFilterBar v-model="state" label="State" :items="states" />
      <p class="mono">
        chips · selection is aria-pressed · “Draft” passes no count, so none renders
      </p>
    </div>

    <div class="preview-row">
      <NeFilterBar
        v-model="scope"
        kind="facets"
        label="Scope"
        :items="scopes"
        note="By owner lands with the owner ledger"
      />
      <p class="mono">
        facets · “By owner” has no producer yet: it stays in the row, aria-disabled, with the note
        saying when it lands. Dropping it would make the product look finished and be narrower than
        it claims.
      </p>
    </div>

    <div class="preview-row">
      <NeFilterBar v-model="view" kind="tabs" label="View" id-prefix="demo" :items="views" />
      <p class="mono">tabs · arrows wrap, Home and End jump, one tab in the page tab order</p>
    </div>
  </section>
</template>
