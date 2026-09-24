<script setup lang="ts">
import { exampleRoute } from '~/composables/useInventory'

const { examples, packages } = useInventory()
const packageSlug = (name: string) => packages.find((entry) => entry.name === name)?.slug ?? name

useSeoMeta({ title: 'Components — Narduk Libs Explorer' })
</script>

<template>
  <div class="space-y-8">
    <NePageHeader
      eyebrow="Components"
      title="Shared components"
      description="Every component narduk-shell registers, previewed from its package-owned design card. Interactive demos add controls, presets and an event log."
    />
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="example in examples"
        :key="example.id"
        :to="exampleRoute(example.id, example.category)"
        class="block rounded-lg border border-default bg-default p-4 hover:border-accented"
      >
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-semibold text-highlighted">{{ example.title }}</h2>
          <UBadge v-if="example.interactive" color="primary" variant="subtle" size="sm">
            Interactive
          </UBadge>
        </div>
        <p class="mt-1 font-mono text-xs text-muted">
          {{ example.component ?? example.id }} · {{ packageSlug(example.package) }}
        </p>
        <p class="mt-2 text-sm text-muted">{{ example.summary }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
