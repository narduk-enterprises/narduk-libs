<script setup lang="ts">
// A relative SSR fetch goes through Nitro's internal `localFetch`, which is
// the nested event that lost `event.context.cloudflare` (narduk-libs#49). The
// fallback text is deliberate: the page renders either way, the way the
// RiverStatus page did, so only the probe's own checks can tell them apart.
const { data, error } = await useFetch<{ value: string | null }>('/api/probe')
</script>

<template>
  <main>
    <p data-testid="value">{{ data?.value ?? 'FALLBACK' }}</p>
    <p v-if="error" data-testid="error">{{ error.statusCode }}</p>
  </main>
</template>
