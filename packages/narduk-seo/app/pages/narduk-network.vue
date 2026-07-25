<script setup lang="ts">
import { useRuntimeConfig } from '#imports'

import { resolveSiteOriginForSchemaInput } from '../utils/resolveSiteOriginForSchema'

const runtimeConfig = useRuntimeConfig()
const siteConfig = useSiteConfig()
const appName = runtimeConfig.public.appName
const pageTitle = 'Narduk Enterprises Network'
const pageDescription = `Explore public Narduk Enterprises sites connected to ${appName}.`
const siteOrigin = resolveSiteOriginForSchemaInput({
  siteConfigUrl: typeof siteConfig.url === 'string' ? siteConfig.url : undefined,
  publicAppUrl: runtimeConfig.public.appUrl,
})
const pageUrl = siteOrigin ? `${siteOrigin}/narduk-network` : undefined

const { data, pending } = await useNardukNetworkDirectory()

const networkSites = computed(() => data.value.sites)
const resolvedCatalogUrl = computed(() => data.value.catalogUrl || '')
const hasNetworkSites = computed(() => networkSites.value.length > 0)

useSeo({
  title: pageTitle,
  description: pageDescription,
  ...(pageUrl && { canonicalUrl: pageUrl }),
  ogImage: {
    title: pageTitle,
    description: pageDescription,
    icon: 'i-lucide-network',
  },
})

useWebPageSchema({
  type: 'CollectionPage',
  name: pageTitle,
  description: pageDescription,
})

useItemListSchema(
  () =>
    networkSites.value.map((site, index) => ({
      name: site.name,
      url: site.url,
      position: index + 1,
    })),
  {
    name: pageTitle,
    description: pageDescription,
  },
)
</script>

<template>
  <UPage>
    <UPageHeader
      :title="pageTitle"
      :description="pageDescription"
      :ui="{ title: 'text-3xl sm:text-4xl', description: 'text-base text-muted' }"
    />

    <UPageBody>
      <UAlert
        v-if="!pending && !hasNetworkSites"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        title="Network directory is being updated"
        description="The public site list is managed through the Narduk catalog."
      >
        <template #actions>
          <UButton
            v-if="resolvedCatalogUrl"
            :to="resolvedCatalogUrl"
            external
            color="neutral"
            variant="outline"
            trailing-icon="i-lucide-external-link"
            label="Open catalog"
            rel="noopener"
          />
        </template>
      </UAlert>

      <UPageGrid v-else>
        <UPageCard
          v-for="site in networkSites"
          :key="site.slug"
          :title="site.name"
          :description="site.description"
          :to="site.url"
          external
          target="_blank"
          rel="noopener"
          icon="i-lucide-globe"
        >
          <template #footer>
            <span class="text-sm text-muted break-all">{{ site.url }}</span>
          </template>
        </UPageCard>
      </UPageGrid>

      <p v-if="data?.updatedAt" class="mt-8 text-sm text-dimmed">
        Last updated
        <NuxtTime :datetime="data.updatedAt" year="numeric" month="short" day="2-digit" />.
      </p>
    </UPageBody>
  </UPage>
</template>
