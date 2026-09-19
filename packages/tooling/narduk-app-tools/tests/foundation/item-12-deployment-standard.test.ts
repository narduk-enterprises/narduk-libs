import { readFileSync, rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  defaultDeploymentBlock,
  deploymentBlockJsonSchema,
  previewBindingName,
  readDeploymentBlock,
  DEPLOYMENT_STANDARD,
  STANDARD_DEPLOY_COMMAND,
} from '../../src/deployment-config.js'
import {
  bindingsByKindFromToml,
  evaluateItem12,
  scanDeployment,
  CLOUDFLARE_APP_FILE,
  DEPLOYMENT_ITEM_ID,
} from '../../src/foundation/items/item-12-deployment-standard.js'
import {
  formatDeploymentSummary,
  runDeploymentCheck,
  DEPLOYMENT_TOOL_NAME,
} from '../../src/foundation/evaluate-deployment.js'
import { parseDeploymentCheckArgs } from '../../src/commands/deployment-check.js'
import { AppRepo } from '../../src/foundation/source.js'
import type { FoundationStatus, FoundationSubCheck } from '../../src/foundation/types.js'
import { makeTempRepo, writeFile, writeJson } from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function block(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...defaultDeploymentBlock({ appSlug: 'fixture' }), ...overrides }
}

/** An adopted app with no D1/KV/R2 at all: every sub-check decidable, every
 * one passing. Tests move ONE fact away from this per case. */
function baseline(options: { deployment?: Record<string, unknown> | null } = {}): string {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeJson(root, 'package.json', { name: 'fixture-app' })
  writeJson(root, 'wrangler.json', { name: 'fixture', workers_dev: false })
  const deployment = options.deployment === undefined ? block() : options.deployment
  writeJson(root, CLOUDFLARE_APP_FILE, {
    schemaVersion: 1,
    product: { name: 'Fixture', repository: 'narduk-enterprises/fixture' },
    ...(deployment === null ? {} : { deployment }),
  })
  return root
}

function checksOf(root: string, strict = false): FoundationSubCheck[] {
  return evaluateItem12(scanDeployment(new AppRepo(root)), strict)
}

function statusOf(root: string, id: string, strict = false): FoundationStatus {
  const sub = checksOf(root, strict).find((c) => c.id === id)
  if (!sub) throw new Error(`no sub-check ${id}`)
  return sub.status
}

function detailOf(root: string, id: string, strict = false): string {
  const sub = checksOf(root, strict).find((c) => c.id === id)
  if (!sub) throw new Error(`no sub-check ${id}`)
  return sub.detail
}

function run(root: string, strict = false): ReturnType<typeof runDeploymentCheck> {
  return runDeploymentCheck({
    root,
    toolVersion: '0.0.0-test',
    strict,
    generated: '2026-09-17T00:00:00.000Z',
    appOverrides: { repo: 'narduk-enterprises/fixture', commit: 'abc', ref: 'refs/heads/main' },
  })
}

