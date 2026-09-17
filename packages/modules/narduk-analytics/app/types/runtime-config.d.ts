interface AnalyticsRuntimeConfig {
  googleServiceAccountKey: string
  gaPropertyId: string
  gscSiteUrl: string
  ownerTagSecret: string
  posthogApiHost: string
  posthogApiKey: string
  posthogDomain: string
  posthogOwnerDistinctId: string
  posthogProjectId: string
  indexNowKey: string
}

interface AnalyticsPublicRuntimeConfig {
  analyticsLoadStrategy: 'immediate' | 'idle' | 'interaction' | 'off'
  gaMeasurementId: string
  indexNowKey: string
  posthogDeadClicksEnabled: boolean
  posthogExternalDependencyLoadingEnabled: boolean
  posthogFeatureFlagsEnabled: boolean
  posthogHost: string
  posthogPublicKey: string
  posthogSessionReplayEnabled: boolean
  posthogSurveysEnabled: boolean
  posthogWebVitalsAttributionEnabled: boolean
  posthogWebVitalsEnabled: boolean
}

declare module 'nuxt/schema' {
  interface RuntimeConfig extends AnalyticsRuntimeConfig {}

  interface PublicRuntimeConfig extends AnalyticsPublicRuntimeConfig {}
}

declare module '@nuxt/schema' {
  interface RuntimeConfig extends AnalyticsRuntimeConfig {}

  interface PublicRuntimeConfig extends AnalyticsPublicRuntimeConfig {}
}

export {}
