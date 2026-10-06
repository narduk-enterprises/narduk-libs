import { isInternalAnalyticsTraffic, resolveAnalyticsEnvironment } from './analyticsLoadStrategy'
import { ANALYTICS_SCHEMA_VERSION } from './analyticsVersion'

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
  surface?: string
}

export function createAnalyticsContext(options: ContextOptions): () => AnalyticsProperties {
  return () => ({
    app: options.appName,
    // Existing consumers need no new config; explicit registry IDs win.
    app_id: options.appId || options.hostname.toLowerCase(),
    surface: options.surface || 'web',
    route: options.route(),
    analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
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
    ...(options.buildVersion ? { build_version: options.buildVersion } : {}),
  })
}
