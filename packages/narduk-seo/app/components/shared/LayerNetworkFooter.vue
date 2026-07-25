<script setup lang="ts">
// LayerNetworkFooter — cross-links a fleet app back to the Narduk catalog hub.

import { readRuntimeConfigString } from '@narduk-enterprises/narduk-core/app/utils/readRuntimeConfigString'

import { useRuntimeConfig } from '#imports'

interface NetworkFooterProps {
  catalogLabel?: string
  catalogUrl?: string
  /** Display name for the org line (e.g. “Acme” in “Part of the Acme network”). Defaults to `runtimeConfig.public.appName`, then `catalogLabel`. */
  organizationName?: string
  showAppList?: boolean
}

const props = withDefaults(defineProps<NetworkFooterProps>(), {
  catalogUrl: '',
  catalogLabel: 'Narduk Enterprises',
  organizationName: '',
  showAppList: false,
})

const runtimeConfig = useRuntimeConfig()

// No hardcoded hub hostname: the catalog link is configuration, not a constant.
const resolvedCatalogUrl = computed(() => {
  if (props.catalogUrl) return props.catalogUrl
  return readRuntimeConfigString(runtimeConfig.public.publicCatalogBaseUrl, '')
})

/**
 * The `/narduk-network` entry point is only meaningful when a directory
 * endpoint is configured; otherwise the page can only render empty, so the
 * footer omits the link entirely.
 */
const hasNetworkDirectory = computed(() =>
  Boolean(readRuntimeConfigString(runtimeConfig.public.nardukNetworkDirectoryUrl, '')),
)

const resolvedOrganizationName = computed(() => {
  if (props.organizationName) return props.organizationName
  return readRuntimeConfigString(runtimeConfig.public.appName, props.catalogLabel)
})

/** Catalog hub index for published apps (see fleet schema tests using `/apps/...`). */
const catalogAppsIndexUrl = computed(() => {
  if (!resolvedCatalogUrl.value) return ''
  const base = resolvedCatalogUrl.value.replace(/\/$/, '')
  return `${base}/apps`
})
</script>

<template>
  <section
    class="border-t border-default py-4"
    aria-label="Narduk network"
    data-testid="layer-network-footer"
  >
    <div
      class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-sm text-muted"
    >
      <div class="flex items-center gap-2">
        <!-- eslint-disable-next-line vuejs-accessibility/alt-text -- decorative icon next to visible text -->
        <UIcon name="i-lucide-network" class="h-4 w-4 text-muted" aria-hidden="true" />
        <span>
          <span class="sr-only">{{ resolvedOrganizationName }} —</span>
          Part of the
          <ULink
            v-if="resolvedCatalogUrl"
            :to="resolvedCatalogUrl"
            external
            rel="noopener"
            class="font-medium text-default hover:text-primary underline-offset-2 hover:underline"
          >
            {{ catalogLabel }}
          </ULink>
          <span v-else class="font-medium text-default">{{ catalogLabel }}</span>
          network
        </span>
      </div>
      <div class="flex flex-wrap items-center gap-4">
        <ULink
          v-if="hasNetworkDirectory"
          to="/narduk-network"
          class="font-medium text-default hover:text-primary underline-offset-2 hover:underline"
        >
          Narduk network
        </ULink>
        <ULink
          v-if="showAppList && catalogAppsIndexUrl"
          :to="catalogAppsIndexUrl"
          external
          rel="noopener"
          class="font-medium text-default hover:text-primary underline-offset-2 hover:underline"
        >
          Browse apps
        </ULink>
        <slot name="links" />
      </div>
    </div>
  </section>
</template>
