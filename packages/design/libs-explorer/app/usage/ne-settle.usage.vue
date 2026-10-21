<script setup lang="ts">
import { ref } from 'vue'

const arrival = ref(0)
</script>
<template>
  <div class="grid gap-4">
    <UButton label="Move sample trailer to dock" @click="arrival += 1" />
    <NeSettle :motion-key="arrival">
      <p class="border border-default bg-default p-4">Sample trailer · Dock {{ arrival + 1 }}</p>
    </NeSettle>
  </div>
</template>
