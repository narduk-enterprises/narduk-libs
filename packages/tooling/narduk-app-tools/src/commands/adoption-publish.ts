/**
 * `narduk-app adoption publish` -- posts one `doctor --adoption --json`
 * artefact to the Operator Portal's estate ingest, so a product's own promote
 * run is what feeds the portal's `/products/adoption` page (narduk-libs#1422;
 * operator-portal#1633).
 *
 *   narduk-app adoption publish --report <adoption.json> [--origin <url>] [--dry-run]
 *
 * WHY HERE AND NOT A SCRIPT IN EACH APP. The artefact's schema is defined
 * beside the checker (`evaluate-adoption.ts`); a copy of the publisher per
 * repository falls behind it. The portal's ingest stays the other half of the
 * contract: it validates the schema-1 artefact and keeps the newest report per
 * repository.
 *
 * THE CREDENTIAL. The single-purpose producer key arrives in
 * `OPERATOR_PORTAL_ADOPTION_INGEST_TOKEN` and nowhere else: never an argument
 * (argv is visible to every process on the runner and to the step log), never
 * a file. It is scrubbed from anything this command prints.
 *
 * Exit codes, so a workflow step can classify without parsing text:
 *   0  the portal stored the report (or a dry run built the body).
 *   1  the report could not be read, or is not a schema-1 adoption artefact,
 *      or the command was mistyped.
 *   2  the key is not provisioned: nothing was sent. A missing credential is
 *      its own state and is never reported as a success.
 *   3  the portal refused the report or could not be reached.
 *
 * It is a reporter. A workflow runs it `continue-on-error`: a refused publish
 * must not stop a production fix shipping.
 */

import { readFileSync } from 'node:fs'

import { ADOPTION_TOOL_NAME } from '../foundation/evaluate-adoption.js'

export const ADOPTION_INGEST_TOKEN_ENV = 'OPERATOR_PORTAL_ADOPTION_INGEST_TOKEN'
export const ADOPTION_INGEST_ORIGIN_ENV = 'OPERATOR_PORTAL_URL'
export const ADOPTION_INGEST_DEFAULT_ORIGIN = 'https://ops.nardukenterprises.com'
export const ADOPTION_INGEST_PATH = '/api/estate/ingest'

export const ADOPTION_PUBLISH_EXIT = {
  stored: 0,
  badReport: 1,
  noToken: 2,
  refused: 3,
} as const

export const ADOPTION_PUBLISH_USAGE =
  'Usage: narduk-app adoption publish --report <adoption.json> [--origin <url>] [--dry-run]'

export interface AdoptionPublishFlags {
  reportPath: string
  /** null: take `OPERATOR_PORTAL_URL`, then the production origin. */
  origin: string | null
  dryRun: boolean
}

export function parseAdoptionPublishArgs(args: string[]): AdoptionPublishFlags {
  let reportPath: string | null = null
  let origin: string | null = null
  let dryRun = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--report') reportPath = args[(index += 1)] ?? null
    else if (arg === '--origin') origin = args[(index += 1)] ?? null
    else if (arg === '--dry-run') dryRun = true
    else if (arg === '--token' || arg?.startsWith('--token=')) {
      throw new Error(
        `The key is read from ${ADOPTION_INGEST_TOKEN_ENV}, never from an argument.\n${ADOPTION_PUBLISH_USAGE}`,
      )
    } else throw new Error(`Unknown adoption publish option: ${arg}\n${ADOPTION_PUBLISH_USAGE}`)
  }
  if (!reportPath)
    throw new Error(`--report <adoption.json> is required\n${ADOPTION_PUBLISH_USAGE}`)
  return { dryRun, origin, reportPath }
}

/** The ingest body for one artefact, or a thrown reason it is not one. */
export function buildAdoptionIngestBody(artefact: unknown): { adoption_reports: unknown[] } {
  const record = artefact as {
    schemaVersion?: unknown
    tool?: unknown
    app?: { repo?: unknown }
    requirements?: unknown
  } | null
  if (
    !record ||
    typeof record !== 'object' ||
    record.tool !== ADOPTION_TOOL_NAME ||
    record.schemaVersion !== 1
  ) {
    throw new Error(`not a schema-1 ${ADOPTION_TOOL_NAME} artefact`)
  }
  if (typeof record.app?.repo !== 'string' || !Array.isArray(record.requirements)) {
    throw new Error('the artefact names no repository or no requirements')
  }
  return { adoption_reports: [record] }
}

/** Removes the credential from any text that might echo it. */
export function scrubCredential(text: string, token: string): string {
  return token.length > 8 ? text.split(token).join('[credential]') : text
}

export interface AdoptionPublishDeps {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  readFile?: (path: string) => string
  log?: (message: string) => void
  error?: (message: string) => void
}

export async function runAdoptionPublish(
  flags: AdoptionPublishFlags,
  deps: AdoptionPublishDeps = {},
): Promise<number> {
  const env = deps.env ?? process.env
  const fetchImpl = deps.fetchImpl ?? fetch
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const log = deps.log ?? ((message: string) => console.log(message))
  const error = deps.error ?? ((message: string) => console.error(message))

  let body: { adoption_reports: unknown[] }
  try {
    body = buildAdoptionIngestBody(JSON.parse(readFile(flags.reportPath)))
  } catch (cause) {
    error(
      `adoption publish: ${flags.reportPath} is not a publishable adoption report: ${
        cause instanceof Error ? cause.message : 'unreadable'
      }`,
    )
    return ADOPTION_PUBLISH_EXIT.badReport
  }
  const report = body.adoption_reports[0] as {
    app: { repo: string; commit?: unknown }
    result?: unknown
    generated?: unknown
  }
  log(
    `adoption publish: ${report.app.repo} @ ${String(report.app.commit ?? 'unknown').slice(0, 12)}: ` +
      `${String(report.result ?? 'unknown')}, generated ${String(report.generated ?? 'unknown')}`,
  )
  if (flags.dryRun) {
    log('adoption publish: dry run, nothing sent')
    return ADOPTION_PUBLISH_EXIT.stored
  }

  const token = (env[ADOPTION_INGEST_TOKEN_ENV] ?? '').trim()
  if (!token) {
    error(
      `adoption publish: ${ADOPTION_INGEST_TOKEN_ENV} is not set, so nothing was sent to the Operator Portal. ` +
        'Install the repository secret of that name (the producer:narduk-app-adoption key).',
    )
    return ADOPTION_PUBLISH_EXIT.noToken
  }

  const origin = (flags.origin ?? env[ADOPTION_INGEST_ORIGIN_ENV] ?? ADOPTION_INGEST_DEFAULT_ORIGIN)
    .trim()
    .replace(/\/+$/u, '')
  try {
    const response = await fetchImpl(`${origin}${ADOPTION_INGEST_PATH}`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'narduk-app-adoption-publisher',
      },
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
    })
    const text = scrubCredential((await response.text()).slice(0, 500), token).slice(0, 300)
    if (response.status !== 200) {
      error(`adoption publish: the portal refused the report: HTTP ${response.status}: ${text}`)
      return ADOPTION_PUBLISH_EXIT.refused
    }
    log(`adoption publish: stored: ${text}`)
    return ADOPTION_PUBLISH_EXIT.stored
  } catch (cause) {
    error(
      `adoption publish: the portal could not be reached: ${cause instanceof Error ? cause.name : 'error'}`,
    )
    return ADOPTION_PUBLISH_EXIT.refused
  }
}
