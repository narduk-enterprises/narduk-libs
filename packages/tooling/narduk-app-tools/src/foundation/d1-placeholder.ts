/**
 * Sub-check 1.5 -- every D1 binding names a real database (narduk-libs#662).
 *
 * `create-narduk-app` emits `"database_id": "00000000-0000-0000-0000-000000000000"`
 * for its `DB` binding: the generator must not call Cloudflare, so the real id
 * cannot exist yet. The placeholder is a valid UUID, so `nuxt build`,
 * `wrangler deploy --dry-run`, the unit and browser suites and -- before this
 * sub-check -- `foundation:check` all accepted it. The first evidence that the
 * database did not exist was a failed request against a deployed Worker.
 *
 * So a scaffold with a database now FAILS here until it is provisioned. That is
 * the honest verdict, not a regression of narduk-libs#617: #617 removed
 * failures nothing inside a new app could fix and that described no real
 * defect. This one describes a real defect -- the app cannot serve a request
 * that touches its database -- and one command inside the app fixes it
 * (`narduk-app db create`). A scaffold with `--no-database` has no D1 binding
 * and is not-applicable.
 *
 * Kept in its own module, and self-contained, so item 1's evaluator gains one
 * line: it reads only the wrangler config item 1 already located.
 */

import { isPlaceholderD1DatabaseId, PLACEHOLDER_D1_DATABASE_ID } from '../d1-create.js'
import { check } from './schema.js'
import { isRecord, parseJson, wranglerScopes, type AppRepo } from './source.js'
import {
  STATUS_FAIL,
  STATUS_NA,
  STATUS_PASS,
  STATUS_UNKNOWN,
  type FoundationSubCheck,
} from './types.js'

export const D1_PROVISIONED_CHECK_ID = '1.5'
export const D1_PROVISIONED_CHECK_NAME = 'D1 bindings name a real database'

interface D1Entry {
  /** Where the entry sits, e.g. `d1_databases[0]` or `env.staging.d1_databases[1]`. */
  at: string
  binding: string
  databaseName: string | null
  databaseId: unknown
  topLevel: boolean
}

function jsonEntries(config: unknown): D1Entry[] {
  const out: D1Entry[] = []
  for (const [prefix, scope] of wranglerScopes(config)) {
    const block = scope.d1_databases
    if (!Array.isArray(block)) continue
    for (const [index, entry] of block.entries()) {
      if (!isRecord(entry)) continue
      out.push({
        at: `${prefix}d1_databases[${index}]`,
        binding: typeof entry.binding === 'string' ? entry.binding : `#${index}`,
        databaseName: typeof entry.database_name === 'string' ? entry.database_name : null,
        databaseId: entry.database_id,
        topLevel: prefix === '',
      })
    }
  }
  return out
}

/** A wrangler.toml's `database_id` lines. Values only matter for the
 * placeholder comparison, so a line scan is complete: every D1 entry carries
 * its id on a `database_id = "..."` line whichever table it sits under. */
function tomlEntries(text: string): D1Entry[] {
  return [...text.matchAll(/^\s*database_id\s*=\s*"([^"]*)"/gm)].map((match, index) => ({
    at: `database_id #${index + 1}`,
    binding: `database_id #${index + 1}`,
    databaseName: null,
    databaseId: match[1],
    topLevel: false,
  }))
}

function remediation(wranglerRel: string, placeholders: D1Entry[]): string {
  const topLevel = placeholders.filter((entry) => entry.topLevel)
  const commands = topLevel.map(
    (entry) =>
      `\`narduk-app db create${topLevel.length > 1 ? ` --binding ${entry.binding}` : ''}\``,
  )
  const byHand = placeholders
    .map(
      (entry) =>
        `\`wrangler d1 create ${entry.databaseName ?? '<database_name>'}\` and set ${entry.at}.database_id in ${wranglerRel} to the id it prints`,
    )
    .join('; ')
  return commands.length > 0
    ? `Run ${commands.join(', then ')} from the repository root, with CLOUDFLARE_API_TOKEN and ` +
        'CLOUDFLARE_ACCOUNT_ID for the account the app deploys to: it creates the database named ' +
        'in Config/cloudflare-app.json and writes its id into the config, comments intact. ' +
        `By hand: ${byHand}.`
    : `Create each database and record its id: ${byHand}.`
}

export function evaluateD1Provisioned(
  repo: AppRepo,
  wranglerRel: string | null,
): FoundationSubCheck {
  if (!wranglerRel) {
    return check(
      D1_PROVISIONED_CHECK_ID,
      D1_PROVISIONED_CHECK_NAME,
      STATUS_NA,
      'no wrangler config found at a known path, so there is no D1 binding to check',
    )
  }
  const text = repo.read(wranglerRel) ?? ''
  let entries: D1Entry[]
  if (wranglerRel.endsWith('.toml')) {
    entries = tomlEntries(text)
  } else {
    const config = parseJson(text)
    if (config === null) {
      return check(
        D1_PROVISIONED_CHECK_ID,
        D1_PROVISIONED_CHECK_NAME,
        STATUS_UNKNOWN,
        `${wranglerRel} could not be parsed, so its D1 bindings could not be read`,
        wranglerRel,
      )
    }
    entries = jsonEntries(config)
  }
  if (entries.length === 0) {
    return check(
      D1_PROVISIONED_CHECK_ID,
      D1_PROVISIONED_CHECK_NAME,
      STATUS_NA,
      `${wranglerRel} declares no D1 binding`,
      wranglerRel,
    )
  }
  const placeholders = entries.filter((entry) => isPlaceholderD1DatabaseId(entry.databaseId))
  if (placeholders.length > 0) {
    return check(
      D1_PROVISIONED_CHECK_ID,
      D1_PROVISIONED_CHECK_NAME,
      STATUS_FAIL,
      `${placeholders.length} D1 binding(s) in ${wranglerRel} still carry the scaffold ` +
        `placeholder database_id ${PLACEHOLDER_D1_DATABASE_ID}: ` +
        `${placeholders.map((entry) => `${entry.at} (${entry.binding})`).join(', ')}. ` +
        'The Worker builds and deploys with it, and every request that touches the database ' +
        `fails. ${remediation(wranglerRel, placeholders)}`,
      wranglerRel,
    )
  }
  return check(
    D1_PROVISIONED_CHECK_ID,
    D1_PROVISIONED_CHECK_NAME,
    STATUS_PASS,
    `all ${entries.length} D1 binding(s) in ${wranglerRel} name a database other than the ` +
      'scaffold placeholder (this reads the file only; it cannot prove the database exists)',
    wranglerRel,
  )
}
