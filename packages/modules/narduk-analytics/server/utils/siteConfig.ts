import {
  hostnameFromUrl,
  readRuntimeBoolean,
  readRuntimeString,
} from '@narduk-enterprises/narduk-core/server/utils/runtime-env'

import type { AnalyticsServerRuntimeConfig } from './runtimeConfig'
import type { H3Event } from 'h3'

function trimValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function resolveAnalyticsAppUrl(config: AnalyticsServerRuntimeConfig, event?: H3Event) {
  if (event) {
    return readRuntimeString(event, 'SITE_URL', { config, fallback: config.public.appUrl })
  }

  return trimValue(config.public.appUrl)
}

export function resolveDeploymentTarget(config: AnalyticsServerRuntimeConfig, event?: H3Event) {
  const configured = event
    ? readRuntimeString(event, 'NARDUK_DEPLOY_TARGET', {
        config,
        fallback: config.public.deploymentTarget,
      })
    : trimValue(config.public.deploymentTarget)
  return configured === 'staging' || configured === 'preview' ? configured : 'production'
}

export function isPreviewSafeMode(config: AnalyticsServerRuntimeConfig, event?: H3Event) {
  const previewSafeMode = event
    ? readRuntimeBoolean(event, 'NARDUK_PREVIEW_SAFE_MODE', {
        config,
        fallback: config.public.previewSafeMode,
      })
    : config.public.previewSafeMode === true

  return previewSafeMode || resolveDeploymentTarget(config, event) === 'preview'
}

export function assertAnalyticsWriteAllowed(config: AnalyticsServerRuntimeConfig, event?: H3Event) {
  if (!isPreviewSafeMode(config, event)) return

  throw createError({
    statusCode: 403,
    statusMessage: 'Preview-safe mode disables analytics and indexing write operations.',
  })
}

export function resolveGscSiteUrl(config: AnalyticsServerRuntimeConfig, event?: H3Event) {
  const configured = event
    ? readRuntimeString(event, 'GSC_SITE_URL', { config, fallback: config.gscSiteUrl })
    : trimValue(config.gscSiteUrl)
  if (configured) {
    return configured
  }

  const appUrl = resolveAnalyticsAppUrl(config, event)
  if (!appUrl) {
    return ''
  }

  const hostname = hostnameFromUrl(appUrl)
  return hostname ? `sc-domain:${hostname}` : appUrl
}

export function resolvePosthogApiHost(config: AnalyticsServerRuntimeConfig, event?: H3Event) {
  return (
    (event
      ? readRuntimeString(event, 'POSTHOG_API_HOST', { config, fallback: config.posthogApiHost })
      : trimValue(config.posthogApiHost)) || 'https://p.nard.uk'
  )
}

export function resolvePosthogDomain(config: AnalyticsServerRuntimeConfig, event?: H3Event) {
  const configured = event
    ? readRuntimeString(event, 'POSTHOG_DOMAIN', { config, fallback: config.posthogDomain })
    : trimValue(config.posthogDomain)
  if (configured) {
    return configured
  }

  const appUrl = resolveAnalyticsAppUrl(config, event)
  if (!appUrl) {
    return ''
  }

  return hostnameFromUrl(appUrl)
}
