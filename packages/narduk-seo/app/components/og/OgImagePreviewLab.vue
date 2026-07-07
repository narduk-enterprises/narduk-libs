<script setup lang="ts">
/* eslint-disable narduk/file-size-budget, vue/no-undef-components -- OG preview lab is a single interactive debugging surface (controls + preview + metadata) meant to be used as a developer tool; splitting fragments the workflow; AdminOgImagePreview is a Nuxt auto-import. */
import { useRuntimeConfig } from '#imports'

import {
  normalizeSeoOgImageHexColor,
  SEO_OG_IMAGE_DEFAULT_PRIMARY,
  SEO_OG_IMAGE_DEFAULT_SECONDARY,
  SEO_OG_IMAGE_PRESET_GREEN,
  SEO_OG_IMAGE_PRESET_SKY,
} from '../../utils/ogImageDefinition'

import type { OgPreviewItem } from '../../utils/ogPreview'

const siteConfig = useSiteConfig()
const runtimeConfig = useRuntimeConfig()

function normalizePreviewHexColor(value: string | undefined, fallback: string): string {
  return normalizeSeoOgImageHexColor(value, fallback)
}

const sampleImagePath = '/images/cedar-tree-pollen.png'
const defaultSiteName = String(siteConfig.name ?? runtimeConfig.public.appName ?? 'Nuxt 4 Demo')
type OgTemplateVariant = 'Default' | 'Article'
interface OgPreviewDefinition {
  badgeLabel?: string
  category?: string
  description: string
  eyebrow?: string
  image?: string
  key: string
  primaryColor?: string
  secondaryColor?: string
  title: string
  variant: OgTemplateVariant
}
interface OgPreviewResolveQuery {
  badgeLabel?: string
  category?: string
  description: string
  eyebrow?: string
  image?: string
  key: string
  primaryColor?: string
  secondaryColor?: string
  siteName: string
  title: string
  variant: OgTemplateVariant
}

const form = reactive<{
  badgeLabel: string
  category: string
  description: string
  eyebrow: string
  image: string
  primaryColor: string
  secondaryColor: string
  siteName: string
  title: string
  variant: OgTemplateVariant
}>({
  variant: 'Default',
  title: 'Dynamic OG cards that feel like product surfaces',
  description:
    'Preview the latest Nuxt OG Image renderer locally with better typography, richer layout, and optional media before shipping.',
  siteName: defaultSiteName,
  eyebrow: 'Open Graph Lab',
  category: 'Article',
  badgeLabel: 'Live Preview',
  image: sampleImagePath,
  primaryColor: SEO_OG_IMAGE_DEFAULT_PRIMARY,
  secondaryColor: SEO_OG_IMAGE_DEFAULT_SECONDARY,
})

const variantItems: OgTemplateVariant[] = ['Default', 'Article']
const previewOrigin = useRequestURL().origin
const previewPagePath = '/__preview/og-images'
const resolveOgImagePreviewUrl = useOgImagePreviewResolver()

const livePreviewItem = ref<OgPreviewItem | null>(null)
const presetItems = ref<OgPreviewItem[]>([])
const isLivePreviewLoading = ref(false)
const arePresetsLoading = ref(false)
const livePreviewError = ref<string | null>(null)
const presetItemsError = ref<string | null>(null)
let livePreviewTimer: ReturnType<typeof setTimeout> | null = null
let livePreviewRequestId = 0

function normalizeBlank(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function formatPreviewError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return `${fallback} ${error.message}`
  }

  return fallback
}

function buildPreviewQuery(options: OgPreviewDefinition, siteName: string): OgPreviewResolveQuery {
  return {
    key: options.key,
    variant: options.variant,
    title: options.title,
    description: options.description,
    siteName,
    ...(options.eyebrow ? { eyebrow: options.eyebrow } : {}),
    ...(options.variant === 'Article' && options.category ? { category: options.category } : {}),
    ...(options.badgeLabel ? { badgeLabel: options.badgeLabel } : {}),
    ...(options.image ? { image: options.image } : {}),
    ...(options.primaryColor ? { primaryColor: options.primaryColor } : {}),
    ...(options.secondaryColor ? { secondaryColor: options.secondaryColor } : {}),
  }
}

async function resolvePreviewItem(
  options: OgPreviewDefinition,
  siteName: string,
  label: string,
  path: string,
): Promise<OgPreviewItem> {
  return {
    label,
    path,
    ogUrl: await resolveOgImagePreviewUrl(buildPreviewQuery(options, siteName)),
  }
}

