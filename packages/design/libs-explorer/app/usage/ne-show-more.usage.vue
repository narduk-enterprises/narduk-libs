<script setup lang="ts">
const runners = ['ci-a', 'ci-b', 'ci-c', 'ci-d', 'ci-e', 'ci-f', 'ci-g']
const limit = useRowLimit(runners, 3)
</script>

<template>
  <div class="flex flex-col text-sm">
    <ul id="runners-demo" class="list-disc pl-5">
      <li v-for="runner in limit.visible.value" :key="runner">{{ runner }}</li>
    </ul>
    <NeShowMore
      controls="runners-demo"
      noun="runners"
      :total="limit.total.value"
      :hidden="limit.hidden.value"
      @expand="limit.expand"
    />
  </div>
</template>
