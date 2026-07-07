<script setup lang="ts">
/**
 * AppShareButtons — Social share bar with Twitter/X, Facebook, and copy-link.
 *
 * Auto-resolves the full URL from the current route if not explicitly provided.
 * Uses runtimeConfig.public.siteUrl or appUrl for production URLs.
 *
 * Usage:
 *   <AppShareButtons title="Check out this article" />
 *   <AppShareButtons title="My post" :url="post.url" :share-text="post.excerpt" />
 */

const props = withDefaults(
  defineProps<{
    /** Custom share text for Twitter/X. Falls back to title. */
    shareText?: string
    /** Show the "Share:" label. */
    showLabel?: boolean
    /** Button size. */
    size?: 'xs' | 'sm' | 'md'
    /** Title of the content being shared. */
    title: string
    /** Full URL to share. Auto-resolved from route if not provided. */
    url?: string
  }>(),
  {
    url: '',
    shareText: '',
    showLabel: true,
    size: 'xs',
  },
)

const runtimeConfig = useRuntimeConfig()
const route = useRoute()

const siteUrl = computed(() => {
  const configuredSiteUrl =
    typeof runtimeConfig.public.siteUrl === 'string' ? runtimeConfig.public.siteUrl.trim() : ''
  const configuredAppUrl =
    typeof runtimeConfig.public.appUrl === 'string' ? runtimeConfig.public.appUrl.trim() : ''
  return (configuredSiteUrl ? configuredSiteUrl : configuredAppUrl).replace(/\/$/, '')
})
const fullUrl = computed(() => props.url || `${siteUrl.value}${route.path}`)
const text = computed(() => props.shareText || props.title)

const twitterUrl = computed(
  () =>
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text.value)}&url=${encodeURIComponent(fullUrl.value)}`,
)
const facebookUrl = computed(
  () => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(fullUrl.value)}`,
)

const copied = ref(false)

async function copyLink() {
  try {
    await navigator.clipboard.writeText(fullUrl.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Silently fail in environments without clipboard API
  }
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <span v-if="showLabel" class="text-xs text-muted mr-0.5">Share:</span>
    <UButton
      :to="twitterUrl"
      target="_blank"
      rel="noopener noreferrer"
      icon="i-lucide-twitter"
      variant="ghost"
      color="neutral"
      :size="size"
      aria-label="Share on X / Twitter"
    />
    <UButton
      :to="facebookUrl"
      target="_blank"
      rel="noopener noreferrer"
      icon="i-lucide-facebook"
      variant="ghost"
      color="neutral"
      :size="size"
      aria-label="Share on Facebook"
    />
    <UButton
      :icon="copied ? 'i-lucide-check' : 'i-lucide-link'"
      variant="ghost"
      :color="copied ? 'success' : 'neutral'"
      :size="size"
      :aria-label="copied ? 'Copied!' : 'Copy link'"
      @click="copyLink"
    />
    <slot />
  </div>
</template>
