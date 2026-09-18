<script setup lang="ts">
/*
 * NE Base design card for NeSortHeader (narduk-libs#528): the header cell's
 * states from the buoys round-2 board — at rest, sorted strongest first,
 * flipped — each in a real `<th>` so the arrow sits where a table puts it.
 * Hover and keyboard focus are the button's own states and are not faked.
 */
import NeSortHeader from '../runtime/components/NeSortHeader.vue'

const rows = [
  { note: 'At rest: no aria-sort', sort: null },
  { note: 'Sorted, strongest first: aria-sort="descending"', sort: 'wind:desc' },
  { note: 'Flipped: aria-sort="ascending"', sort: 'wind:asc' },
] as const
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-sort-header"
    data-name="Sort header"
    data-group="Shell"
  >
    <h2>Sort header</h2>
    <p>
      First click picks the useful way (readings strongest first, names A–Z); the second flips it.
      The arrow, <code>aria-sort</code> and the column tint say which column sorts.
    </p>
    <div v-for="row in rows" :key="row.note" class="preview-row">
      <table>
        <thead>
          <tr>
            <th>
              <NeSortHeader
                label="Wind"
                unit="kt"
                sort-key="wind"
                first-direction="desc"
                align="end"
                :sort="row.sort"
              />
            </th>
          </tr>
        </thead>
      </table>
      <p class="mono">{{ row.note }}</p>
    </div>
  </section>
</template>