const presetDefinitions: OgPreviewDefinition[] = [
  {
    key: 'marketing-default',
    variant: 'Default',
    title: 'Launch pages deserve social cards with actual product gravity',
    description:
      'Use the default template when you want a strong headline, a clear brand signal, and optional media without bespoke design work.',
    eyebrow: 'Marketing Default',
    badgeLabel: 'With Media',
    image: sampleImagePath,
    primaryColor: SEO_OG_IMAGE_DEFAULT_PRIMARY,
    secondaryColor: SEO_OG_IMAGE_DEFAULT_SECONDARY,
  },
  {
    key: 'balanced-default',
    variant: 'Default',
    title: 'Solid default cards still work even when a page has no hero image',
    description:
      'The template keeps a bold composition when media is missing, so the OG layer remains useful across generic pages.',
    eyebrow: 'Text-Forward',
    badgeLabel: 'No Image Needed',
    primaryColor: SEO_OG_IMAGE_DEFAULT_SECONDARY,
    secondaryColor: SEO_OG_IMAGE_DEFAULT_PRIMARY,
  },
  {
    key: 'editorial-article',
    variant: 'Article',
    title:
      'Editorial cards can carry category, hierarchy, and media without falling back to screenshots',
    description:
      'Use the article variant for changelogs, docs, blog posts, and any page that wants a more magazine-like presentation.',
    eyebrow: 'Article Variant',
    category: 'Release Notes',
    badgeLabel: 'Story Mode',
    image: sampleImagePath,
    primaryColor: SEO_OG_IMAGE_PRESET_SKY,
    secondaryColor: SEO_OG_IMAGE_PRESET_GREEN,
  },
]

const livePreviewDefinition = computed<OgPreviewDefinition>(() => ({
  key: `lab-${form.variant.toLowerCase()}`,
  variant: form.variant,
  title: form.title,
  description: form.description,
  eyebrow: normalizeBlank(form.eyebrow),
  category: normalizeBlank(form.category),
  badgeLabel: normalizeBlank(form.badgeLabel),
  image: normalizeBlank(form.image),
  primaryColor: normalizePreviewHexColor(form.primaryColor, SEO_OG_IMAGE_DEFAULT_PRIMARY),
  secondaryColor: normalizePreviewHexColor(form.secondaryColor, SEO_OG_IMAGE_DEFAULT_SECONDARY),
}))

async function refreshLivePreview() {
  const requestId = ++livePreviewRequestId
  isLivePreviewLoading.value = true
  livePreviewError.value = null

  try {
    const item = await resolvePreviewItem(
      livePreviewDefinition.value,
      form.siteName,
      `${form.variant} preview`,
      previewPagePath,
    )

    if (requestId !== livePreviewRequestId) {
      return
    }

    livePreviewItem.value = item
  } catch (error) {
    if (requestId !== livePreviewRequestId) {
      return
    }

    livePreviewItem.value = null
    livePreviewError.value = formatPreviewError(error, 'Unable to resolve the live OG preview.')
  } finally {
    if (requestId === livePreviewRequestId) {
      isLivePreviewLoading.value = false
    }
  }
}

async function refreshPresetItems() {
  arePresetsLoading.value = true
  presetItemsError.value = null
  try {
    const results = await Promise.allSettled(
      presetDefinitions.map((item) =>
        resolvePreviewItem(item, defaultSiteName, item.title, `${item.variant} template`),
      ),
    )

    presetItems.value = results
      .filter(
        (result): result is PromiseFulfilledResult<OgPreviewItem> => result.status === 'fulfilled',
      )
      .map((result) => result.value)

    const failedCount = results.length - presetItems.value.length
    if (failedCount > 0) {
      presetItemsError.value =
        failedCount === results.length
          ? 'Unable to render preset previews.'
          : `${failedCount} preset preview${failedCount === 1 ? '' : 's'} failed to render.`
    }
  } finally {
    arePresetsLoading.value = false
  }
}

watch(
  () => [
    form.variant,
    form.title,
    form.description,
    form.siteName,
    form.eyebrow,
    form.category,
    form.badgeLabel,
    form.image,
    form.primaryColor,
    form.secondaryColor,
  ],
  () => {
    if (livePreviewTimer) {
      clearTimeout(livePreviewTimer)
    }

    livePreviewTimer = setTimeout(() => {
      void refreshLivePreview()
    }, 180)
  },
  {
    immediate: true,
  },
)

onMounted(() => {
  void refreshPresetItems()
})

onBeforeUnmount(() => {
  if (livePreviewTimer) {
    clearTimeout(livePreviewTimer)
  }
})

const rawPreviewUrl = computed(() =>
  livePreviewItem.value?.ogUrl ? `${previewOrigin}${livePreviewItem.value.ogUrl}` : '',
)
</script>

