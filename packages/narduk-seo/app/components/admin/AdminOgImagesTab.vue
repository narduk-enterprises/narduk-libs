<script setup lang="ts">
const { data: ogData, status: ogStatus, error: ogError } = useOgImageData()
const ogSections = computed(() => normalizeOgPreviewSections(ogData.value))

const toast = useToast()

if (ogError.value) {
  toast.add({
    title: 'Failed to load OG data',
    description: 'Ensure your app implements /api/admin/og-image-data',
    color: 'error',
    icon: 'i-lucide-alert-circle',
  })
}
</script>

<template>
  <div class="space-y-6">
    <UCard class="card-base border-default">
      <div
        class="sticky top-0 z-10 flex flex-col gap-3 border-b border-default bg-default/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-default/80"
      >
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-wider text-primary">OG Images</p>
          <h2 class="text-lg font-semibold text-default">Dynamic Social Cards Explorer</h2>
        </div>
        <p class="text-sm text-muted">
          Ensure social cards render correctly with v6 formatting (usually at
          <code>/__og-image__/image/og.png</code>).
        </p>
      </div>

      <div class="p-4">
        <div v-if="ogStatus === 'pending'" class="flex items-center justify-center py-12">
          <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- decorative loader -->
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
        </div>

        <div
          v-else-if="ogError"
          class="flex flex-col items-center justify-center space-y-4 py-12 text-center"
        >
          <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- decorative status icon -->
          <UIcon name="i-lucide-alert-triangle" class="size-8 text-warning" />
          <div class="space-y-1">
            <p class="font-medium">Cannot Load Exploratory Data</p>
            <p class="text-sm text-muted">
              Host application must provide the API endpoint: <code>/api/admin/og-image-data</code>.
            </p>
          </div>
        </div>

        <div v-else-if="ogSections.length === 0" class="py-12 text-center text-muted">
          No OG image preview categories found.
        </div>

        <div v-else class="space-y-8">
          <div v-for="(category, index) in ogSections" :key="index" class="space-y-4">
            <h3 class="border-b border-default pb-2 text-xl font-semibold text-default">
              {{ category.title ?? category.category ?? 'Untitled' }}
            </h3>
            <div v-if="category.items.length === 0" class="text-sm italic text-muted">
              No items discovered in this category.
            </div>
            <div v-else class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              <AdminOgImagePreview
                v-for="(item, idx) in category.items"
                :key="idx"
                :og-url="item.ogUrl"
                :label="item.label"
                :path="item.path"
              />
            </div>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
