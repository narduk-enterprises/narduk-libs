/**
 * Worker script triggers — crons and routes — as distinct from Workers Builds
 * triggers. `wrangler versions upload` / `POST {script}/deployments` carry code
 * only; these settings live on the script and are applied by
 * `wrangler triggers deploy` (narduk-libs#756).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser'

function readJsonc(path: string): unknown {
  const errors: ParseError[] = []
  const value = parse(readFileSync(path, 'utf8'), errors, {
    allowEmptyContent: false,
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(', ')
    throw new Error(`Could not parse Wrangler config ${path}: ${details}`)
  }
  return value
}

function sourceWranglerPath(appDir: string): string | null {
  for (const filename of ['wrangler.jsonc', 'wrangler.json']) {
    const path = join(appDir, filename)
    if (existsSync(path)) return path
  }
  return null
}

export type DeclaredWorkerRoute =
  | string
  | {
      pattern: string
      zone_name?: string
      zone_id?: string
      custom_domain?: boolean
    }

export interface DeclaredScriptTriggers {
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

export interface ResolvedScriptTriggers {
  /** Path that supplied the declared crons/routes (artifact only if it named one). */
  source: string
  triggers: DeclaredScriptTriggers
}

export function artifactWranglerPath(appDir: string): string {
  return join(appDir, '.output', 'server', 'wrangler.json')
}

export function parseDeclaredScriptTriggers(config: unknown): DeclaredScriptTriggers {
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

export function routePattern(route: DeclaredWorkerRoute): string {
  return typeof route === 'string' ? route : route.pattern
}

/**
 * Artifact first: the build that is being promoted is what the Worker should
 * end up with. Nitro's generated wrangler.json often omits `triggers` /
 * `routes`, so a missing key falls back to the source config versions-upload
 * already flattened.
 */
export function readDeclaredScriptTriggers(appDir: string): ResolvedScriptTriggers {
  const artifact = artifactWranglerPath(appDir)
  const sourcePath = sourceWranglerPath(appDir)
  if (existsSync(artifact)) {
    const fromArtifact = parseDeclaredScriptTriggers(readJsonc(artifact))
    const fromSource = sourcePath ? parseDeclaredScriptTriggers(readJsonc(sourcePath)) : {}
    return {
      source:
        fromArtifact.crons !== undefined || fromArtifact.routes !== undefined
          ? artifact
          : (sourcePath ?? artifact),
      triggers: {
        crons: fromArtifact.crons ?? fromSource.crons,
        routes: fromArtifact.routes ?? fromSource.routes,
      },
    }
  }
  if (!sourcePath) throw new Error(`No Wrangler config in ${appDir}; cannot apply script triggers`)
  return { source: sourcePath, triggers: parseDeclaredScriptTriggers(readJsonc(sourcePath)) }
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

/** A checkout's own Wrangler config: what its next development deploy declares. */
export function readSourceScriptTriggers(wranglerConfigPath: string): DeclaredScriptTriggers {
  return parseDeclaredScriptTriggers(readJsonc(wranglerConfigPath))
}

/** Live script triggers; routes are zone route patterns plus custom domain hostnames. */
export interface LiveScriptTriggers {
  crons: string[]
  routes: string[]
}

export interface ScriptTriggerMismatch {
  kind: 'crons' | 'routes'
  declaredOnly: string[]
  liveOnly: string[]
}

function difference(left: string[], right: string[]): string[] {
  const other = new Set(right)
  return [...new Set(left)].filter((item) => !other.has(item)).sort()
}

/**
 * Where declared and live disagree. A key the config does not name is not
 * managed (`wrangler triggers deploy` leaves it in place), so it cannot mismatch.
 */
export function scriptTriggerMismatch(
  declared: DeclaredScriptTriggers,
  live: LiveScriptTriggers,
): ScriptTriggerMismatch[] {
  const mismatches: ScriptTriggerMismatch[] = []
  const compare = (kind: ScriptTriggerMismatch['kind'], wanted: string[] | undefined) => {
    if (wanted === undefined) return
    const declaredOnly = difference(wanted, live[kind])
    const liveOnly = difference(live[kind], wanted)
    if (declaredOnly.length || liveOnly.length) mismatches.push({ kind, declaredOnly, liveOnly })
  }
  compare('crons', declared.crons)
  compare('routes', declared.routes?.map(routePattern))
  return mismatches
}

export function describeScriptTriggerMismatch(mismatches: ScriptTriggerMismatch): string {
  return `${mismatches.kind} declared-only ${JSON.stringify(mismatches.declaredOnly)} live-only ${JSON.stringify(mismatches.liveOnly)}`
}
