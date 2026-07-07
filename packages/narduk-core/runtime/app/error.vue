<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{
  error: NuxtError
}>()

const title = computed(() => {
  const code = props.error.statusCode
  if (code === 404) return 'Page not found'
  if (code === 403) return 'Access denied'
  if (code === 401) return 'Not authenticated'
  return 'Something went wrong'
})

const description = computed(() => {
  const code = props.error.statusCode
  if (code === 404) return "The page you're looking for doesn't exist or has been moved."
  if (code === 403) return "You don't have permission to access this resource."
  if (code === 401) return 'Please sign in to access this page.'
  return 'An unexpected error occurred. Please try again later.'
})

function handleError() {
  void clearError({ redirect: '/' })
}

function refreshPage() {
  // reloadNuxtApp() is the correct Nuxt mechanism here — it clears the error
  // boundary, Nuxt payload, and component state before reloading, whereas a raw
  // window.location.reload() can leave Nuxt hydration in an inconsistent state.
  reloadNuxtApp()
}

useSeoMeta({
  title: () => `${props.error.statusCode ?? 'Error'} — ${title.value}`,
  description: () => description.value,
})

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-default px-4">
    <div class="text-center max-w-md">
      <!-- Error code -->
      <p class="text-7xl font-bold font-display text-primary mb-2">
        {{ error.statusCode ?? 500 }}
      </p>

      <!-- Title -->
      <h1 class="text-2xl font-semibold text-primary mb-3">
        {{ title }}
      </h1>

      <!-- Description -->
      <p class="text-muted mb-8">
        {{ description }}
      </p>

      <!-- Actions -->
      <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
        <UButton size="lg" icon="i-lucide-home" @click="handleError"> Go Home </UButton>
        <UButton
          size="lg"
          variant="ghost"
          color="neutral"
          icon="i-lucide-refresh-cw"
          @click="refreshPage"
        >
          Try Again
        </UButton>
      </div>
    </div>
  </div>
</template>
