<script setup lang="ts">
import { computed } from 'vue'

import { useAdminAnalytics } from '../../composables/useAdminAnalytics'
import { useAdminAnalyticsChartData } from '../../composables/useAdminAnalyticsChartData'
import { useAdminAnalyticsModel } from '../../composables/useAdminAnalyticsModel'
import { ADMIN_NEAREST_DAILY } from '../../utils/analyticsAdminRange'

const props = withDefaults(
  defineProps<{
    /** The ops portal base, for the "Open in ops portal" link. */
    opsPortalUrl?: string
    /** The product's registry id (`analyticsAppId`); without it there is no portal link. */
    productId?: string
    /** The site's name in the header. */
    siteName?: string
  }>(),
  {
    opsPortalUrl: 'https://ops.nardukenterprises.com',
    productId: '',
    siteName: '',
  },
)

const a = useAdminAnalytics()
const range = a.range
const model = useAdminAnalyticsModel(a)
const chart = useAdminAnalyticsChartData(a, model)

useHead({ meta: [{ name: 'robots', content: 'noindex' }], title: 'Analytics' })

const eyebrow = computed(() => `Admin${props.siteName ? ` · ${props.siteName}` : ''}`)
const portalHref = computed(() =>
  props.productId
    ? `${props.opsPortalUrl.replace(/\/+$/u, '')}/products/${encodeURIComponent(props.productId)}`
    : '',
)

function showDaily() {
  a.choosePreset(ADMIN_NEAREST_DAILY)
}
function setTraffic(value: 'external' | 'internal') {
  range.traffic = value
  if (value === 'internal' && range.includeClasses.length === 0) {
    range.includeClasses = ['owner', 'automation']
  }
}
function toggleClass(name: string) {
  range.includeClasses = range.includeClasses.includes(name)
    ? range.includeClasses.filter((item) => item !== name)
    : [...range.includeClasses, name]
}
</script>

<template>
  <main class="ne-an" data-testid="admin-analytics">
    <header class="ne-an-head">
      <div>
        <p class="ne-an-eyebrow">{{ eyebrow }}</p>
        <h1 class="ne-an-title">
          Analytics
          <span class="ne-an-badge" :data-state="model.measured.value.state">{{
            model.measured.value.text
          }}</span>
        </h1>
      </div>
      <a
        v-if="portalHref"
        class="ne-an-link"
        :href="portalHref"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open in ops portal <span aria-hidden="true">↗</span>
        <span class="ne-an-sr">(opens in a new tab)</span>
      </a>
    </header>

    <section v-if="model.denied.value" class="ne-an-panel ne-an-panel-pad" role="alert">
      <h2>Sign in as an admin to see analytics.</h2>
      <p class="ne-an-note">These reads are for this app's admins only.</p>
    </section>

    <template v-else>
      <section class="ne-an-panel ne-an-panel-pad ne-an-health" aria-label="Tracking health">
        <span class="ne-an-label">Tracking health</span>
        <span class="ne-an-badge" :data-state="model.health.value.state">{{
          model.health.value.title
        }}</span>
        <span v-if="model.health.value.line" class="ne-an-range-line">{{
          model.health.value.line
        }}</span>
      </section>

      <AdminAnalyticsTabs v-model="a.tab.value" />

      <AdminAnalyticsControls
        :chips="model.chips.value"
        :custom-draft="a.customDraft"
        :custom-error="a.customError.value"
        :custom-open="a.customOpen.value"
        :custom-ready="a.customReady.value"
        :range="range"
        :range-line="model.rangeLine.value"
        :refreshing="model.refreshing.value"
        :zone="a.zone.value"
        @apply="a.applyCustom()"
        @cancel="a.cancelCustom()"
        @choose="a.choosePreset($event)"
        @refresh="a.refreshAll()"
        @update:start="a.customDraft.start = $event"
        @update:end="a.customDraft.end = $event"
        @update:tz="range.tz = $event"
        @update:traffic="setTraffic"
      />

      <section v-if="model.staleBanner.value" class="ne-an-banner" role="status">
        <b>{{ model.staleBanner.value.head }}</b>
        {{ model.staleBanner.value.body }}
        <UButton color="neutral" variant="outline" label="Refresh" @click="a.refreshAll()" />
      </section>
      <section v-if="model.errorBanner.value" class="ne-an-banner ne-an-banner--bad" role="alert">
        <b>PostHog could not be read</b>
        {{ model.errorBanner.value }}
        <UButton color="neutral" variant="outline" label="Try again" @click="a.refreshAll()" />
      </section>

      <div
        v-show="a.tab.value === 'overview'"
        id="ne-an-panel-overview"
        role="tabpanel"
        aria-labelledby="ne-an-tab-overview"
      >
        <AdminAnalyticsKpis
          :tiles="model.tiles.value"
          :loading="model.loadingOverview.value"
          @show-daily="showDaily"
        />
        <div class="ne-an-grid ne-an-grid--chart ne-an-gap-top">
          <AdminAnalyticsChart
            class="ne-an-flush"
            :bucket="model.current.value?.bucket ?? '1d'"
            :empty="chart.empty.value"
            :loading="a.overview.pending.value"
            :metrics="chart.metrics.value"
            :now-ms="a.clock.value"
            :slots="chart.slots.value"
            :tz="a.zone.value"
          />
          <AdminAnalyticsTraffic
            class="ne-an-flush"
            :classes="model.current.value?.classes ?? []"
            :include-classes="range.includeClasses"
            :loading="a.overview.pending.value"
            :mode="range.traffic"
            :unavailable="model.classesUnavailable.value"
            @toggle="toggleClass"
          />
        </div>
        <AdminAnalyticsOrigins
          :data="a.origins.data.value"
          :dimension="a.originDimension.value"
          :failure="a.origins.message.value"
          :loading="a.origins.pending.value"
          @update:dimension="a.originDimension.value = $event"
        />
      </div>

      <div
        v-show="a.tab.value === 'behavior'"
        id="ne-an-panel-behavior"
        role="tabpanel"
        aria-labelledby="ne-an-tab-behavior"
      >
        <AdminAnalyticsBehavior
          :devices="a.devices.data.value"
          :entry-exit="a.entryExit.data.value"
          :failure="model.behaviorFailure.value"
          :loading="a.pages.pending.value || a.devices.pending.value || a.entryExit.pending.value"
          :pages="a.pages.data.value"
          :range="model.current.value?.window.label ?? range.preset"
        />
      </div>

      <div
        v-show="a.tab.value === 'search'"
        id="ne-an-panel-search"
        role="tabpanel"
        aria-labelledby="ne-an-tab-search"
      >
        <AdminAnalyticsSearch
          :daily-only="model.dailyOnly.value"
          :data="model.searchRows.value.data"
          :dimension="a.searchDimension.value"
          :failure="a.searchRows.message.value"
          :failure-kind="model.searchRows.value.failure"
          :loading="a.searchRows.pending.value"
          @show-daily="showDaily"
          @update:dimension="a.searchDimension.value = $event"
        />
      </div>
    </template>
  </main>
</template>
