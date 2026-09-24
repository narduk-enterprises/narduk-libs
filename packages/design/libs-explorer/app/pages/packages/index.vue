<script setup lang="ts">
const { packages } = useInventory()
const FAMILIES = ['design', 'modules', 'tooling', 'contracts']
const families = computed(() =>
  FAMILIES.map((family) => ({
    family,
    entries: packages.filter((entry) => entry.family === family),
  })).filter(({ entries }) => entries.length > 0),
)

useSeoMeta({ title: 'Packages — Narduk Libs Explorer' })
</script>

<template>
  <div class="space-y-8">
    <NePageHeader
      eyebrow="Catalog"
      title="Packages"
      :description="`All ${packages.length} packages in the narduk-libs workspace, read from pnpm-workspace.yaml.`"
    />
    <section v-for="{ family, entries } in families" :key="family" class="space-y-3">
      <NeSectionHeader :title="family" :count="entries.length" />
      <div class="grid gap-3 md:grid-cols-2">
        <NuxtLink
          v-for="entry in entries"
          :key="entry.name"
          :to="`/packages/${entry.slug}`"
          class="block rounded-lg border border-default bg-default p-4 hover:border-accented"
        >
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="font-mono text-sm font-semibold text-highlighted">{{ entry.slug }}</h3>
            <UBadge color="neutral" variant="subtle" size="sm">{{ entry.kind }}</UBadge>
            <UBadge v-if="entry.private" color="neutral" variant="outline" size="sm"
              >private</UBadge
            >
            <span class="ml-auto font-mono text-xs text-muted">{{ entry.version }}</span>
          </div>
          <p class="mt-2 text-sm text-muted">{{ entry.description }}</p>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>