describe('the deployment block schema', () => {
  it('accepts the design §2.1 block verbatim', () => {
    const outcome = readDeploymentBlock({
      deployment: {
        standard: 'narduk-v1',
        builder: 'workers-builds',
        productionBranch: 'main',
        productionDeployCommand: 'narduk-app deploy versions-upload',
        nonProductionDeployCommand: 'narduk-app deploy versions-upload',
        nonProductionBranchBuilds: true,
        promotion: {
          mode: 'auto-on-green',
          gateCheck: 'ci / Required',
          credential: 'cloudflare/prd/narduk-enterprises-buoys-promote',
        },
        liveProof: {
          buildVersionHeader: 'x-build-version',
          healthPath: '/api/health',
          smokePath: '/',
          attempts: 6,
          intervalSeconds: 10,
        },
        rollback: { mode: 'auto', alert: 'resend' },
        staging: { enabled: false },
        previewBindings: { d1: [], kv: [], r2: [] },
      },
    })
    expect(outcome.kind).toBe('valid')
  })

  it('defaults staging to disabled and previewBindings to empty', () => {
    const minimal = block()
    delete minimal.staging
    delete minimal.previewBindings
    const outcome = readDeploymentBlock({ deployment: minimal })
    if (outcome.kind !== 'valid') throw new Error(`expected valid, got ${outcome.kind}`)
    expect(outcome.block.staging.enabled).toBe(false)
    expect(outcome.block.previewBindings).toEqual({ d1: [], kv: [], r2: [] })
  })

  it('refuses a binding with two preview entries rather than shadowing one', () => {
    const outcome = readDeploymentBlock({
      deployment: block({
        previewBindings: {
          d1: [],
          kv: [
            { binding: 'KV', id: 'a'.repeat(32) },
            { binding: 'KV', id: 'b'.repeat(32) },
          ],
          r2: [],
        },
      }),
    })
    if (outcome.kind !== 'invalid') throw new Error(`expected invalid, got ${outcome.kind}`)
    expect(outcome.issues.map((issue) => issue.message).join('\n')).toContain(
      'KV appears more than once',
    )
  })

  it('reports an absent block rather than inventing one', () => {
    expect(readDeploymentBlock({ product: {} }).kind).toBe('absent')
    expect(readDeploymentBlock(null).kind).toBe('absent')
    expect(readDeploymentBlock('nope').kind).toBe('absent')
  })

  it('treats another standard as exempt, not as a pile of violations', () => {
    const outcome = readDeploymentBlock({ deployment: { standard: 'legacy-push', anything: 1 } })
    expect(outcome).toEqual({ kind: 'exempt', standard: 'legacy-push' })
  })

  it('rejects an unknown key rather than silently ignoring it', () => {
    const outcome = readDeploymentBlock({ deployment: { ...block(), rollbackk: {} } })
    if (outcome.kind !== 'invalid') throw new Error(`expected invalid, got ${outcome.kind}`)
    expect(JSON.stringify(outcome.issues)).toContain('rollbackk')
  })

  it('names the exact path of each violation', () => {
    const outcome = readDeploymentBlock({
      deployment: block({
        nonProductionBranchBuilds: 'yes',
        liveProof: { healthPath: 'api/health', smokePath: '/' },
      }),
    })
    if (outcome.kind !== 'invalid') throw new Error(`expected invalid, got ${outcome.kind}`)
    const paths = outcome.issues.map((issue) => issue.path)
    expect(paths).toContain('nonProductionBranchBuilds')
    expect(paths).toContain('liveProof.healthPath')
  })

  it('reads a preview binding written either way', () => {
    expect(previewBindingName('DB')).toBe('DB')
    expect(previewBindingName({ binding: 'DB', database_id: 'x' })).toBe('DB')
    const outcome = readDeploymentBlock({
      deployment: block({
        previewBindings: { d1: [{ binding: 'DB', database_id: 'preview' }], kv: ['CACHE'], r2: [] },
      }),
    })
    expect(outcome.kind).toBe('valid')
  })

  it('projects to JSON Schema for non-TypeScript consumers', () => {
    const schema = deploymentBlockJsonSchema()
    expect(Object.keys(schema.properties as Record<string, unknown>)).toContain('previewBindings')
  })
})

describe('item 12 rollout mode', () => {
  it('passes an app that has not adopted the standard, and says so loudly', () => {
    const root = baseline({ deployment: null })
    const artefact = run(root)
    expect(artefact.adoption).toBe('not-adopted')
    expect(artefact.mode).toBe('rollout')
    expect(artefact.result).toBe('PASS')
    expect(artefact.exitCode).toBe(0)
    expect(artefact.item.status).toBe('not-applicable')
    expect(formatDeploymentSummary(artefact)).toContain('NOT ADOPTED')
    expect(detailOf(root, '12.0')).toContain('--strict')
  })

  it('passes an app with no Config/cloudflare-app.json at all', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'bare' })
    expect(run(root).exitCode).toBe(0)
  })

  it('fails the same app under --strict', () => {
    const root = baseline({ deployment: null })
    const artefact = run(root, true)
    expect(artefact.mode).toBe('strict')
    expect(artefact.result).toBe('FAIL')
    expect(artefact.exitCode).toBe(1)
    expect(statusOf(root, '12.0', true)).toBe('fail')
  })

  it('passes a fully adopted app', () => {
    const artefact = run(baseline())
    expect(artefact.adoption).toBe('adopted')
    expect(artefact.result).toBe('PASS')
    expect(artefact.item.id).toBe(DEPLOYMENT_ITEM_ID)
    expect(artefact.tool).toBe(DEPLOYMENT_TOOL_NAME)
  })

  it('reports an exempt app as not-applicable in either mode', () => {
    const root = baseline({ deployment: { standard: 'legacy-push' } })
    expect(run(root).exitCode).toBe(0)
    expect(run(root, true).exitCode).toBe(0)
    expect(run(root).adoption).toBe('exempt')
  })

  it('fails a block that claims the standard and does not satisfy it, in either mode', () => {
    const root = baseline({ deployment: { standard: DEPLOYMENT_STANDARD } })
    expect(run(root).exitCode).toBe(1)
    expect(run(root, true).exitCode).toBe(1)
    expect(run(root).adoption).toBe('invalid')
  })
})

