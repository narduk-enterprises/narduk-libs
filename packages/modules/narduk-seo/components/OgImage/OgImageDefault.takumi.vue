<script setup lang="ts">
import {
  SEO_OG_IMAGE_DEFAULT_PRIMARY,
  SEO_OG_IMAGE_DEFAULT_SECONDARY,
  SEO_OG_IMAGE_SURFACE_INK,
  SEO_OG_IMAGE_TEXT_DIM,
  SEO_OG_IMAGE_TEXT_MUTED,
  SEO_OG_IMAGE_TEXT_PRIMARY,
} from '../../app/utils/ogImageDefinition'

withDefaults(
  defineProps<{
    badgeLabel?: string
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
    title: 'Nuxt 4 Template',
    description: 'Production-ready Nuxt 4 + Cloudflare Workers with polished social cards.',
    siteName: 'Nuxt 4 Demo',
    eyebrow: 'Open Graph Preview',
    badgeLabel: '',
    host: 'localhost:3000',
    image: '',
    primaryColor: SEO_OG_IMAGE_DEFAULT_PRIMARY,
    secondaryColor: SEO_OG_IMAGE_DEFAULT_SECONDARY,
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
      padding: '56px',
      background: 'linear-gradient(145deg, #06101f 0%, #0f172a 50%, #071320 100%)',
      fontFamily: 'Inter, sans-serif',
      position: 'relative',
      overflow: 'hidden',
      color: SEO_OG_IMAGE_TEXT_PRIMARY,
    }"
  >
    <div
      :style="{
        position: 'absolute',
        top: '-160px',
        right: '-120px',
        width: '540px',
        height: '540px',
        borderRadius: '50%',
        background: `radial-gradient(circle, ${primaryColor}40 0%, transparent 70%)`,
      }"
    />

    <div
      :style="{
        position: 'absolute',
        bottom: '-120px',
        left: '-80px',
        width: '420px',
        height: '420px',
        borderRadius: '50%',
        background: `radial-gradient(circle, ${secondaryColor}33 0%, transparent 72%)`,
      }"
    />

    <div
      :style="{
        position: 'absolute',
        inset: '22px',
        borderRadius: '36px',
        border: '1px solid rgba(148, 163, 184, 0.16)',
      }"
    />

    <div :style="{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }">
      <div
        :style="{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 18px',
          borderRadius: '999px',
          border: '1px solid rgba(148, 163, 184, 0.18)',
          background: 'rgba(15, 23, 42, 0.72)',
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
        v-if="badgeLabel"
        :style="{
          padding: '10px 14px',
          borderRadius: '999px',
          background: 'rgba(15, 23, 42, 0.58)',
          border: '1px solid rgba(148, 163, 184, 0.12)',
          fontSize: '14px',
          fontWeight: '600',
          color: SEO_OG_IMAGE_TEXT_MUTED,
        }"
      >
        {{ badgeLabel }}
      </div>
    </div>

    <div
      :style="{
        display: 'flex',
        alignItems: 'stretch',
        gap: '28px',
        flex: '1',
        marginTop: '28px',
        marginBottom: '24px',
      }"
    >
      <div
        :style="{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          width: image ? '61%' : '100%',
        }"
      >
        <div :style="{ display: 'flex', flexDirection: 'column', gap: '18px' }">
          <div
            :style="{
              fontFamily: 'Outfit, Inter, sans-serif',
              fontSize: '68px',
              fontWeight: '700',
              lineHeight: '1.02',
              letterSpacing: '-0.04em',
              maxWidth: image ? '650px' : '940px',
            }"
          >
            {{ title }}
          </div>

          <div
            :style="{
              fontSize: '26px',
              color: SEO_OG_IMAGE_TEXT_MUTED,
              lineHeight: '1.42',
              maxWidth: image ? '620px' : '860px',
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
            gap: '20px',
          }"
        >
          <div :style="{ display: 'flex', alignItems: 'center', gap: '16px' }">
            <div
              :style="{
                width: '54px',
                height: '54px',
                borderRadius: '18px',
                background: `linear-gradient(145deg, ${primaryColor}, ${secondaryColor})`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Outfit, Inter, sans-serif',
                fontSize: '19px',
                fontWeight: '700',
                color: SEO_OG_IMAGE_SURFACE_INK,
              }"
            >
              {{ siteName.slice(0, 2).toUpperCase() }}
            </div>

            <div :style="{ display: 'flex', flexDirection: 'column', gap: '4px' }">
              <div
                :style="{
                  fontFamily: 'Outfit, Inter, sans-serif',
                  fontSize: '24px',
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
          </div>
        </div>
      </div>

      <div
        v-if="image"
        :style="{
          width: '39%',
          display: 'flex',
        }"
      >
        <div
          :style="{
            width: '100%',
            borderRadius: '34px',
            overflow: 'hidden',
            border: '1px solid rgba(148, 163, 184, 0.16)',
            background: 'rgba(15, 23, 42, 0.52)',
            boxShadow: '0 24px 80px rgba(2, 6, 23, 0.35)',
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
</template>
