<script setup lang="ts">
/*
 * NE Base design card for NeShowMore and useRowLimit (portal-polish L1): a
 * list capped at three rows, live. Click the button and the rest appear and the
 * button goes with them, because nothing is hidden any more.
 */
import { ref } from 'vue'

import NeShowMore from '../runtime/components/NeShowMore.vue'
import { useRowLimit } from '../runtime/composables/use-row-limit'

const rows = ref(['ci-a', 'ci-b', 'ci-c', 'ci-d', 'ci-e', 'ci-f', 'ci-g'])
const limit = useRowLimit(rows, 3)
</script>

<template>
  <section
    class="preview-card"
    data-design-card="ne-show-more"
    data-name="Show more"
    data-group="Shell"
  >
    <h2>Show more</h2>
    <p>
      The first few rows of a list that is not a table, then “Show all N” for the rest.
      <code>useRowLimit</code> slices, <code>NeShowMore</code> asks.
    </p>
    <div class="preview-row" style="display: flex; flex-direction: column">
      <ul id="show-more-demo">
        <li v-for="row in limit.visible.value" :key="row">{{ row }}</li>
      </ul>
      <NeShowMore
        controls="show-more-demo"
        noun="runners"
        :total="limit.total.value"
        :hidden="limit.hidden.value"
        @expand="limit.expand"
      />
    </div>
  </section>
</template>