describe('item 12 standard conformance', () => {
  it('refuses a build command that deploys instead of uploading', () => {
    const root = baseline({
      deployment: block({ productionDeployCommand: 'narduk-app deploy deploy' }),
    })
    expect(statusOf(root, '12.1')).toBe('fail')
    expect(detailOf(root, '12.1')).toContain(STANDARD_DEPLOY_COMMAND)
  })

  it('refuses a promotion credential that is not a Cloudflare credential path', () => {
    const root = baseline({
      deployment: block({
        promotion: { mode: 'auto-on-green', gateCheck: 'ci / Required', credential: 'GH_TOKEN' },
      }),
    })
    expect(statusOf(root, '12.2')).toBe('fail')
  })

  it('accepts manual-dispatch promotion without the auto-on-green credential rule', () => {
    const root = baseline({
      deployment: block({
        promotion: { mode: 'manual-dispatch', gateCheck: 'ci / Required', credential: 'operator' },
      }),
    })
    expect(statusOf(root, '12.2')).toBe('pass')
  })

  it('refuses a live proof aimed at a header narduk-core does not emit', () => {
    const root = baseline({
      deployment: block({
        liveProof: {
          buildVersionHeader: 'x-commit',
          healthPath: '/api/health',
          smokePath: '/',
          attempts: 6,
          intervalSeconds: 10,
        },
      }),
    })
    expect(statusOf(root, '12.3')).toBe('fail')
    expect(detailOf(root, '12.3')).toContain('x-build-version')
  })

  it('fails two different account ids across environments', () => {
    const root = baseline()
    writeJson(root, 'wrangler.json', {
      name: 'fixture',
      account_id: 'aaaa',
      env: { staging: { account_id: 'bbbb' } },
    })
    expect(statusOf(root, '12.5')).toBe('fail')
  })

  it('treats an absent account_id as the paved path, not a finding', () => {
    expect(statusOf(baseline(), '12.5')).toBe('not-applicable')
  })

  it('states in its own verdict that it cannot see Cloudflare', () => {
    const artefact = run(baseline())
    expect(artefact.limitations.length).toBeGreaterThan(0)
    expect(formatDeploymentSummary(artefact)).toContain('reads the repository only')
  })
})

