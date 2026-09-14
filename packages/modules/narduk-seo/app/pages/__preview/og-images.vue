<script setup lang="ts">
import { useRuntimeConfig } from '#imports'

const runtimeConfig = useRuntimeConfig()
const isPreviewEnabled = import.meta.dev || runtimeConfig.public.ogImagePreviewLab

if (!isPreviewEnabled) {
  throw createError({
    statusCode: 404,
    statusMessage: 'Not Found',
  })
}

useSeo({
  title: 'OG Image Preview Lab',
  description: 'Preview and tune shared dynamic Open Graph cards locally before shipping.',
  robots: 'noindex, nofollow',
  ogImage: false,
})

useWebPageSchema({
  name: 'OG Image Preview Lab',
  description: 'Preview and tune shared dynamic Open Graph cards locally before shipping.',
})
</script>

<template>
  <UContainer class="py-12 sm:py-16">
    <div class="mx-auto max-w-4xl space-y-3 text-center">
      <p class="text-xs font-semibold uppercase tracking-[0.26em] text-primary">SEO Layer</p>
      <h1 class="font-display text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl">
        OG Image Preview Lab
      </h1>
      <p class="mx-auto max-w-3xl text-base leading-7 text-muted sm:text-lg">
        This route is for local verification and preview environments. Use it to iterate on the
        shared OG templates, inspect raw generated images, and make sure the card feels right before
        a release.
      </p>
    </div>

    <div class="mt-10">
      <ClientOnly>
        <OgImagePreviewLab />
      </ClientOnly>
    </div>
  </UContainer>
</template>
