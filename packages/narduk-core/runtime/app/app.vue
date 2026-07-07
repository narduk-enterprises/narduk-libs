<script setup lang="ts">
import {
  hidesRootShellFooter,
  hidesRootShellHeader,
  isFullBleedLayout,
  resolveLayoutName,
} from './utils/layoutBehavior'
import { readRuntimeConfigString } from './utils/readRuntimeConfigString'

/**
 * Layer Default Application Shell
 * This uses the layer's highly configurable components.
 */
const route = useRoute()
const appName = readRuntimeConfigString(useRuntimeConfig().public.appName, 'Nuxt 4 Demo')
const activeLayout = computed(() => resolveLayoutName(route.meta.layout))

const navItems = [{ label: 'Home', to: '/', icon: 'i-lucide-home' }]

/** Layouts and meta that must not get the default max-width app gutter. */
const isFullBleedRoute = computed(
  () => route.meta.fullBleed === true || isFullBleedLayout(activeLayout.value),
)

const showShellHeader = computed(
  () => route.meta.shellHeader !== false && !hidesRootShellHeader(activeLayout.value),
)
const showShellFooter = computed(
  () => route.meta.shellFooter !== false && !hidesRootShellFooter(activeLayout.value),
)

const shellContentClass = computed(() =>
  isFullBleedRoute.value ? 'flex-1' : 'flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full',
)

/**
 * Public SEO is optional and now lives in `layers/seo`.
 * Core-only apps can set page titles and noindex metadata with `useSeoMeta()`
 * and `useHead()` without pulling in Schema.org or public-search defaults.
 */
</script>

<template>
  <LayerAppShell>
    <!-- Configurable Header -->
    <template v-if="showShellHeader" #header>
      <LayerAppHeader :app-name="appName" :nav-links="navItems" />
    </template>

    <!-- Main Content Container with standard max-w-7xl padding unless overridden by layout -->
    <div :class="shellContentClass">
      <NuxtLayout>
        <NuxtPage />
      </NuxtLayout>
    </div>

    <!-- Configurable Footer -->
    <template v-if="showShellFooter" #footer>
      <LayerAppFooter :app-name="appName" />
    </template>
  </LayerAppShell>
</template>
