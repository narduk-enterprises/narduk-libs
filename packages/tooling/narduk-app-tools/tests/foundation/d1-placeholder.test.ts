/**
 * Sub-check 1.5: a D1 binding still carrying the scaffold's all-zero
 * `database_id` fails `foundation:check` (narduk-libs#662). Each case moves one
 * fact away from the conformant baseline and asserts the exact flip.
 */

import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import { PLACEHOLDER_D1_DATABASE_ID } from '../../src/d1-create.js'
import type { FoundationCheckArtefact } from '../../src/foundation/types.js'
import {
  CONFORMANT_REALITY,
  itemStatus,
  makeTempRepo,
  subCheckStatus,
  writeConformantBaseline,
  writeFile,
  writeJson,
} from './helpers.js'

const REAL_ID = '6b1f6f53-8a1f-4a4e-9d6e-6f2a4b8c9d10'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function fixture(): string {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeConformantBaseline(root)
  return root
}

async function run(root: string) {
  return runFoundationCheck({
    root,
    toolVersion: '0.0.0-test',
    reality: CONFORMANT_REALITY,
    appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
  })
}

function detail(artefact: FoundationCheckArtefact): string {
  const sub = artefact.items.flatMap((item) => item.checks).find((c) => c.id === '1.5')
  if (!sub) throw new Error('no sub-check 1.5')
  return sub.detail
}

function withD1(root: string, databaseId: string, extra: Record<string, unknown> = {}): void {
  writeJson(root, 'wrangler.json', {
    workers_dev: true,
    preview_urls: true,
    d1_databases: [{ binding: 'DB', database_name: 'fixture-app-db', database_id: databaseId }],
    ...extra,
  })
  writeJson(root, 'Config/cloudflare-app.json', {
    schemaVersion: 1,
    product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
    worker: { nitroPreset: 'cloudflare_module' },
    access: { exposureClass: 'public' },
    bindings: { d1: [{ binding: 'DB' }], r2: [] },
  })
}

describe('sub-check 1.5 -- D1 bindings name a real database', () => {
  it('is not-applicable when the wrangler config declares no D1 binding', async () => {
    const artefact = await run(fixture())
    expect(subCheckStatus(artefact, '1.5')).toBe('not-applicable')
    expect(itemStatus(artefact, 1)).toBe('pass')
  })

  it('fails the placeholder id, naming db create and the raw wrangler command', async () => {
    const root = fixture()
    withD1(root, PLACEHOLDER_D1_DATABASE_ID)
    const artefact = await run(root)

    expect(subCheckStatus(artefact, '1.5')).toBe('fail')
    expect(itemStatus(artefact, 1)).toBe('fail')
    expect(artefact.result).toBe('FAIL')
    expect(artefact.exitCode).toBe(1)
    expect(detail(artefact)).toContain('d1_databases[0] (DB)')
    expect(detail(artefact)).toContain('`narduk-app db create`')
    expect(detail(artefact)).toContain('`wrangler d1 create fixture-app-db`')
    expect(detail(artefact)).toContain('CLOUDFLARE_ACCOUNT_ID')
  })

  it('passes once the id is real -- the one change that flips it', async () => {
    const root = fixture()
    withD1(root, REAL_ID)
    const artefact = await run(root)
    expect(subCheckStatus(artefact, '1.5')).toBe('pass')
    expect(artefact.result).toBe('PASS')
  })

  it('reads every environment, and names the binding to create when several are open', async () => {
    const root = fixture()
    withD1(root, REAL_ID, {
      env: {
        staging: {
          d1_databases: [
            {
              binding: 'DB',
              database_name: 'fixture-app-staging-db',
              database_id: PLACEHOLDER_D1_DATABASE_ID,
            },
          ],
        },
      },
    })
    const envOnly = await run(root)
    expect(subCheckStatus(envOnly, '1.5')).toBe('fail')
    expect(detail(envOnly)).toContain('env.staging.d1_databases[0]')
    // db create writes only the top-level array, so it is not offered here.
    expect(detail(envOnly)).not.toContain('narduk-app db create')
    expect(detail(envOnly)).toContain('`wrangler d1 create fixture-app-staging-db`')

    writeJson(root, 'wrangler.json', {
      d1_databases: [
        { binding: 'DB', database_name: 'a-db', database_id: PLACEHOLDER_D1_DATABASE_ID },
        { binding: 'AUDIT', database_name: 'a-audit', database_id: PLACEHOLDER_D1_DATABASE_ID },
      ],
    })
    const two = await run(root)
    expect(detail(two)).toContain('`narduk-app db create --binding DB`')
    expect(detail(two)).toContain('`narduk-app db create --binding AUDIT`')
  })

  it('reads a JSONC config with comments, and a TOML one', async () => {
    const root = fixture()
    rmSync(`${root}/wrangler.json`)
    writeFile(
      root,
      'wrangler.jsonc',
      [
        '{',
        '  // the scaffold placeholder',
        `  "d1_databases": [{ "binding": "DB", "database_id": "${PLACEHOLDER_D1_DATABASE_ID}", },],`,
        '}',
      ].join('\n'),
    )
    expect(subCheckStatus(await run(root), '1.5')).toBe('fail')

    rmSync(`${root}/wrangler.jsonc`)
    writeFile(
      root,
      'wrangler.toml',
      [
        '[[d1_databases]]',
        'binding = "DB"',
        'database_name = "fixture-app-db"',
        `database_id = "${PLACEHOLDER_D1_DATABASE_ID}"`,
      ].join('\n'),
    )
    expect(subCheckStatus(await run(root), '1.5')).toBe('fail')

    writeFile(
      root,
      'wrangler.toml',
      ['[[d1_databases]]', 'binding = "DB"', `database_id = "${REAL_ID}"`].join('\n'),
    )
    expect(subCheckStatus(await run(root), '1.5')).toBe('pass')
  })

  it('is unknown, not a pass, when the config cannot be parsed', async () => {
    const root = fixture()
    writeFile(root, 'wrangler.json', '{ "d1_databases": [')
    expect(subCheckStatus(await run(root), '1.5')).toBe('unknown')
  })
})
