<script setup lang="ts">
const { examples, packages, tokens } = useInventory()

const areas = [
  {
    title: 'Foundations',
    to: '/foundations',
    description: `${tokens.length} coded tokens: colour, type, radius and elevation, light and dark.`,
  },
  {
    title: 'Components',
    to: '/components',
    description: `${examples.length} demos of the shared Ne* suite, with previews and usage.`,
  },
  {
    title: 'Packages',
    to: '/packages',
    description: `All ${packages.length} workspace packages: purpose, capabilities, install and imports.`,
  },
]

const planned = ['Charts', 'Map lab', 'Composed examples']
</script>

<template>
  <div class="space-y-8">
    <NePageHeader
      eyebrow="narduk-libs"
      title="Narduk Libs Explorer"
      description="The shared Narduk components, design foundations and package catalog, rendered from the workspace source."
    />
    <div class="grid gap-4 md:grid-cols-3">
      <NuxtLink
        v-for="area in areas"
        :key="area.to"
        :to="area.to"
        class="block rounded-lg border border-default bg-default p-5 hover:border-accented"
      >
        <h2 class="font-semibold text-highlighted">{{ area.title }}</h2>
        <p class="mt-2 text-sm text-muted">{{ area.description }}</p>
      </NuxtLink>
    </div>
    <p class="text-sm text-muted">Coming in later increments: {{ planned.join(', ') }}.</p>
  </div>
</template>
