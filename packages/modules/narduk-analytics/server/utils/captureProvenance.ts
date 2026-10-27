/** Bumped when the shape of the kit's event properties changes. */
export const ANALYTICS_SCHEMA_VERSION = 1

export type AnalyticsCaptureOrigin = 'browser' | 'server' | 'synthetic'

export interface CaptureProvenanceInput {
  appId?: string
  buildVersion?: string
  origin: AnalyticsCaptureOrigin
  /** This package's own version, seeded by `src/module.ts`; omitted when unknown. */
  sdkVersion?: string
  site: string
}

/**
 * The fields that say where an event came from and which kit version sent it.
 * One builder for the browser context and the server helper, so both name the
 * same keys. A missing `build_version` or SDK version is omitted, never a
 * placeholder, so "unknown" stays distinct from a real value.
 */
export function createCaptureProvenance(input: CaptureProvenanceInput): Record<string, unknown> {
  return {
    site: input.site,
    app_id: resolveAnalyticsAppId(input.appId, input.site).appId,
    analytics_schema_version: ANALYTICS_SCHEMA_VERSION,
    capture_origin: input.origin,
    ...(input.sdkVersion ? { analytics_sdk_version: input.sdkVersion } : {}),
    ...(input.buildVersion ? { build_version: input.buildVersion } : {}),
  }
}

/** Explicit registry IDs win; a hostname-derived id is a fallback worth a dev warning. */
export function resolveAnalyticsAppId(
  appId: string | undefined,
  hostname: string,
): { appId: string; source: 'hostname' | 'registry' } {
  const registry = appId?.trim()
  return registry
    ? { appId: registry, source: 'registry' }
    : { appId: hostname.toLowerCase(), source: 'hostname' }
}
