/**
 * Worker script triggers (crons and routes) live on the script, not in a code
 * upload: `wrangler versions upload` carries code only, and
 * `wrangler triggers deploy` applies these (narduk-libs#756). `deploy.ts` uses
 * this to overlay what the built artifact declares onto the flattened config.
 */

type DeclaredWorkerRoute =
  | string
  | {
      pattern: string
      zone_name?: string
      zone_id?: string
      custom_domain?: boolean
    }

interface DeclaredScriptTriggers {
  /**
   * `undefined` means the config does not name crons. Wrangler then leaves
   * live schedules in place. An empty array removes every cron.
   */
  crons?: string[]
  /**
   * `undefined` means the config does not name routes. Wrangler then leaves
   * live routes in place.
   */
  routes?: DeclaredWorkerRoute[]
}

function parseDeclaredScriptTriggers(config: unknown): DeclaredScriptTriggers {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {}
  const record = config as Record<string, unknown>
  const result: DeclaredScriptTriggers = {}
  const triggers = record.triggers
  if (triggers && typeof triggers === 'object' && !Array.isArray(triggers)) {
    const crons = (triggers as { crons?: unknown }).crons
    if (Array.isArray(crons)) {
      result.crons = crons.map((cron, index) => {
        if (typeof cron !== 'string' || !cron.trim())
          throw new Error(`triggers.crons[${index}] must be a non-empty cron expression`)
        return cron
      })
    }
  }
  if (Array.isArray(record.routes)) {
    result.routes = record.routes.map((route, index) => parseRoute(route, `routes[${index}]`))
  } else if (typeof record.route === 'string' && record.route.trim()) {
    result.routes = [record.route]
  }
  return result
}

function parseRoute(route: unknown, label: string): DeclaredWorkerRoute {
  if (typeof route === 'string' && route.trim()) return route
  if (route && typeof route === 'object' && !Array.isArray(route)) {
    const pattern = (route as { pattern?: unknown }).pattern
    if (typeof pattern === 'string' && pattern.trim()) {
      const object = route as {
        pattern: string
        zone_name?: unknown
        zone_id?: unknown
        custom_domain?: unknown
      }
      const parsed: Exclude<DeclaredWorkerRoute, string> = { pattern }
      if (typeof object.zone_name === 'string') parsed.zone_name = object.zone_name
      if (typeof object.zone_id === 'string') parsed.zone_id = object.zone_id
      if (typeof object.custom_domain === 'boolean') parsed.custom_domain = object.custom_domain
      return parsed
    }
  }
  throw new Error(`${label} must be a pattern string or a { pattern } object`)
}

/** Overlay artifact-declared crons/routes onto the flattened deploy config. */
export function mergeArtifactScriptTriggers(
  deployConfig: Record<string, unknown>,
  artifactConfig: unknown,
): Record<string, unknown> {
  const declared = parseDeclaredScriptTriggers(artifactConfig)
  const result = { ...deployConfig }
  if (declared.crons !== undefined) {
    const existing =
      result.triggers && typeof result.triggers === 'object' && !Array.isArray(result.triggers)
        ? { ...(result.triggers as Record<string, unknown>) }
        : {}
    result.triggers = { ...existing, crons: declared.crons }
  }
  if (declared.routes !== undefined) {
    result.routes = declared.routes
    delete result.route
  }
  return result
}
