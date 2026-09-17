<script setup lang="ts">
import {
  clearError,
  computed,
  reloadNuxtApp,
  useHead,
  useRuntimeConfig,
  useSeoMeta,
} from '#imports'

import { useRequestId } from './composables/useRequestId'
import { resolveErrorDetail, resolveErrorPresentation, resolveErrorStatusCode } from './error-page'

import type { NuxtError } from '#app'

const props = defineProps<{
  error: NuxtError
}>()

const runtimeConfig = useRuntimeConfig()
const requestId = useRequestId()

const statusCode = computed(() => resolveErrorStatusCode(props.error.statusCode))
const presentation = computed(() => resolveErrorPresentation(props.error.statusCode))
const title = computed(() => presentation.value.title)
const description = computed(() => presentation.value.description)
const detail = computed(() =>
  resolveErrorDetail(props.error.message, runtimeConfig.public.previewSafeMode === true),
)

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
  title: () => `${statusCode.value} — ${title.value}`,
  description: () => description.value,
})

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-default px-4" data-testid="error-page">
    <div class="text-center max-w-md">
      <!-- Error code -->
      <p class="text-7xl font-bold font-display text-primary mb-2" data-testid="error-page-status">
        {{ statusCode }}
      </p>

      <!-- Title -->
      <h1 class="text-2xl font-semibold text-primary mb-3" data-testid="error-page-title">
        {{ title }}
      </h1>

      <!-- Description -->
      <p class="text-muted mb-8" data-testid="error-page-description">
        {{ description }}
      </p>

      <!-- Actions -->
      <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
        <UButton size="lg" icon="i-lucide-home" data-testid="error-page-home" @click="handleError">
          Go Home
        </UButton>
        <UButton
          size="lg"
          variant="ghost"
          color="neutral"
          icon="i-lucide-refresh-cw"
          data-testid="error-page-retry"
          @click="refreshPage"
        >
          Try Again
        </UButton>
      </div>

      <!--
        The correlation id support asks for. It is the same value `x-request-id`
        carries and the same one every narduk-logging server record is keyed by.
      -->
      <p v-if="requestId" class="text-muted text-xs mt-8">
        Request ID
        <code data-testid="error-page-request-id" class="font-mono select-all">{{ requestId }}</code>
      </p>

      <!-- Preview and staging only; never shown to production traffic. -->
      <p
        v-if="detail"
        data-testid="error-page-detail"
        class="text-muted text-xs mt-3 font-mono break-words"
      >
        {{ detail }}
      </p>
    </div>
  </div>
</template>
