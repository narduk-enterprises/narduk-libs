<script setup lang="ts">
const { source } = useInventory()
const route = useRoute()
const query = ref('')
const index = useSearchIndex()

const groups = computed(() => {
  const shown = index.filter((entry) => matchesQuery(entry, query.value))
  return (['Overview', 'Components', 'Packages'] as const)
    .map((group) => ({ group, entries: shown.filter((entry) => entry.group === group) }))
    .filter(({ entries }) => entries.length > 0)
})

const shortCommit = computed(() => source.commit?.slice(0, 7) ?? 'unknown')

// On a phone the navigation folds behind a Menu button and closes on navigation.
const navOpen = ref(false)
function toggleNav() {
  navOpen.value = !navOpen.value
}
watch(
  () => route.path,
  () => (navOpen.value = false),
)
</script>

<template>
  <div class="min-h-screen lg:grid lg:grid-cols-[18rem_1fr]">
    <aside
      class="border-b border-default bg-default lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-r lg:border-b-0"
    >
      <div class="flex items-center justify-between gap-2 p-4">
        <NuxtLink to="/" class="font-semibold text-highlighted">Narduk Libs Explorer</NuxtLink>
        <div class="flex items-center gap-1">
          <UColorModeButton />
          <UButton
            class="lg:hidden"
            size="sm"
            color="neutral"
            variant="ghost"
            :icon="navOpen ? 'i-lucide-x' : 'i-lucide-menu'"
            :aria-expanded="navOpen"
            aria-controls="explorer-nav"
            @click="toggleNav"
          >
            Menu
          </UButton>
        </div>
      </div>
      <div id="explorer-nav" :class="navOpen ? 'block' : 'hidden'" class="lg:block">
        <div class="px-4 pb-3">
          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Search components, packages, capabilities"
            aria-label="Search the Explorer"
            class="w-full"
            data-testid="explorer-search"
          />
        </div>
        <nav aria-label="Explorer" class="px-2 pb-6">
          <p v-if="groups.length === 0" class="px-2 text-sm text-muted">
            Nothing matches “{{ query }}”.
          </p>
          <div v-for="{ group, entries } in groups" :key="group" class="mb-4">
            <p class="px-2 pb-1 text-xs font-medium tracking-wide text-muted uppercase">
              {{ group }}
            </p>
            <ul>
              <li v-for="entry in entries" :key="entry.to">
                <NuxtLink
                  :to="entry.to"
                  class="block rounded-md px-2 py-1 text-sm text-default hover:bg-elevated"
                  :class="{ 'bg-elevated font-medium text-highlighted': route.path === entry.to }"
                >
                  {{ entry.label }}
                </NuxtLink>
              </li>
            </ul>
          </div>
        </nav>
      </div>
    </aside>
    <div class="min-w-0">
      <main class="mx-auto max-w-6xl p-4 sm:p-8">
        <slot />
      </main>
      <footer class="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted sm:px-8">
        Built from
        <a
          v-if="source.commit"
          :href="`${source.repository}/commit/${source.commit}`"
          class="font-mono underline"
          data-testid="source-commit"
          >{{ shortCommit }}</a
        >
        <span v-else class="font-mono">an unknown commit</span>
        of narduk-libs. Packages install from GitHub Packages (<code>@narduk-enterprises</code>
        scope, token required).
      </footer>
    </div>
  </div>
</template>
