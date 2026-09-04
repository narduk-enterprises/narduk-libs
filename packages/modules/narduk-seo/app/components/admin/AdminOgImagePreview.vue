<script setup lang="ts">
const props = defineProps<{
  label: string
  ogUrl: string
  path: string
}>()

const siteUrl = useRequestURL().origin

const fullOgUrl = computed(() => {
  if (props.ogUrl.startsWith('http')) return props.ogUrl
  return `${siteUrl}${props.ogUrl}`
})

const hasError = ref(false)
const isLoading = ref(true)

function onError() {
  hasError.value = true
  isLoading.value = false
}

function onLoad() {
  isLoading.value = false
  hasError.value = false
}

function downloadImage() {
  if (!import.meta.client) return
  const link = document.createElement('a')
  link.href = fullOgUrl.value
  link.download = `og-${props.label.replaceAll(/[^a-z0-9]/gi, '_').toLowerCase()}.png`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
</script>

<template>
  <div class="space-y-3 rounded-lg border border-default p-4">
    <div class="flex items-center justify-between">
      <div>
        <h3 class="font-medium text-default">{{ label }}</h3>
        <p class="text-xs text-muted">{{ path }}</p>
      </div>
      <UButton
        v-if="!hasError && !isLoading"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-download"
        title="Download OG Image"
        @click="downloadImage"
      />
    </div>

    <div
      class="relative aspect-1200/630 overflow-hidden rounded-md border border-default bg-elevated/50"
    >
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center">
        <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- decorative loader -->
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>

      <img
        v-if="!hasError"
        :src="fullOgUrl"
        alt="OG Preview"
        class="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
        :class="{ 'opacity-0': isLoading, 'opacity-100': !isLoading }"
        crossorigin="anonymous"
        @error="onError"
        @load="onLoad"
      />

      <div
        v-if="hasError"
        class="absolute inset-0 flex max-w-[80%] flex-col items-center justify-center gap-2 p-4 text-center text-muted"
      >
        <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- decorative status icon -->
        <UIcon name="i-lucide-image-off" class="size-8 opacity-50" />
        <p class="text-sm">Image failed to generate or load</p>
        <p class="text-xs break-all opacity-75">{{ fullOgUrl }}</p>
      </div>
    </div>
  </div>
</template>
