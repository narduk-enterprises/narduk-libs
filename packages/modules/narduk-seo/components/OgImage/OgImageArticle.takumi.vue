<script setup lang="ts">
/* eslint-disable max-lines -- Satori/Takumi renders this card without a CSS
   engine, so every one of its 22 nodes carries a full inline `:style` object;
   the length is the renderer's constraint, not structure that can be factored
   out. v1's narduk/file-size-budget never reported here (its `/app/pages/`
   gate could not match a relative filename); the core `max-lines` replacement
   that supersedes it does, at 273 counted lines against a 250 component budget. */
import {
  SEO_OG_IMAGE_BADGE_INK,
  SEO_OG_IMAGE_PRESET_GREEN,
  SEO_OG_IMAGE_PRESET_SKY,
  SEO_OG_IMAGE_SURFACE_DEEP,
  SEO_OG_IMAGE_TEXT_DIM,
  SEO_OG_IMAGE_TEXT_MUTED,
  SEO_OG_IMAGE_TEXT_SOFT,
} from '../../app/utils/ogImageDefinition'

withDefaults(
  defineProps<{
    badgeLabel?: string
    category?: string
    description?: string
    eyebrow?: string
    host?: string
    image?: string
    primaryColor?: string
    secondaryColor?: string
    siteName?: string
    title?: string
  }>(),
  {
    title: 'Article Title',
    description: 'A richer editorial social card rendered with the latest Nuxt OG Image stack.',
    category: 'Article',
    eyebrow: 'Editorial Preview',
    badgeLabel: 'Feature Story',
    siteName: 'Nuxt 4 Demo',
    host: 'localhost:3000',
    image: '',
    primaryColor: SEO_OG_IMAGE_PRESET_SKY,
    secondaryColor: SEO_OG_IMAGE_PRESET_GREEN,
  },
)
</script>

<template>
  <div
    :style="{
      width: '1200px',
      height: '630px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      background: 'linear-gradient(145deg, #020617 0%, #0f172a 56%, #071a26 100%)',
      padding: '52px',
      fontFamily: 'Inter, sans-serif',
      color: SEO_OG_IMAGE_TEXT_SOFT,
      position: 'relative',
      overflow: 'hidden',
    }"
  >
    <div
      :style="{
        position: 'absolute',
        top: '-120px',
        right: '-60px',
        width: '420px',
        height: '420px',
        borderRadius: '50%',
        background: `radial-gradient(circle, ${primaryColor}32 0%, transparent 70%)`,
      }"
    />

    <div
      :style="{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '20px',
      }"
    >
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 18px',
          borderRadius: '999px',
          border: '1px solid rgba(148, 163, 184, 0.16)',
          background: 'rgba(15, 23, 42, 0.62)',
          fontSize: '16px',
          fontWeight: '700',
        }"
      >
        <div
          :style="{
            width: '12px',
            height: '12px',
            borderRadius: '999px',
            background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
          }"
        />
        {{ eyebrow }}
      </div>
      <div
        :style="{
          padding: '10px 14px',
          borderRadius: '999px',
          background: 'rgba(15, 23, 42, 0.52)',
          border: '1px solid rgba(148, 163, 184, 0.12)',
          fontSize: '14px',
          fontWeight: '600',
        }"
      >
        {{ badgeLabel }}
      </div>
    </div>

    <div
      :style="{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'stretch',
        gap: '28px',
        flex: '1',
        marginTop: '26px',
        marginBottom: '22px',
      }"
    >
      <div
        :style="{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: image ? '58%' : '100%',
        }"
      >
        <div
          :style="{
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            maxWidth: image ? '610px' : '920px',
          }"
        >
          <div
            :style="{
              display: 'inline-flex',
              alignItems: 'center',
              alignSelf: 'flex-start',
              borderRadius: '999px',
              background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
              color: SEO_OG_IMAGE_BADGE_INK,
              fontSize: '16px',
              fontWeight: '700',
              padding: '10px 16px',
            }"
          >
            {{ category }}
          </div>

          <div
            :style="{
              fontFamily: 'Outfit, Inter, sans-serif',
              fontSize: '66px',
              lineHeight: '1.03',
              letterSpacing: '-0.04em',
              fontWeight: '700',
            }"
          >
            {{ title }}
          </div>

          <div
            :style="{
              fontSize: '25px',
              color: SEO_OG_IMAGE_TEXT_MUTED,
              lineHeight: '1.44',
            }"
          >
            {{ description }}
          </div>
        </div>

        <div
          :style="{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '18px',
          }"
        >
          <div :style="{ display: 'flex', flexDirection: 'column', gap: '6px' }">
            <div
              :style="{
                fontFamily: 'Outfit, Inter, sans-serif',
                fontSize: '22px',
                fontWeight: '600',
              }"
            >
              {{ siteName }}
            </div>
            <div
              :style="{
                fontSize: '16px',
                color: SEO_OG_IMAGE_TEXT_DIM,
              }"
            >
              {{ host }}
            </div>
          </div>

          <div
            :style="{
              width: '64px',
              height: '64px',
              borderRadius: '22px',
              background: `linear-gradient(145deg, ${primaryColor}, ${secondaryColor})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'Outfit, Inter, sans-serif',
              color: SEO_OG_IMAGE_SURFACE_DEEP,
              fontSize: '22px',
              fontWeight: '700',
            }"
          >
            {{ siteName.slice(0, 2).toUpperCase() }}
          </div>
        </div>
      </div>

      <div
        v-if="image"
        :style="{
          width: '42%',
          display: 'flex',
        }"
      >
        <div
          :style="{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '18px',
            borderRadius: '34px',
            border: '1px solid rgba(148, 163, 184, 0.16)',
            background: 'rgba(15, 23, 42, 0.56)',
            boxShadow: '0 24px 80px rgba(2, 6, 23, 0.35)',
          }"
        >
          <div
            :style="{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: SEO_OG_IMAGE_TEXT_MUTED,
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
            }"
          >
            <span>Media</span>
            <span>{{ category }}</span>
          </div>
          <div
            :style="{
              flex: '1',
              overflow: 'hidden',
              borderRadius: '24px',
            }"
          >
            <img
              :src="image"
              alt=""
              :style="{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
