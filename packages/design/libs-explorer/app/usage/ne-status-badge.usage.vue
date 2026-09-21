<script setup lang="ts">
type RunnerState = 'online' | 'busy' | 'offline'

// One place maps a domain state to a tone and a word; every badge reads it.
const runnerStatus = defineStatusMap<RunnerState>({
  online: ['ok', 'Online'],
  busy: ['warn', 'Busy'],
  offline: ['error', 'Offline'],
})

const runners: { name: string; state: RunnerState }[] = [
  { name: 'proxmox9-a', state: 'online' },
  { name: 'proxmox9-b', state: 'busy' },
  { name: 'imac-arm', state: 'offline' },
]
</script>

<template>
  <ul class="space-y-2">
    <li v-for="runner in runners" :key="runner.name" class="flex items-center gap-3">
      <span class="w-28 font-mono text-sm">{{ runner.name }}</span>
      <NeStatusBadge v-bind="runnerStatus(runner.state)" />
    </li>
  </ul>
</template>
