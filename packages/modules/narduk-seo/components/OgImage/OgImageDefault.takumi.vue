<script setup lang="ts">
/* The runtime brand card. Every page title gets the same composition as the
   static site card (`narduk-app assets generate`): the brand's palette,
   layout, texture and mark from Config/brand.json, with the title as the
   largest thing on the card. Takumi has no CSS engine, so each node carries
   its own inline style; the background art is one SVG (ogBrandCard.ts). */
import { computed } from 'vue'

import {
  OG_BRAND_DEFAULT_INK,
  OG_BRAND_DEFAULT_PAPER,
  ogBrandArtDataUri,
  ogBrandLayout,
  ogBrandPattern,
  ogBrandPlan,
  ogMonogram,
  ogTitleSize,
} from '../../app/utils/ogBrandCard'
import {
  SEO_OG_IMAGE_DEFAULT_PRIMARY,
  SEO_OG_IMAGE_DEFAULT_SECONDARY,
} from '../../app/utils/ogImageDefinition'

import type { CSSProperties } from 'vue'

const props = withDefaults(
  defineProps<{
    badgeLabel?: string
    description?: string
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
    title: 'Nuxt 4 Template',
    description: '',
    siteName: 'Nuxt 4 Demo',
    eyebrow: '',
    badgeLabel: '',
    host: 'localhost:3000',
    image: '',
    inkColor: OG_BRAND_DEFAULT_INK,
    layout: 'poster',
    logo: '',
    monogram: '',
    paperColor: OG_BRAND_DEFAULT_PAPER,
    pattern: 'grid',
    primaryColor: SEO_OG_IMAGE_DEFAULT_PRIMARY,
    secondaryColor: SEO_OG_IMAGE_DEFAULT_SECONDARY,
  },
)

const DISPLAY = 'Outfit, Inter, sans-serif'
const TEXT = 'Inter, sans-serif'
const MONO = 'ui-monospace, Menlo, monospace'

const px = (value: number) => `${value}px`
const at = (slot: { height?: number; left: number; top: number; width?: number }) => ({
  position: 'absolute' as const,
  left: px(slot.left),
  top: px(slot.top),
  ...(slot.width ? { width: px(slot.width) } : {}),
  ...(slot.height ? { height: px(slot.height) } : {}),
})

const palette = computed(() => ({
  primary: props.primaryColor,
  accent: props.secondaryColor,
  ink: props.inkColor,
  paper: props.paperColor,
}))
const layout = computed(() => ogBrandLayout(props.layout, Boolean(props.image)))
const art = computed(() =>
  ogBrandArtDataUri(layout.value, ogBrandPattern(props.pattern), palette.value),
)
const plan = computed(() =>
  ogBrandPlan(layout.value, palette.value, { host: props.host, siteName: props.siteName }),
)
const mark = computed(() => ogMonogram(props.monogram, props.siteName))
const eyebrowText = computed(() => {
  const text = (props.eyebrow || props.host).toUpperCase()
  return props.badgeLabel ? `${text} · ${props.badgeLabel.toUpperCase()}` : text
})
const stamp = computed(() => layout.value === 'stamp')

const markBox = computed(() => {
  const { mark: slot } = plan.value
  return { ...at({ ...slot, width: slot.size, height: slot.size }) }
})
const monogramStyle = computed(() => {
  const { mark: slot } = plan.value
  return {
    ...markBox.value,
    borderRadius: px(Math.round(slot.size * 0.22)),
    backgroundColor: slot.field,
    color: slot.fg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: DISPLAY,
    fontWeight: 800,
    fontSize: px(Math.round(slot.size * (mark.value.length > 1 ? 0.4 : 0.56))),
    letterSpacing: '-0.04em',
  }
})
const brandStyle = computed(() => {
  const brand = plan.value.brand
  if (!brand) return {}
  return {
    ...at(brand),
    display: 'flex',
    alignItems: 'center',
    fontSize: '26px',
    fontWeight: 500,
    color: brand.color,
  }
})
const brandRightStyle = computed(() => ({
  position: 'absolute' as const,
  right: '88px',
  top: '76px',
  fontSize: '22px',
  fontWeight: 500,
  color: plan.value.brandRight?.color,
}))
const eyebrowStyle = computed(() => ({
  ...at(plan.value.eyebrow),
  fontFamily: MONO,
  fontSize: '19px',
  fontWeight: 700,
  letterSpacing: '0.14em',
  color: plan.value.eyebrow.color,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}))
const titleBoxStyle = computed(() => ({
  ...at(plan.value.title),
  ...(plan.value.title.height ? { justifyContent: 'center' } : {}),
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '20px',
}))
const titleStyle = computed(() => ({
  fontFamily: DISPLAY,
  fontWeight: 800,
  fontSize: px(ogTitleSize(props.title, layout.value)),
  lineHeight: '0.94',
  letterSpacing: '-0.035em',
  color: plan.value.title.color,
  lineClamp: 3,
  textOverflow: 'ellipsis',
}))
const descriptionStyle = computed(() => ({
  fontSize: '26px',
  lineHeight: '1.3',
  color: plan.value.title.color,
  opacity: 0.78,
  maxWidth: '760px',
  lineClamp: 2,
  textOverflow: 'ellipsis',
}))
const footStyle = computed(() => ({
  ...at(plan.value.foot),
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontFamily: stamp.value ? TEXT : MONO,
  fontSize: stamp.value ? '26px' : '21px',
  fontWeight: stamp.value ? 500 : 700,
  color: plan.value.foot.color,
}))
const footRightStyle = computed(() => ({
  fontFamily: MONO,
  fontSize: '20px',
  fontWeight: 700,
  color: plan.value.footRight?.color,
}))
const rootStyle = computed(() => ({
  width: '1200px',
  height: '630px',
  display: 'flex',
  position: 'relative' as const,
  overflow: 'hidden',
  backgroundColor: plan.value.background,
  fontFamily: TEXT,
}))
const FULL = {
  position: 'absolute',
  top: '0px',
  left: '0px',
  width: '1200px',
  height: '630px',
} satisfies CSSProperties
const PANEL = { ...FULL, left: '740px', width: '460px', objectFit: 'cover' } satisfies CSSProperties
</script>

<template>
  <div :style="rootStyle">
    <img :src="art" alt="" width="1200" height="630" :style="FULL" />

    <img v-if="image && layout === 'split'" :src="image" alt="" :style="PANEL" />
    <img v-else-if="logo" :src="logo" alt="" :style="markBox" />
    <div v-else :style="monogramStyle">{{ mark }}</div>

    <div v-if="plan.brand" :style="brandStyle">{{ siteName }}</div>
    <div v-if="plan.brandRight" :style="brandRightStyle">{{ plan.brandRight.text }}</div>

    <div :style="eyebrowStyle">{{ eyebrowText }}</div>

    <div :style="titleBoxStyle">
      <div :style="titleStyle">{{ title }}</div>
      <div v-if="description" :style="descriptionStyle">{{ description }}</div>
    </div>

    <div :style="footStyle">
      <span>{{ plan.footText }}</span>
      <span v-if="plan.footRight" :style="footRightStyle">{{ plan.footRight.text }}</span>
    </div>
  </div>
</template>