describe('item 12.4 -- the preview-binding refusal', () => {
  function withD1(deployment: Record<string, unknown>): string {
    const root = baseline({
      deployment: {
        ...deployment,
        migrations: {
          compatibility: 'expand-contract',
          credential: 'cloudflare/prd/fixture-migrate',
          databases: [{ binding: 'DB', sources: 'migrations.sources.json' }],
        },
      },
    })
    writeJson(root, 'migrations.sources.json', {
      sources: [{ source: 'app', path: 'sql', sourceVersion: '1' }],
    })
    writeJson(root, 'wrangler.json', {
      name: 'fixture',
      d1_databases: [{ binding: 'DB', database_name: 'fixture-db', database_id: 'prod' }],
      kv_namespaces: [{ binding: 'CACHE', id: 'prod-kv' }],
    })
    return root
  }

  it('passes when branch builds are off, whatever the app binds', () => {
    const root = withD1(block({ nonProductionBranchBuilds: false }))
    expect(statusOf(root, '12.4')).toBe('pass')
    expect(run(root).exitCode).toBe(0)
  })

  it('refuses branch builds against uncovered production D1 and KV', () => {
    const root = withD1(block({ nonProductionBranchBuilds: true }))
    expect(statusOf(root, '12.4')).toBe('fail')
    const detail = detailOf(root, '12.4')
    expect(detail).toContain('d1:DB')
    expect(detail).toContain('kv:CACHE')
    expect(detail).toContain('wrangler dev')
    const artefact = run(root)
    expect(artefact.exitCode).toBe(1)
    expect(artefact.uncoveredPreviewBindings).toEqual({ d1: ['DB'], kv: ['CACHE'], r2: [] })
  })

  it('refuses when the coverage is partial', () => {
    const root = withD1(
      block({
        nonProductionBranchBuilds: true,
        previewBindings: { d1: [{ binding: 'DB', database_id: 'preview' }], kv: [], r2: [] },
      }),
    )
    expect(statusOf(root, '12.4')).toBe('fail')
    expect(detailOf(root, '12.4')).toContain('kv:CACHE')
    expect(detailOf(root, '12.4')).not.toContain('d1:DB')
  })

  // narduk-libs#451 defect 4: bare-name coverage used to report PASS, which
  // read as preview isolation. The build cannot rebind a bare name, so the
  // runtime is identical to declaring nothing -- the honest verdict is UNKNOWN.
  it('does not claim isolation from a declaration the build cannot act on', () => {
    const root = withD1(
      block({
        nonProductionBranchBuilds: true,
        previewBindings: { d1: ['DB'], kv: ['CACHE'], r2: [] },
      }),
    )
    expect(statusOf(root, '12.4')).toBe('unknown')
    expect(statusOf(root, '12.4')).not.toBe('pass')
    expect(detailOf(root, '12.4')).toContain('declared, not enforced')
    expect(detailOf(root, '12.4')).toContain('.wrangler.deploy.production.json')
    const artefact = run(root)
    expect(artefact.result).toBe('UNKNOWN')
    expect(artefact.exitCode).toBe(2)
    expect(artefact.limitations.join(' ')).toContain('A bare binding name is a declaration')
    expect(artefact.previewConfig).toEqual({
      status: 'declared-only',
      file: null,
      rebound: [],
      blockers: [],
    })
  })

  // narduk-libs#473: with the preview resource named, the build uploads a
  // rebound config, and 12.4 checks that config rather than the declaration.
  describe('with the preview config generated (narduk-libs#473)', () => {
    const PREVIEW_DB = {
      binding: 'DB',
      database_id: 'preview',
      database_name: 'fixture-db-preview',
    }
    const PREVIEW_CACHE = { binding: 'CACHE', id: 'preview-kv' }

    it('passes when every binding is rebound to a preview resource', () => {
      const root = withD1(
        block({
          nonProductionBranchBuilds: true,
          previewBindings: { d1: [PREVIEW_DB], kv: [PREVIEW_CACHE], r2: [] },
        }),
      )
      expect(statusOf(root, '12.4')).toBe('pass')
      expect(detailOf(root, '12.4')).toContain('.wrangler.deploy.preview.json')
      expect(detailOf(root, '12.4')).toContain('kv:CACHE -> preview-kv')
      const artefact = run(root)
      expect(artefact.exitCode).toBe(0)
      expect(artefact.previewConfig).toEqual({
        status: 'ready',
        file: '.wrangler.deploy.preview.json',
        rebound: ['d1:DB -> preview', 'kv:CACHE -> preview-kv'],
        blockers: [],
      })
      expect(formatDeploymentSummary(artefact)).toContain(
        'preview    ready; branch builds upload .wrangler.deploy.preview.json',
      )
    })

    it('passes a Buoys-shaped app: two KV bindings in apps/web/wrangler.json', () => {
      const root = baseline({
        deployment: block({
          nonProductionBranchBuilds: true,
          previewBindings: {
            d1: [],
            kv: [
              { binding: 'KV', id: '1'.repeat(32) },
              { binding: 'OG_IMAGE_CACHE', id: '2'.repeat(32) },
            ],
            r2: [],
          },
        }),
      })
      rmSync(`${root}/wrangler.json`)
      writeJson(root, 'apps/web/wrangler.json', {
        name: 'buoys',
        kv_namespaces: [
          { binding: 'KV', id: 'b591b4b6ea1a4684900df2e24b19f551' },
          { binding: 'OG_IMAGE_CACHE', id: '03f10f45af19485286d57a095729932c' },
        ],
      })
      expect(statusOf(root, '12.4')).toBe('pass')
      expect(run(root).exitCode).toBe(0)
    })

    it('fails when a preview id is a production id', () => {
      const root = withD1(
        block({
          nonProductionBranchBuilds: true,
          previewBindings: { d1: [PREVIEW_DB], kv: [{ binding: 'CACHE', id: 'prod-kv' }], r2: [] },
        }),
      )
      expect(statusOf(root, '12.4')).toBe('fail')
      expect(detailOf(root, '12.4')).toContain('kv:CACHE id=prod-kv')
      expect(run(root).exitCode).toBe(1)
    })

    it('fails when a preview entry names a binding no config declares', () => {
      const root = withD1(
        block({
          nonProductionBranchBuilds: true,
          previewBindings: {
            d1: [PREVIEW_DB],
            kv: [PREVIEW_CACHE, { binding: 'CAHCE', id: 'preview-kv-2' }],
            r2: [],
          },
        }),
      )
      expect(statusOf(root, '12.4')).toBe('fail')
      expect(detailOf(root, '12.4')).toContain('kv:CAHCE')
    })

    it('fails when a preview entry names the binding under the wrong kind', () => {
      const root = withD1(
        block({
          nonProductionBranchBuilds: true,
          previewBindings: {
            d1: [PREVIEW_DB],
            kv: [PREVIEW_CACHE],
            r2: [{ binding: 'DB', bucket_name: 'b' }],
          },
        }),
      )
      expect(statusOf(root, '12.4')).toBe('fail')
      expect(detailOf(root, '12.4')).toContain('r2:DB')
    })

    it('stays undecided when one entry is still a bare name', () => {
      const root = withD1(
        block({
          nonProductionBranchBuilds: true,
          previewBindings: { d1: [PREVIEW_DB], kv: ['CACHE'], r2: [] },
        }),
      )
      expect(statusOf(root, '12.4')).toBe('unknown')
      expect(detailOf(root, '12.4')).toContain('kv:CACHE')
    })

    it('stays undecided when a D1 entry carries its id but not its name', () => {
      const root = withD1(
        block({
          nonProductionBranchBuilds: true,
          previewBindings: {
            d1: [{ binding: 'DB', database_id: 'preview' }],
            kv: [PREVIEW_CACHE],
            r2: [],
          },
        }),
      )
      expect(statusOf(root, '12.4')).toBe('unknown')
    })

    it('stays undecided for a TOML app config the build cannot rewrite', () => {
      const root = baseline({
        deployment: block({
          nonProductionBranchBuilds: true,
          previewBindings: { d1: [], kv: [PREVIEW_CACHE], r2: [] },
        }),
      })
      rmSync(`${root}/wrangler.json`)
      writeFile(
        root,
        'wrangler.toml',
        ['name = "fixture"', '[[kv_namespaces]]', 'binding = "CACHE"', 'id = "prod-kv"'].join('\n'),
      )
      expect(statusOf(root, '12.4')).toBe('unknown')
      expect(detailOf(root, '12.4')).toContain('TOML')
      expect(run(root).previewConfig?.status).toBe('blocked')
    })
  })

  it('allows branch builds for an app with no D1, KV or R2 at all', () => {
    const root = baseline({ deployment: block({ nonProductionBranchBuilds: true }) })
    expect(statusOf(root, '12.4')).toBe('pass')
  })

  it('sees a binding declared only under an env scope', () => {
    const root = baseline({ deployment: block({ nonProductionBranchBuilds: true }) })
    writeJson(root, 'wrangler.json', {
      name: 'fixture',
      env: { production: { r2_buckets: [{ binding: 'UPLOADS', bucket_name: 'prod' }] } },
    })
    expect(statusOf(root, '12.4')).toBe('fail')
    expect(detailOf(root, '12.4')).toContain('r2:UPLOADS')
  })

  it('reads a JSONC wrangler config with comments and trailing commas', () => {
    const root = baseline({ deployment: block({ nonProductionBranchBuilds: true }) })
    rmSync(`${root}/wrangler.json`)
    writeFile(
      root,
      'wrangler.jsonc',
      ['{', '  // production data', '  "d1_databases": [{ "binding": "DB" }],', '}'].join('\n'),
    )
    expect(statusOf(root, '12.4')).toBe('fail')
    expect(detailOf(root, '12.4')).toContain('d1:DB')
  })

  it('reads a wrangler.toml array-table by its own header', () => {
    const bindings = bindingsByKindFromToml(
      [
        '[[d1_databases]]',
        'binding = "DB"',
        '',
        '[[r2_buckets]]',
        'binding = "UPLOADS"',
        '',
        '[[env.staging.kv_namespaces]]',
        'binding = "CACHE"',
        '',
        '[vars]',
        'binding = "NOT_A_BINDING_TABLE"',
      ].join('\n'),
    )
    expect(bindings).toEqual({ d1: ['DB'], kv: ['CACHE'], r2: ['UPLOADS'] })
  })

  it('cannot decide the rule with branch builds on and no wrangler config', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'fixture-app' })
    writeJson(root, CLOUDFLARE_APP_FILE, {
      deployment: block({ nonProductionBranchBuilds: true }),
    })
    expect(statusOf(root, '12.4')).toBe('unknown')
    expect(run(root).exitCode).toBe(2)
  })
})

