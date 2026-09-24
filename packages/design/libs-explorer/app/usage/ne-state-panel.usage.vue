<script setup lang="ts">
import type { NeStateValue } from '@narduk-enterprises/narduk-shell'

const runners = ref<string[]>([])
// No state draws the default slot; 'empty' draws the panel and its action.
const state = computed<NeStateValue | undefined>(() =>
  runners.value.length === 0 ? 'empty' : undefined,
)

function register() {
  runners.value = [...runners.value, `runner-${runners.value.length + 1}`]
}
</script>

<template>
  <NeStatePanel
    :state="state"
    title="No runners"
    message="No runner has registered with the fleet yet."
    icon="i-lucide-server"
  >
    <ul class="font-mono text-sm">
      <li v-for="runner in runners" :key="runner">{{ runner }}</li>
    </ul>
    <template #action>
      <UButton @click="register">Register one</UButton>
    </template>
  </NeStatePanel>
</template>
