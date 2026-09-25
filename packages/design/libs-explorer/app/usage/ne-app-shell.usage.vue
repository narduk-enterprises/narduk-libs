<script setup lang="ts">
import type { NeAppShellSection } from '@narduk-enterprises/narduk-shell'

// In an app, set these once in nuxt.config under `nardukShell.sections` and
// leave the prop off: `useNardukShellSections()` is then the shared state.
const sections: NeAppShellSection[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { label: 'Overview', to: '/', icon: 'i-lucide-layout-dashboard' },
      { label: 'Alerts', to: '/alerts', icon: 'i-lucide-bell', badge: 3 },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [{ label: 'Account', to: '/settings', icon: 'i-lucide-user' }],
  },
]
</script>

<template>
  <NeAppShell :sections="sections">
    <template #rail-top>
      <span>Buoys</span>
    </template>
    <NePageHeader title="Overview" />
  </NeAppShell>
</template>