describe('foundation:check:deployment arguments', () => {
  it('defaults to the working directory in rollout mode', () => {
    const flags = parseDeploymentCheckArgs([], '/tmp/app')
    expect(flags.strict).toBe(false)
    expect(flags.json).toBe(false)
    expect(flags.checkoutDir).toBe('/tmp/app')
  })

  it('takes --strict, --checkout and both spellings of --json', () => {
    expect(parseDeploymentCheckArgs(['--strict'], '/tmp/app').strict).toBe(true)
    expect(parseDeploymentCheckArgs(['--checkout', '/tmp/other'], '/tmp/app').checkoutDir).toBe(
      '/tmp/other',
    )
    expect(parseDeploymentCheckArgs(['--json'], '/tmp/app').json).toBe(true)
    expect(parseDeploymentCheckArgs(['--json', 'out.json'], '/tmp/app').jsonPath).toBe('out.json')
  })

  it('refuses an option it does not know', () => {
    expect(() => parseDeploymentCheckArgs(['--nope'], '/tmp/app')).toThrow(
      'Unknown foundation:check:deployment option: --nope',
    )
  })
})

/* -------------------------------------------------------------------------- */
/* review round 1                                                             */
/* -------------------------------------------------------------------------- */

/** A repo with an explicit `worker` declaration and a second Worker beside the
 * app's own -- the shape §2.3 says the estate actually has. */
function repoWith(options: {
  deployment?: Record<string, unknown>
  worker?: Record<string, unknown>
  wrangler?: Record<string, unknown>
  extraFiles?: Record<string, string>
}): string {
  const root = makeTempRepo()
  tempDirs.push(root)
  writeJson(root, 'package.json', { name: 'fixture-app' })
  writeJson(root, 'wrangler.json', options.wrangler ?? { name: 'fixture' })
  writeJson(root, CLOUDFLARE_APP_FILE, {
    schemaVersion: 1,
    product: { name: 'Fixture', repository: 'narduk-enterprises/fixture' },
    ...(options.worker ? { worker: options.worker } : {}),
    deployment: options.deployment ?? block(),
  })
  for (const [rel, text] of Object.entries(options.extraFiles ?? {})) writeFile(root, rel, text)
  return root
}

const NE_ACCOUNT = '73a8592300000000000000000000beef'
const PERSONAL_ACCOUNT = 'd715f0aeb6b2e7b10f54e9e72fba8fdd'

describe('S9 -- the block a generated app is told to paste', () => {
  // `create-narduk-app` emits this block in its runbook and tells the new app
  // to run `foundation:check:deployment` against it, but the schema that check
  // enforces lives here. Neither package may depend on the other (see
  // fixtures/README.md), so this fixture is the pin: these two assertions are
  // what make the generator's copy impossible to drift out of the contract
  // without a red test here first.
  const canonical: unknown = JSON.parse(
    readFileSync(new URL('../../fixtures/default-deployment-block.json', import.meta.url), 'utf8'),
  )

  it('is what defaultDeploymentBlock hands a new app', () => {
    expect(canonical).toEqual(defaultDeploymentBlock({ appSlug: 'paste-check' }))
  })

  it('satisfies the schema the check it points at actually enforces', () => {
    const outcome = readDeploymentBlock({ deployment: canonical })
    expect(outcome.kind === 'invalid' ? outcome.issues : outcome.kind).toBe('valid')
  })
})

