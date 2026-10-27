import { createCaptureProvenance } from '../../server/utils/captureProvenance'

import { isInternalAnalyticsTraffic, resolveAnalyticsEnvironment } from './analyticsLoadStrategy'

import type { AnalyticsDeploymentTarget } from './analyticsLoadStrategy'
import type { AnalyticsProperties } from './analyticsTransport'

interface ContextOptions {
  appId?: string
  appName: string
  appVersion?: string
  buildVersion?: string
  deploymentTarget?: AnalyticsDeploymentTarget
  /** `location.host` (with any port); preview detection reads it. */
  host?: string
  hostname: string
  owner: () => boolean
  route: () => string
  sdkVersion?: string
  surface?: string
}

export function createAnalyticsContext(options: ContextOptions): () => AnalyticsProperties {
  return () => ({
    app: options.appName,
    // Existing consumers need no new config; explicit registry IDs win.
    ...createCaptureProvenance({
      appId: options.appId,
      buildVersion: options.buildVersion,
      origin: 'browser',
      sdkVersion: options.sdkVersion,
      site: options.hostname,
    }),
    surface: options.surface || 'web',
    route: options.route(),
    environment: resolveAnalyticsEnvironment(
      options.hostname,
      options.deploymentTarget,
      options.host,
    ),
    is_internal_user: isInternalAnalyticsTraffic(
      options.hostname,
      options.deploymentTarget,
      options.host,
    ),
    is_owner: options.owner(),
    ...(options.appVersion ? { app_version: options.appVersion } : {}),
  })
}
