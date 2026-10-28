/**
 * The portal `foundation_exception` row, as adoption requirement R4 reads it.
 *
 * An app's recorded exemption from the web-foundation contract is a portal row
 * (operator-portal migration 0051; formerly company-hq APP_REGISTRY.yaml
 * `foundation_exception`). It COVERS a failing item rather than suppressing it:
 * the item's own status stays `fail` in every foundation artefact, and R4 alone
 * stops counting that failure once a row names the item and has not expired.
 *
 * The row is read from the portal, never from the checkout: a file the app
 * controls could exempt itself. Every doubt (no credential, a fetch error, a
 * malformed row, another app's row, an expired row) is no coverage, and R4
 * behaves exactly as it does without this module.
 */

import { portalOrigin } from '../app-config/resolve.js'

/** A read key that can list estate tables (the portal's `any-authenticated`
 * tables); read from the environment only. Without it nothing is covered. */
export const FOUNDATION_EXCEPTION_TOKEN_ENV = 'OPERATOR_PORTAL_FOUNDATION_EXCEPTION_TOKEN'

export interface FoundationExceptionRow {
  items: number[]
  /** Last covered day, `YYYY-MM-DD`. */
  expiresOn: string
  decision: string
  issue: string
  /** `org/name` repositories the row is scoped to; `[]` covers the whole app. */
  repos: string[]
}

/** Seam for the tests; real runs read the portal. */
export interface FoundationExceptionReality {
  /** The unretired row recorded for the app that owns `repo`, or null. */
  read(repo: string): Promise<FoundationExceptionRow | null>
}

export interface FoundationCoverage {
  /** Failing item ids the row covers. */
  covered: number[]
  /** Set when a row names a failing item but no longer covers it. */
  expired: FoundationExceptionRow | null
  row: FoundationExceptionRow | null
}

export const NO_FOUNDATION_EXCEPTION: FoundationExceptionReality = {
  read: async () => null,
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u

/** `generated` is the report's own clock; `expires_on` is the last covered day (UTC). */
export function isUnexpired(expiresOn: string, generated: string): boolean {
  if (!DAY.test(expiresOn)) return false
  const now = new Date(generated)
  if (Number.isNaN(now.getTime())) return false
  return now.toISOString().slice(0, 10) <= expiresOn
}

/**
 * Which of the failing items does the row cover? Explicit per item: only an
 * item number the row lists, and only while it is unexpired.
 */
export function coverFailingItems(
  row: FoundationExceptionRow | null,
  repo: string,
  failingItems: readonly number[],
  generated: string,
): FoundationCoverage {
  if (!row || failingItems.length === 0) return { covered: [], expired: null, row: null }
  const scoped =
    row.repos.length === 0 || row.repos.some((r) => r.toLowerCase() === repo.toLowerCase())
  const named = failingItems.filter((id) => row.items.includes(id))
  if (!scoped || named.length === 0) return { covered: [], expired: null, row: null }
  if (!isUnexpired(row.expiresOn, generated)) return { covered: [], expired: row, row: null }
  return { covered: named, expired: null, row }
}

interface Fetched {
  rows: Array<Record<string, unknown>>
}

type PortalFetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; redirect: 'manual' },
) => Promise<{ status: number; json(): Promise<unknown> }>

export interface PortalFoundationExceptionOptions {
  env?: NodeJS.ProcessEnv
  fetch?: PortalFetch
}

function parseRow(raw: Record<string, unknown>): FoundationExceptionRow | null {
  const { items, repos, expires_on: expiresOn, decision, issue } = raw
  const decode = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      return undefined
    }
  }
  const itemList = decode(items)
  const repoList = decode(repos)
  if (
    !Array.isArray(itemList) ||
    !itemList.every((n) => Number.isInteger(n) && n >= 1 && n <= 7) ||
    !Array.isArray(repoList) ||
    !repoList.every((r) => typeof r === 'string') ||
    typeof expiresOn !== 'string' ||
    typeof decision !== 'string' ||
    typeof issue !== 'string'
  ) {
    return null
  }
  return {
    decision,
    expiresOn,
    issue,
    items: itemList as number[],
    repos: repoList as string[],
  }
}

/**
 * Reads `foundation_exception`, `app_repo`, `repo` and `org` from the portal and
 * joins them to the row for `repo`. Fails closed to null.
 */
export function createPortalFoundationExceptionReality(
  options: PortalFoundationExceptionOptions = {},
): FoundationExceptionReality {
  const env = options.env ?? process.env
  const doFetch: PortalFetch = options.fetch ?? ((url, init) => fetch(url, init))
  return {
    async read(repo) {
      const token = (env[FOUNDATION_EXCEPTION_TOKEN_ENV] ?? '').trim()
      if (!token) return null
      try {
        const origin = portalOrigin(env)
        const table = async (name: string): Promise<Fetched['rows']> => {
          const response = await doFetch(`${origin}/api/estate/${name}`, {
            headers: { accept: 'application/json', authorization: `Bearer ${token}` },
            method: 'GET',
            redirect: 'manual',
          })
          if (response.status !== 200) throw new Error(`${name}: HTTP ${response.status}`)
          const body = (await response.json()) as { rows?: unknown }
          if (!Array.isArray(body.rows)) throw new Error(`${name}: no rows`)
          return body.rows as Array<Record<string, unknown>>
        }
        const [exceptions, appRepos, repos, orgs] = await Promise.all([
          table('foundation_exception'),
          table('app_repo'),
          table('repo'),
          table('org'),
        ])
        const orgName = new Map(orgs.map((o) => [String(o.id), String(o.name)]))
        const repoIds = repos
          .filter(
            (r) =>
              `${orgName.get(String(r.org_id)) ?? ''}/${String(r.name)}`.toLowerCase() ===
              repo.toLowerCase(),
          )
          .map((r) => String(r.id))
        const appIds = new Set(
          appRepos.filter((l) => repoIds.includes(String(l.repo_id))).map((l) => String(l.app_id)),
        )
        const mine = exceptions.filter((e) => appIds.has(String(e.app_id)))
        // One row per app; two linked apps with rows is ambiguous, not a guess.
        if (mine.length !== 1) return null
        return parseRow(mine[0] as Record<string, unknown>)
      } catch {
        return null
      }
    },
  }
}