describe('S8 -- the staging schema accepts the design it was written from', () => {
  /** Design §5.2's staging-enabled block, verbatim in shape. */
  const stagingBlock = {
    enabled: true,
    workerName: 'operator-portal-staging',
    hostname: 'staging.ops.nardukenterprises.com',
    approval: 'environment',
    environment: 'production',
    bindings: { d1: ['DB'], kv: ['CACHE'], r2: [] },
  }

  function outcomeFor(staging: unknown): ReturnType<typeof readDeploymentBlock> {
    return readDeploymentBlock({ deployment: block({ staging }) })
  }

  it('accepts design §5.2 staging-enabled block verbatim', () => {
    const outcome = outcomeFor(stagingBlock)
    expect(outcome.kind === 'invalid' ? outcome.issues : outcome.kind).toBe('valid')
  })

  it('keeps the default an app that says nothing gets', () => {
    const outcome = readDeploymentBlock({
      deployment: { ...block(), staging: undefined },
    })
    if (outcome.kind !== 'valid') throw new Error('expected valid')
    expect(outcome.block.staging).toEqual({ enabled: false })
  })

  it('refuses an enabled stage that names no Worker and no hostname', () => {
    const outcome = outcomeFor({ enabled: true })
    if (outcome.kind !== 'invalid') throw new Error('expected invalid')
    const paths = outcome.issues.map((issue) => issue.path)
    expect(paths).toContain('staging.workerName')
    expect(paths).toContain('staging.hostname')
    expect(paths).toContain('staging.approval')
  })

  it('refuses approval "environment" with no environment to approve in', () => {
    const outcome = outcomeFor({ ...stagingBlock, environment: undefined })
    if (outcome.kind !== 'invalid') throw new Error('expected invalid')
    expect(outcome.issues.map((issue) => issue.path)).toContain('staging.environment')
  })

  it('accepts auto-after-proof without an environment', () => {
    const outcome = outcomeFor({
      enabled: true,
      workerName: 'x-staging',
      hostname: 'staging.example.com',
      approval: 'auto-after-proof',
    })
    expect(outcome.kind).toBe('valid')
  })

  it('refuses a stage configured but switched off, rather than ignoring it', () => {
    const outcome = outcomeFor({ enabled: false, workerName: 'x-staging' })
    if (outcome.kind !== 'invalid') throw new Error('expected invalid')
    expect(outcome.issues.map((issue) => issue.path)).toContain('staging.workerName')
  })

  it('refuses a hostname that is really a URL', () => {
    const outcome = outcomeFor({ ...stagingBlock, hostname: 'https://staging.example.com/' })
    expect(outcome.kind).toBe('invalid')
  })

  it('still projects to JSON Schema for non-TypeScript consumers', () => {
    const schema = deploymentBlockJsonSchema()
    const properties = schema.properties as Record<string, unknown>
    expect(Object.keys(properties)).toContain('staging')
    expect(Object.keys(properties)).toContain('accountId')
  })
})

describe('S7 -- 12.5 reads TOML and compares the declared account', () => {
  it('reads account_id out of a second Worker written in TOML', () => {
    const root = repoWith({
      deployment: block({ accountId: NE_ACCOUNT }),
      extraFiles: {
        'services/farmdata-refresh/wrangler.toml': [
          'name = "farmdata-refresh"',
          `account_id = "${PERSONAL_ACCOUNT}"`,
        ].join('\n'),
      },
    })
    expect(statusOf(root, '12.5')).toBe('fail')
    expect(detailOf(root, '12.5')).toContain('services/farmdata-refresh/wrangler.toml')
    expect(detailOf(root, '12.5')).toContain(PERSONAL_ACCOUNT)
    expect(run(root).exitCode).toBe(1)
  })

  it('is not not-applicable when the app itself is TOML', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'fixture-app' })
    writeFile(root, 'wrangler.toml', `name = "fixture"\naccount_id = "${NE_ACCOUNT}"\n`)
    writeJson(root, CLOUDFLARE_APP_FILE, { deployment: block({ accountId: NE_ACCOUNT }) })
    expect(statusOf(root, '12.5')).toBe('pass')
  })

  it('does not read a commented-out account_id as a declaration', () => {
    const root = repoWith({
      deployment: block({ accountId: NE_ACCOUNT }),
      extraFiles: {
        'services/redirect/wrangler.toml': [
          '# account_id distinguishes the two configs -- the root one is NE',
          `#   account_id = "${PERSONAL_ACCOUNT}"`,
          'name = "redirect"',
        ].join('\n'),
      },
    })
    expect(statusOf(root, '12.5')).toBe('pass')
  })

  it('says plainly that it did not check the account when none is declared', () => {
    const root = repoWith({ wrangler: { name: 'fixture', account_id: PERSONAL_ACCOUNT } })
    expect(statusOf(root, '12.5')).toBe('pass')
    expect(detailOf(root, '12.5')).toContain('internal consistency ONLY')
    expect(detailOf(root, '12.5')).toContain('deployment.accountId')
  })

  it('still fails two different accounts with nothing declared', () => {
    const root = repoWith({
      wrangler: { name: 'fixture', account_id: NE_ACCOUNT },
      extraFiles: {
        'services/other/wrangler.toml': `name = "other"\naccount_id = "${PERSONAL_ACCOUNT}"\n`,
      },
    })
    expect(statusOf(root, '12.5')).toBe('fail')
    expect(detailOf(root, '12.5')).toContain('one app deploys to one account')
  })

  it('passes when every config names the declared account', () => {
    const root = repoWith({
      deployment: block({ accountId: NE_ACCOUNT }),
      wrangler: { name: 'fixture', account_id: NE_ACCOUNT },
      extraFiles: {
        'services/other/wrangler.toml': `name = "other"\naccount_id = "${NE_ACCOUNT}"\n`,
      },
    })
    expect(statusOf(root, '12.5')).toBe('pass')
    expect(detailOf(root, '12.5')).toContain(NE_ACCOUNT)
  })

  it('refuses an accountId that is not a Cloudflare account id', () => {
    const outcome = readDeploymentBlock({ deployment: block({ accountId: 'not-an-account' }) })
    expect(outcome.kind).toBe('invalid')
  })
})

