<script setup lang="ts">
// The global `$fetch` during SSR goes through Nitro's `localFetch` with a
// fresh event that carries no `event.context.cloudflare` -- unlike `useFetch`,
// which forwards the request's context. This is the nested request that lost
// the D1 binding (narduk-libs#49).
const { data, error } = await useAsyncData('probe-plain', () =>
  $fetch<{ value: string | null }>('/api/probe'),
)
</script>

<template>
  <main>
    <p data-testid="value">{{ data?.value ?? 'FALLBACK' }}</p>
    <p v-if="error" data-testid="error">{{ error.statusCode }}</p>
  </main>
</template>
