<script setup lang="ts">
// The page the module registers at /admin/analytics. An app that wants its own
// can mount <AdminAnalyticsPage /> itself and set `nardukAnalytics.adminPage: false`.
const config = useRuntimeConfig()
const url = useRequestURL()
const productId = String(config.public.analyticsAppId ?? '')
const siteName = url.hostname
</script>

<template>
  <AdminAnalyticsPage :product-id="productId" :site-name="siteName" />
</template>