describe('S10 -- the two design §2.2 tier-1 assertions that were missing', () => {
  it('fails when the app declares workersDev false and wrangler never says so', () => {
    const root = repoWith({
      worker: { workersDev: false, previewUrls: false },
      wrangler: { name: 'fixture' },
    })
    expect(statusOf(root, '12.6')).toBe('fail')
    expect(detailOf(root, '12.6')).toContain('never sets workers_dev')
    expect(run(root).exitCode).toBe(1)
  })

  it('fails when the two files disagree outright', () => {
    const root = repoWith({
      worker: { workersDev: true, previewUrls: true },
      wrangler: { name: 'fixture', workers_dev: true, preview_urls: false },
    })
    expect(statusOf(root, '12.6')).toBe('fail')
    expect(detailOf(root, '12.6')).toContain('preview_urls=false')
  })

  it('fails on a disagreement hiding in an env scope', () => {
    const root = repoWith({
      worker: { workersDev: false, previewUrls: false },
      wrangler: {
        name: 'fixture',
        workers_dev: false,
        preview_urls: false,
        env: { production: { workers_dev: true, preview_urls: false } },
      },
    })
    expect(statusOf(root, '12.6')).toBe('fail')
  })

  it('passes when they agree', () => {
    const root = repoWith({
      worker: { workersDev: false, previewUrls: false },
      wrangler: { name: 'fixture', workers_dev: false, preview_urls: false },
    })
    expect(statusOf(root, '12.6')).toBe('pass')
  })

  it('is not-applicable when the app declares neither flag', () => {
    const root = repoWith({ wrangler: { name: 'fixture', workers_dev: false } })
    expect(statusOf(root, '12.6')).toBe('not-applicable')
  })

  it('reads the flags out of a TOML app config too', () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeJson(root, 'package.json', { name: 'fixture-app' })
    writeFile(root, 'wrangler.toml', 'name = "fixture"\nworkers_dev = true\n')
    writeJson(root, CLOUDFLARE_APP_FILE, {
      worker: { workersDev: false, previewUrls: false },
      deployment: block(),
    })
    expect(statusOf(root, '12.6')).toBe('fail')
    expect(detailOf(root, '12.6')).toContain('workers_dev=true')
  })

  it('12.4 sees a second Worker binding production data', () => {
    const root = repoWith({
      deployment: block({ nonProductionBranchBuilds: true }),
      wrangler: { name: 'fixture' },
      extraFiles: {
        'services/farmdata-refresh/wrangler.toml': [
          'name = "farmdata-refresh"',
          '[[d1_databases]]',
          'binding = "FARM_DB"',
        ].join('\n'),
      },
    })
    expect(statusOf(root, '12.4')).toBe('fail')
    expect(detailOf(root, '12.4')).toContain('d1:FARM_DB')
    expect(detailOf(root, '12.4')).toContain('services/farmdata-refresh/wrangler.toml')
  })

  it('12.4 stays undecided once that second Worker binding has a declared replacement', () => {
    const root = repoWith({
      deployment: block({
        nonProductionBranchBuilds: true,
        previewBindings: { d1: ['FARM_DB'], kv: [], r2: [] },
      }),
      wrangler: { name: 'fixture' },
      extraFiles: {
        'services/farmdata-refresh/wrangler.toml': [
          'name = "farmdata-refresh"',
          '[[d1_databases]]',
          'binding = "FARM_DB"',
        ].join('\n'),
      },
    })
    expect(statusOf(root, '12.4')).toBe('unknown')
    expect(detailOf(root, '12.4')).toContain('declared, not enforced')
  })
})

