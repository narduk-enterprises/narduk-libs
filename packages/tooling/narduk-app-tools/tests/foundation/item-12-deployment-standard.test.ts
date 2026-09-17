import { rmSync } from 'node:fs'

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
    const root = baseline({ deployment })
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

  it('allows branch builds once every production binding has a replacement', () => {
    const root = withD1(
      block({
        nonProductionBranchBuilds: true,
        previewBindings: { d1: ['DB'], kv: ['CACHE'], r2: [] },
      }),
    )
    expect(statusOf(root, '12.4')).toBe('pass')
    expect(run(root).exitCode).toBe(0)
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
