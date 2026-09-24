<script setup lang="ts">
/*
 * NE Base design card for NeSearchInput (narduk-libs#261): the other half of
 * item 14. Empty, applied, pending, and sitting beside NeFilterBar — because
 * the thing worth reviewing is that a search is a text control next to the
 * row, not a member of it.
 */
import { ref } from 'vue'

import NeFilterBar from '../runtime/components/NeFilterBar.vue'
import NeSearchInput from '../runtime/components/NeSearchInput.vue'

import type { NeFilterBarItem } from '../runtime/components/ne-filter-bar-types'

const states: NeFilterBarItem[] = [
  { key: 'all', label: 'All', count: 24 },
  { key: 'open', label: 'Open', count: 7 },
  { key: 'done', label: 'Done', count: 17 },
]

const empty = ref('')
const applied = ref('gtm1500')
const pending = ref('heartbeat')
const together = ref('runner')
const state = ref<string | null>('open')
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-search-input"
    data-name="Search input"
    data-group="Shell"
  >
    <h2>Search input</h2>
    <p>
      The text control beside a collection. <code>v-model</code> is the applied term, after 250 ms;
      the box shows the keystroke. Clear does not wait. Bind <code>v-model="c.q"</code> with
      <code>:debounce="0"</code> — the collection already applies its own window.
    </p>

    <div class="preview-row">
      <NeSearchInput v-model="empty" label="Search runners" placeholder="Search runners" />
      <p class="mono">empty · placeholder is a hint, not the accessible name</p>
    </div>

    <div class="preview-row">
      <NeSearchInput
        v-model="applied"
        label="Search runners"
        placeholder="Search runners"
        show-summary
      />
      <p class="mono">applied · trailing clear is the reset; the summary names the live term</p>
    </div>

    <div class="preview-row">
      <NeSearchInput
        v-model="pending"
        label="Search runners"
        placeholder="Search runners"
        pending
      />
      <p class="mono">pending · aria-busy, not only a spinner</p>
    </div>

    <div class="preview-row">
      <div class="flex flex-wrap items-center gap-3">
        <NeSearchInput v-model="together" label="Search runners" placeholder="Search runners" />
        <NeFilterBar v-model="state" label="State" :items="states" />
      </div>
      <p class="mono">
        beside the row, never in it · the chips stay a group; the field stays a text control
      </p>
    </div>
  </section>
</template>
