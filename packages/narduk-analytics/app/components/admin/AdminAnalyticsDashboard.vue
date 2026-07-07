<script setup lang="ts">
/* eslint-disable vue/no-undef-components -- admin panels are Nuxt auto-imports from this layer */
</script>

<template>
  <div class="space-y-6">
    <AdminGaOverviewPanel />
    <AdminGscPerformancePanel />
    <AdminPosthogPanel />
  </div>
</template>
