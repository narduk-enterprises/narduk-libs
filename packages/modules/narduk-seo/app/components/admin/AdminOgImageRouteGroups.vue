<script setup lang="ts">
import type {
  AdminOgImageRoutePreviewEntry,
  AdminOgImageRoutePreviewGroup,
} from '../../types/adminOgImageRoutePreview'

const { groups, pending = false } = defineProps<{
  groups: AdminOgImageRoutePreviewGroup[]
  pending?: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

const requestUrl = useRequestURL()
const cacheBuster = shallowRef(0)
const copiedKey = shallowRef('')
const clipboardSupported = computed(() => {
  if (!import.meta.client) return false
  return typeof globalThis.navigator?.clipboard?.writeText === 'function'
})

function previewUrl(src: string) {
  if (!cacheBuster.value) return src
  return `${src}${src.includes('?') ? '&' : '?'}t=${cacheBuster.value}`
}

function handleRefresh() {
  cacheBuster.value = Date.now()
  emit('refresh')
}

async function copyUrl(entry: AdminOgImageRoutePreviewEntry) {
  if (!import.meta.client) return
  if (typeof globalThis.navigator?.clipboard?.writeText !== 'function') return
  await globalThis.navigator.clipboard.writeText(`${requestUrl.origin}${entry.imageSrc}`)
  copiedKey.value = entry.imageSrc
  window.setTimeout(() => {
    if (copiedKey.value === entry.imageSrc) copiedKey.value = ''
  }, 2000)
}
</script>

<template>
  <div class="space-y-8 p-4 sm:p-6">
    <section class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-sm uppercase tracking-[0.22em] text-primary/80">SEO</p>
        <h1 class="text-3xl font-semibold tracking-tight text-default">OG route previews</h1>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Open Graph images resolved from live route HTML (prefers <code>/_og/</code> when present).
          Static fallback: <code>public/og.png</code>.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UTooltip text="Re-fetch every preview (cache-bust)">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            label="Refresh"
            :loading="pending"
            @click="handleRefresh"
          />
        </UTooltip>
      </div>
    </section>

    <section v-for="group in groups" :key="group.title" class="space-y-4">
      <div class="flex items-baseline justify-between gap-4">
        <h2 class="text-lg font-semibold text-default">{{ group.title }}</h2>
        <p v-if="group.note" class="max-w-xl text-xs text-muted">
          {{ group.note }}
        </p>
      </div>
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <UCard v-for="entry in group.entries" :key="entry.routePath">
          <template #header>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <ULink :to="entry.routePath" class="font-semibold text-default hover:underline">
                    {{ entry.label }}
                  </ULink>
                  <ULink
                    v-if="entry.adminPath"
                    :to="entry.adminPath"
                    class="text-xs font-medium text-primary hover:underline"
                  >
                    Edit
                  </ULink>
                </div>
                <p class="text-xs text-muted">{{ entry.meta }}</p>
              </div>
              <UBadge v-if="entry.template" color="primary" variant="subtle">
                {{ entry.template }}
              </UBadge>
              <UBadge v-else color="neutral" variant="subtle">static</UBadge>
            </div>
          </template>
          <ULink
            v-if="entry.adminPath"
            :to="entry.adminPath"
            class="block aspect-1200/630 w-full overflow-hidden rounded-lg border border-default bg-elevated focus-visible:ring-2 focus-visible:ring-primary"
            :aria-label="`Admin: ${entry.label}`"
          >
            <img
              :src="previewUrl(entry.imageSrc)"
              :alt="entry.alt"
              loading="lazy"
              class="size-full object-cover transition-opacity hover:opacity-95"
            />
          </ULink>
          <img
            v-else
            :src="previewUrl(entry.imageSrc)"
            :alt="entry.alt"
            loading="lazy"
            class="aspect-1200/630 w-full rounded-lg border border-default bg-elevated object-cover"
          />
          <template #footer>
            <div class="flex items-center justify-between gap-2">
              <code class="truncate text-xs text-muted">{{ entry.imageSrc }}</code>
              <UButton
                v-if="clipboardSupported"
                size="xs"
                color="neutral"
                variant="ghost"
                :icon="copiedKey === entry.imageSrc ? 'i-lucide-check' : 'i-lucide-clipboard'"
                :aria-label="`Copy URL for ${entry.label}`"
                @click="copyUrl(entry)"
              />
            </div>
          </template>
        </UCard>
      </div>
    </section>
  </div>
</template>
