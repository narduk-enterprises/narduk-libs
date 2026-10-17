<script setup lang="ts">
const handback =
  'Two calls: 1. Keep **Redis** for the queue. 2. Move the probe to `cron`. See [the PR](https://github.com/narduk-enterprises/narduk-libs/pull/1502).'
const title = 'Rotate the `API_KEY` before it **expires**'
</script>

<template>
  <div class="space-y-3">
    <NeMessageProse :text="handback" :clamp="7" />
    <p class="truncate">
      <NeMessageProse :text="title" mode="inline" />
    </p>
  </div>
</template>