<template>
  <div class="space-y-8">
    <div class="grid gap-6 xl:grid-cols-[minmax(0,22rem),minmax(0,1fr)]">
      <UCard class="card-base border-default">
        <div class="space-y-5">
          <div class="space-y-1">
            <p class="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Controls</p>
            <h2 class="font-display text-2xl font-semibold text-highlighted">OG Image Lab</h2>
            <p class="text-sm text-muted">
              Tweak the shared layer defaults locally, then open the raw generated image before you
              ship.
            </p>
          </div>

          <div class="space-y-4">
            <UFormField label="Template">
              <!-- eslint-disable-next-line narduk/no-unknown-component-prop -- False positive on v-model mapping to modelValue -->
              <USelectMenu v-model="form.variant" :items="variantItems" class="w-full" />
            </UFormField>

            <UFormField label="Title">
              <UTextarea v-model="form.title" :rows="5" autoresize class="w-full" />
            </UFormField>

            <UFormField label="Description">
              <UTextarea v-model="form.description" :rows="5" autoresize class="w-full" />
            </UFormField>

            <UFormField label="Site name">
              <UInput v-model="form.siteName" class="w-full" />
            </UFormField>

            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <UFormField label="Eyebrow">
                <UInput v-model="form.eyebrow" class="w-full" />
              </UFormField>

              <UFormField label="Badge label">
                <UInput v-model="form.badgeLabel" class="w-full" />
              </UFormField>
            </div>

            <UFormField label="Article category">
              <UInput v-model="form.category" class="w-full" />
            </UFormField>

            <UFormField label="Media image path">
              <UInput v-model="form.image" class="w-full" />
            </UFormField>

            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <UFormField label="Primary color">
                <UInput v-model="form.primaryColor" class="w-full" />
              </UFormField>

              <UFormField label="Secondary color">
                <UInput v-model="form.secondaryColor" class="w-full" />
              </UFormField>
            </div>
          </div>
        </div>
      </UCard>

      <UCard class="card-base border-default">
        <div class="space-y-4">
          <div
            class="flex flex-col gap-3 border-b border-default pb-4 md:flex-row md:items-center md:justify-between"
          >
            <div class="space-y-1">
              <p class="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                Live Render
              </p>
              <h2 class="font-display text-2xl font-semibold text-highlighted">
                {{ form.variant }} Template
              </h2>
            </div>

            <div class="flex flex-wrap gap-2">
              <UButton
                :href="livePreviewItem?.ogUrl || undefined"
                target="_blank"
                :disabled="!livePreviewItem?.ogUrl || isLivePreviewLoading"
                color="neutral"
                variant="outline"
              >
                Open raw image
              </UButton>
              <UButton
                :href="rawPreviewUrl || undefined"
                target="_blank"
                :disabled="!rawPreviewUrl || isLivePreviewLoading"
                color="primary"
                variant="soft"
              >
                Open absolute URL
              </UButton>
            </div>
          </div>

          <div class="space-y-3">
            <p class="text-sm text-muted">
              Nuxt DevTools also shows the OG image payload when devtools are enabled, but this
              route gives you a stable shareable lab for quick visual checks.
            </p>
            <div
              v-if="livePreviewError"
              class="rounded-2xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error"
            >
              {{ livePreviewError }}
            </div>
            <div class="rounded-2xl border border-default bg-default/60 px-4 py-3">
              <code class="break-all text-xs text-primary">
                {{ rawPreviewUrl || 'Resolving preview URL...' }}
              </code>
            </div>
          </div>

          <AdminOgImagePreview
            v-if="livePreviewItem?.ogUrl"
            :og-url="livePreviewItem.ogUrl"
            :label="livePreviewItem.label"
            :path="livePreviewItem.path"
          />
          <div
            v-else
            class="flex min-h-[16rem] items-center justify-center rounded-2xl border border-dashed border-default bg-default/50 px-6 text-sm text-muted"
          >
            Rendering preview…
          </div>
        </div>
      </UCard>
    </div>

    <UCard class="card-base border-default">
      <div class="space-y-5">
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Presets</p>
          <h2 class="font-display text-2xl font-semibold text-highlighted">Reference Looks</h2>
          <p class="text-sm text-muted">
            These are canned examples built from the same layer utility that powers `useSeo()`.
          </p>
          <div
            v-if="presetItemsError"
            class="rounded-2xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error"
          >
            {{ presetItemsError }}
          </div>
        </div>

        <div class="grid gap-6 xl:grid-cols-3">
          <AdminOgImagePreview
            v-for="item in presetItems"
            :key="item.ogUrl"
            :og-url="item.ogUrl"
            :label="item.label"
            :path="item.path"
          />
        </div>

        <div
          v-if="arePresetsLoading && !presetItems.length"
          class="rounded-2xl border border-dashed border-default bg-default/50 px-6 py-10 text-center text-sm text-muted"
        >
          Rendering preset previews…
        </div>
      </div>
    </UCard>
  </div>
</template>
