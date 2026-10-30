<script setup lang="ts">
import NeCursorPager from '../runtime/components/NeCursorPager.vue'

import type { NeCursorCollectionState } from '../runtime/composables/use-cursor-collection'

const state: NeCursorCollectionState<unknown> = {
  cursor: null,
  error: null,
  hasNext: true,
  hasPrevious: false,
  items: [{ id: 1 }],
  limit: 25,
  nextCursor: 'opaque',
  pending: false,
  q: '',
  sort: null,
  total: null,
}
</script>
<template>
  <section data-design-card="ne-cursor-pager" data-name="NeCursorPager" data-group="Collections">
    <NeCursorPager :state="state" noun="revisions" />
  </section>
</template>
