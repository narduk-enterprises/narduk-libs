/**
 * Runs item 10 `security-headers` (narduk-core `security.headers`,
 * company-hq#745) as its own small artefact, the same way
 * `./evaluate-shared-ui-pinned.ts` runs item 8.
 *
 * It is NOT emitted inside `foundation-check.json`. That artefact is the exact
 * 7-item contract company-hq `check-web-foundation.py` `validate_artefact()`
 * consumes, and an `id` outside `1..7` is a rollup-red F3 ARTEFACT finding.
 * This runner reuses the same status vocabulary and roll-up rules (`check()`,
 * `rollUp()`) and writes a one-item artefact (`tool: '.../security-headers'`)
 * so nothing mistakes it for the ratified shape.
 *
 * Unlike every other item, this one has no filesystem verdict: response
 * headers are produced by a running server, and a repository can describe a
 * policy it does not serve. Without `--base-url` the item is `unknown` and the
 * command exits 2.
 */

import { createLiveProbe } from '../live-probe.js'

import { evaluateItem10, type ProbedRoute } from './items/item-10-security-headers.js'
import { rollUp } from './schema.js'
import { resolveAppInfo } from './evaluate.js'
import type { FoundationAppInfo, FoundationItemResult, FoundationResult } from './types.js'

export const SECURITY_HEADERS_ITEM_ID = 10
export const SECURITY_HEADERS_ITEM_NAME = 'security-headers'
export const SECURITY_HEADERS_TOOL_NAME = '@narduk-enterprises/narduk-app-tools/security-headers'
export const SECURITY_HEADERS_CONTRACT_SOURCE =
  'narduk-core `security.headers` preset (narduk-enterprises/company-hq#745)'

/** A one-item artefact, deliberately NOT shaped like `FoundationCheckArtefact`
 * (no `items` array, no claim of the ratified 7-item contract). */
export interface SecurityHeadersArtefact {
  schemaVersion: 1
  tool: typeof SECURITY_HEADERS_TOOL_NAME
  toolVersion: string
  generated: string
  app: FoundationAppInfo
  contract: { source: string; items: 1 }
  /** Every route the probe read, so a report can be re-read without re-probing. */
  probed: ProbedRoute[]
  item: FoundationItemResult
  result: FoundationResult
  exitCode: 0 | 1 | 2
}

/** Seam for the tests: real runs fetch, tests hand back a header set. */
export type HeaderProbe = (url: string) => Promise<ProbedRoute>

const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Item 10's probe, expressed over the shared `createLiveProbe` HTTP layer so
 * `verify --live` and this check cannot diverge on timeout, redirect or
 * user-agent behaviour. This one never reads the body -- a header verdict does
 * not need it -- and returns the narrower `ProbedRoute` shape the item consumes.
 */
export function createFetchProbe(timeoutMs = DEFAULT_TIMEOUT_MS): HeaderProbe {
  const probe = createLiveProbe({
    timeoutMs,
    readBody: false,
    userAgent: 'narduk-app-tools/foundation-check-security-headers',
  })
  return async (url: string): Promise<ProbedRoute> => {
    const response = await probe(url)
    if (response.error !== undefined) return { url, error: response.error }
    return { url, status: response.status, headers: response.headers }
  }
}

export function resolveProbeUrls(baseUrl: string, paths: readonly string[]): string[] {
  const base = new URL(baseUrl)
  return (paths.length > 0 ? paths : ['/']).map((path) => new URL(path, base).toString())
}

export interface RunSecurityHeadersCheckOptions {
  root: string
  toolVersion: string
  baseUrl?: string
  paths?: readonly string[]
  probe?: HeaderProbe
  appOverrides?: Partial<FoundationAppInfo>
  generated?: string
}

export async function runSecurityHeadersCheck(
  options: RunSecurityHeadersCheckOptions,
): Promise<SecurityHeadersArtefact> {
  const probe = options.probe ?? createFetchProbe()
  let probed: ProbedRoute[] = []

  if (options.baseUrl) {
    const urls = resolveProbeUrls(options.baseUrl, options.paths ?? [])
    // Sequential on purpose: a handful of routes against one origin is not a
    // throughput problem, and a burst looks like a probe to a WAF.
    for (const url of urls) {
      probed.push(await probe(url))
    }
  } else {
    probed = []
  }

  const checks = evaluateItem10(probed)
  const item: FoundationItemResult = {
    id: SECURITY_HEADERS_ITEM_ID,
    name: SECURITY_HEADERS_ITEM_NAME,
    status: rollUp(checks),
    checks,
  }
  const result: FoundationResult =
    item.status === 'fail' ? 'FAIL' : item.status === 'unknown' ? 'UNKNOWN' : 'PASS'
  const exitCode: 0 | 1 | 2 = result === 'FAIL' ? 1 : result === 'UNKNOWN' ? 2 : 0

  return {
    schemaVersion: 1,
    tool: SECURITY_HEADERS_TOOL_NAME,
    toolVersion: options.toolVersion,
    generated: options.generated ?? new Date().toISOString(),
    app: resolveAppInfo(options.root, options.appOverrides),
    contract: { source: SECURITY_HEADERS_CONTRACT_SOURCE, items: 1 },
    probed,
    item,
    result,
    exitCode,
  }
}

export function formatSecurityHeadersSummary(artefact: SecurityHeadersArtefact): string {
  const lines: string[] = []
  lines.push(`foundation:check:security-headers -- ${artefact.app.repo}`)
  lines.push(`  contract   ${artefact.contract.source}`)
  for (const route of artefact.probed) {
    lines.push(
      `  probed     ${route.url} ${route.error ? `(${route.error})` : `-> ${route.status}`}`,
    )
  }
  const mark =
    artefact.item.status === 'pass'
      ? 'PASS'
      : artefact.item.status === 'fail'
        ? 'FAIL'
        : artefact.item.status === 'unknown'
          ? 'UNKN'
          : 'N/A '
  lines.push(`  [${mark}] item ${artefact.item.id} ${artefact.item.name}`)
  for (const sub of artefact.item.checks) {
    if (sub.status === 'pass') continue
    const subMark = sub.status === 'fail' ? 'FAIL' : sub.status === 'unknown' ? 'UNKN' : 'N/A '
    lines.push(`         [${subMark}] ${sub.id} ${sub.name}: ${sub.detail}`)
  }
  lines.push('')
  lines.push(`RESULT: ${artefact.result}`)
  return lines.join('\n')
}
