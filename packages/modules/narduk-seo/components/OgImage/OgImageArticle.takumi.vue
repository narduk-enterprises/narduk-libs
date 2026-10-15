<script setup lang="ts">
/* An article is the brand card with the category as its label: one visual
   family for every shared URL, whatever the page type. */
import OgImageDefault from './OgImageDefault.takumi.vue'

const props = withDefaults(
  defineProps<{
    badgeLabel?: string
    category?: string
    description?: string
    displayFamily?: string
    eyebrow?: string
    host?: string
    image?: string
    inkColor?: string
    layout?: string
    logo?: string
    monogram?: string
    paperColor?: string
    pattern?: string
    primaryColor?: string
    secondaryColor?: string
    siteName?: string
    title?: string
  }>(),
  {
    title: 'Article Title',
    description: '',
    displayFamily: '',
    category: 'Article',
    eyebrow: '',
    badgeLabel: '',
    siteName: 'Nuxt 4 Demo',
    host: 'localhost:3000',
    image: '',
    inkColor: undefined,
    layout: 'ledger',
    logo: '',
    monogram: '',
    paperColor: undefined,
    pattern: undefined,
    primaryColor: undefined,
    secondaryColor: undefined,
  },
)
</script>

<template>
  <OgImageDefault
    v-bind="{
      ...props,
      eyebrow: [category, eyebrow].filter(Boolean).join(' · '),
    }"
  />
</template>