/**
 * narduk-libs#435: `"cache": { "enabled": true }` makes Cloudflare store Worker
 * responses. That is safe only on a narduk-core that already keeps thrown
 * errors (#429), preference-shaped responses (#427) and nonce-CSP HTML out of
 * the cache, so 12.7 refuses the switch against an older core -- in rollout
 * mode too, because the failure is live cross-visitor data, not a missing
 * declaration.
 */
describe('12.7 -- Workers Cache only on a narduk-core with the no-store guards', () => {
  const CORE = '@narduk-enterprises/narduk-core'

  function app(options: {
    cache?: unknown
    core?: string | null
    deployment?: Record<string, unknown> | null
    toml?: string
  }): string {
    const root = baseline({ deployment: options.deployment })
    const deps = options.core === null ? {} : { [CORE]: options.core ?? '2.2.4' }
    writeJson(root, 'package.json', { name: 'fixture-app', dependencies: deps })
    if (options.toml !== undefined) {
      rmSync(`${root}/wrangler.json`)
      writeFile(root, 'wrangler.toml', options.toml)
    } else {
      writeJson(root, 'wrangler.json', {
        name: 'fixture',
        workers_dev: false,
        ...(options.cache === undefined ? {} : { cache: options.cache }),
      })
    }
    return root
  }

  it('is not-applicable while Workers Cache is off', () => {
    expect(statusOf(app({}), '12.7')).toBe('not-applicable')
    expect(statusOf(app({ cache: { enabled: false } }), '12.7')).toBe('not-applicable')
    expect(detailOf(app({}), '12.7')).toContain('inert')
  })

  it('passes Workers Cache on an exact-pinned core that has the guards', () => {
    const root = app({ cache: { enabled: true }, core: '2.2.4' })
    expect(statusOf(root, '12.7')).toBe('pass')
    expect(detailOf(root, '12.7')).toContain('verify --live')
  })

  it.each(['2.2.3', '^2.2.3', '2.1.0', '1.25.0'])(
    'fails Workers Cache on narduk-core %s, which stores thrown errors',
    (core) => {
      const root = app({ cache: { enabled: true }, core })
      expect(statusOf(root, '12.7')).toBe('fail')
      expect(detailOf(root, '12.7')).toContain('2.2.4')
    },
  )

  it('fails even in rollout mode on an app that has not adopted the block', () => {
    const root = app({ cache: { enabled: true }, core: '2.2.3', deployment: null })
    expect(statusOf(root, '12.7')).toBe('fail')
    expect(run(root).exitCode).toBe(1)
  })

  it('reads an env-scoped switch too', () => {
    const root = app({ cache: { enabled: false }, core: '2.2.3' })
    writeJson(root, 'wrangler.json', {
      name: 'fixture',
      workers_dev: false,
      env: { production: { cache: { enabled: true } } },
    })
    expect(statusOf(root, '12.7')).toBe('fail')
    expect(detailOf(root, '12.7')).toContain('env.production')
  })

  it('reads a TOML [cache] table', () => {
    const root = app({ core: '2.2.3', toml: 'name = "fixture"\n\n[cache]\nenabled = true\n' })
    expect(statusOf(root, '12.7')).toBe('fail')
  })

  it('is unknown when the resolved narduk-core cannot be read', () => {
    expect(statusOf(app({ cache: { enabled: true }, core: null }), '12.7')).toBe('unknown')
    expect(statusOf(app({ cache: { enabled: true }, core: 'workspace:*' }), '12.7')).toBe('unknown')
  })
})

describe('12.8 D1 migration declaration', () => {
  it('requires source coverage and a separate persona for an adopted D1 app', () => {
    const root = baseline()
    writeJson(root, 'wrangler.json', {
      name: 'fixture',
      d1_databases: [{ binding: 'DB', database_id: 'd1-id', database_name: 'fixture-db' }],
    })
    expect(statusOf(root, '12.8')).toBe('fail')
    const manifest = JSON.parse(readFileSync(`${root}/${CLOUDFLARE_APP_FILE}`, 'utf8'))
    manifest.deployment.migrations = {
      compatibility: 'expand-contract',
      credential: 'cloudflare/prd/fixture-migrate',
      databases: [{ binding: 'DB', sources: 'migrations.sources.json' }],
    }
    writeJson(root, CLOUDFLARE_APP_FILE, manifest)
    expect(statusOf(root, '12.8')).toBe('fail')
    writeJson(root, 'migrations.sources.json', { sources: [{ source: 'app', path: 'drizzle' }] })
    expect(statusOf(root, '12.8')).toBe('pass')
    manifest.deployment.migrations.credential = manifest.deployment.promotion.credential
    writeJson(root, CLOUDFLARE_APP_FILE, manifest)
    expect(statusOf(root, '12.8')).toBe('fail')
  })
  it('does not impose migration infrastructure on an app with no D1', () => {
    expect(statusOf(baseline(), '12.8')).toBe('not-applicable')
  })
})
