<script setup lang="ts">
import type { NuxtError } from '#app'
import {
  clearError,
  computed,
  reloadNuxtApp,
  useHead,
  useRuntimeConfig,
  useSeoMeta,
} from '#imports'

import { NuxtLayout } from '#components'

import { useRequestId } from './composables/useRequestId'
import {
  type ErrorPageAction,
  type ErrorPageCopy,
  type ErrorPageLink,
  type ErrorPageUi,
  resolveErrorDetail,
  resolveErrorPresentation,
  resolveErrorStatusCode,
  runBeforeClear,
} from './error-page'

import type { FunctionalComponent } from 'vue'

// Every prop but `error` is a seam for wrapping the page instead of forking it
// (narduk-libs#976). None of them can surface `error.message` outside
// previewSafeMode, drop `noindex`, or hide the request id.
const props = withDefaults(
  defineProps<{
    copy?: ErrorPageCopy
    error: NuxtError
    homeLabel?: string
    homeTo?: string
    layout?: string | false
    links?: readonly ErrorPageLink[]
    onBeforeClear?: (error: NuxtError, action: ErrorPageAction) => unknown
    retryLabel?: string
    ui?: ErrorPageUi
  }>(),
  {
    copy: undefined,
    homeLabel: 'Go Home',
    homeTo: '/',
    layout: false,
    links: () => [],
    onBeforeClear: undefined,
    retryLabel: 'Try Again',
    ui: () => ({}),
  },
)

const runtimeConfig = useRuntimeConfig()
const requestId = useRequestId()

const statusCode = computed(() => resolveErrorStatusCode(props.error.statusCode))
const presentation = computed(() => resolveErrorPresentation(props.error.statusCode, props.copy))
const title = computed(() => presentation.value.title)
const description = computed(() => presentation.value.description)
// `layout` names a layout of the consuming app, which this package cannot
// know at type level (`NuxtLayouts` is generated per app), so it is passed
// through untyped. Without one the page is not wrapped in <NuxtLayout> at all,
// exactly as before: no Suspense boundary, no deferred hydration.
const layoutName = computed(() => props.layout as never)
const PassThrough: FunctionalComponent = (_props, { slots }) => slots.default?.()
const wrapper = computed(() => (props.layout ? NuxtLayout : PassThrough))
const wrapperProps = computed(() => (props.layout ? { name: layoutName.value } : {}))
const detail = computed(() =>
  resolveErrorDetail(props.error.message, runtimeConfig.public.previewSafeMode === true),
)

async function handleError() {
  await runBeforeClear(props.onBeforeClear, props.error, 'home')
  void clearError({ redirect: props.homeTo })
}

async function refreshPage() {
  await runBeforeClear(props.onBeforeClear, props.error, 'retry')
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
  <!-- Inside the app's layout only when `layout` names one. -->
  <component :is="wrapper" v-bind="wrapperProps">
    <div
      :class="['flex items-center justify-center px-4', ui.root ?? 'min-h-screen bg-default']"
      data-testid="error-page"
    >
      <div class="text-center max-w-md">
        <!-- Error code -->
        <p
          :class="['text-7xl font-bold font-display mb-2', ui.status ?? 'text-primary']"
          data-testid="error-page-status"
        >
          {{ statusCode }}
        </p>

        <!-- Title -->
        <h1
          :class="['text-2xl font-semibold mb-3', ui.title ?? 'text-primary']"
          data-testid="error-page-title"
        >
          {{ title }}
        </h1>

        <!-- Description -->
        <p class="text-muted mb-8" data-testid="error-page-description">
          {{ description }}
        </p>

        <!-- Actions -->
        <div class="flex flex-col sm:flex-row flex-wrap items-center justify-center gap-3">
          <UButton
            size="lg"
            icon="i-lucide-home"
            :class="ui.home"
            data-testid="error-page-home"
            @click="handleError"
          >
            {{ homeLabel }}
          </UButton>
          <UButton
            size="lg"
            variant="ghost"
            color="neutral"
            icon="i-lucide-refresh-cw"
            data-testid="error-page-retry"
            @click="refreshPage"
          >
            {{ retryLabel }}
          </UButton>
          <!-- App recovery links. An external `to` is a full navigation. -->
          <UButton
            v-for="link in links"
            :key="`${link.to}:${link.label}`"
            size="lg"
            variant="link"
            color="neutral"
            :icon="link.icon"
            :to="link.to"
            data-testid="error-page-link"
          >
            {{ link.label }}
          </UButton>
          <slot name="actions" :error="error" :status-code="statusCode" />
        </div>

        <!--
          The correlation id support asks for. It is the same value `x-request-id`
          carries and the same one every narduk-logging server record is keyed by.
        -->
        <p v-if="requestId" class="text-muted text-xs mt-8">
          Request ID
          <code data-testid="error-page-request-id" class="font-mono select-all">{{
            requestId
          }}</code>
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
  </component>
</template>
