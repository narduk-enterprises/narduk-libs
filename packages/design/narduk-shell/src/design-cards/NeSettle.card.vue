<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import { ref } from 'vue'

import NeSettle from '../runtime/components/NeSettle.vue'

const arrival = ref(0)
</script>
<template>
  <section
    class="preview-card"
    data-design-card="ne-settle"
    data-name="Settle"
    data-group="Hall of fame"
  >
    <h2>Settle</h2>
    <p>Extracted from a shipped design; sample data only.</p>

    <div class="grid gap-4">
      <UButton label="Move sample trailer to dock" @click="arrival += 1" />
      <NeSettle :motion-key="arrival">
        <p class="border border-default bg-default p-4">Sample trailer · Dock {{ arrival + 1 }}</p>
      </NeSettle>
    </div>
  </section>
</template>
