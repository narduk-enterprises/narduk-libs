import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readDeploymentBlock, type DeploymentBlock } from '../src/deployment-config.js'
import {
  checkStagingServesSha,
  PROMOTE_EXIT,
  parseVersionsPromoteArgs,
  runVersionsPromote,
  type SpawnWrangler,
  type WorkerDeployment,
  type WorkerVersion,
  type WranglerVersionsClient,
} from '../src/promote.js'
import {
  parseStagingArgs,
  planStagingConfig,
  readUploadReceipt,
  runStagingDeploy,
  STAGING_CONFIG_FILENAME,
  STAGING_EXIT,
  writeStagingStepOutputs,
  type StagingContext,
} from '../src/staging.js'
import type { VerifyReport } from '../src/verify-live.js'

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const OTHER = '0000000000000000000000000000000000000001'
const ACCOUNT = 'c72b3f73ec4433304033bdfb55f2d24f'
const STAGING_VERSION = '11111111-2222-3333-4444-555555555555'
const PREVIOUS_VERSION = '99999999-8888-7777-6666-555555555555'

const ACTIONS_ENV = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '1',
  GITHUB_REPOSITORY: 'narduk-enterprises-clients/harmony-hot-sauce',
  GITHUB_WORKFLOW: 'Promote',
  GITHUB_EVENT_NAME: 'workflow_run',
  GITHUB_REF_NAME: 'main',
  NARDUK_APP_CONFIG_SOURCE: 'file',
}

const PRODUCTION_WRANGLER = {
  name: 'harmony-hot-sauce',
  account_id: ACCOUNT,
  main: '.output/server/index.mjs',
  routes: [{ pattern: 'harmonyhotsauce.com', custom_domain: true }],
  vars: { AUTH_PROVIDERS: 'email' },
  d1_databases: [{ binding: 'DB', database_name: 'prod-db', database_id: 'prod-db-id' }],
  kv_namespaces: [{ binding: 'KV', id: 'prod-kv' }],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: 'prod-bucket' }],
}

const STAGING_BINDINGS = {
  d1: [{ binding: 'DB', database_name: 'staging-db', database_id: 'staging-db-id' }],
  kv: [{ binding: 'KV', id: 'staging-kv' }],
  r2: [{ binding: 'BUCKET', bucket_name: 'staging-bucket' }],
}

function stagingBlock(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    workerName: 'harmony-hot-sauce-staging',
    hostname: 'staging.harmonyhotsauce.com',
    approval: 'auto-after-proof',
    bindings: STAGING_BINDINGS,
    ...extra,
  }
}

function deploymentDoc(staging: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    product: { name: 'Harmony', repository: 'narduk-enterprises-clients/harmony-hot-sauce' },
    worker: { name: 'harmony-hot-sauce', wranglerConfig: 'apps/web/wrangler.json' },
    deployment: {
      standard: 'narduk-v1',
      builder: 'workers-builds',
      accountId: ACCOUNT,
      productionBranch: 'main',
      productionDeployCommand: 'narduk-app deploy versions-upload',
      nonProductionDeployCommand: 'narduk-app deploy versions-upload',
      nonProductionBranchBuilds: false,
      promotion: {
        mode: 'auto-on-green',
        gateCheck: 'ci / Required',
        credential: 'cloudflare/prd/tims-account-harmony-hot-sauce-promote',
      },
      liveProof: {
        buildVersionHeader: 'x-build-version',
        healthPath: '/api/health',
        smokePath: '/api/auth/runtime-public',
        smokeContentType: 'application/json',
        attempts: 10,
        intervalSeconds: 10,
      },
      rollback: { mode: 'manual', alert: 'none' },
      staging,
      previewBindings: { d1: [], kv: [], r2: [] },
    },
  }
}

function block(staging: Record<string, unknown> = stagingBlock()): DeploymentBlock {
  const outcome = readDeploymentBlock(deploymentDoc(staging))
  if (outcome.kind !== 'valid') throw new Error(`fixture is ${JSON.stringify(outcome)}`)
  return outcome.block
}

/** A checkout: `.git`, the declaration, the production config and a built bundle. */
function checkout(
  staging: Record<string, unknown> = stagingBlock(),
  options: { built?: boolean; committed?: Record<string, unknown> } = {},
): { root: string; appDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'narduk-staging-'))
  const appDir = join(root, 'apps', 'web')
  mkdirSync(join(root, '.git'))
  mkdirSync(join(root, 'Config'))
  mkdirSync(appDir, { recursive: true })
  writeFileSync(join(root, 'Config', 'cloudflare-app.json'), JSON.stringify(deploymentDoc(staging)))
  writeFileSync(join(appDir, 'wrangler.json'), JSON.stringify(PRODUCTION_WRANGLER))
  if (options.committed) {
    writeFileSync(join(appDir, 'wrangler.staging.json'), JSON.stringify(options.committed))
  }
  if (options.built !== false) {
    mkdirSync(join(appDir, '.output', 'server'), { recursive: true })
    writeFileSync(join(appDir, '.output', 'server', 'index.mjs'), 'export default {}\n')
  }
  return { root, appDir }
}

function report(result: 'PASS' | 'FAIL'): VerifyReport {
  return {
    schemaVersion: 1,
    tool: '@narduk-enterprises/narduk-app-tools/verify-live',
    generated: '2026-10-15T00:00:00Z',
    baseUrl: 'https://staging.harmonyhotsauce.com',
    expectedSha: SHA,
    expectedBuildId: null,
    attemptsUsed: 1,
    attemptsAllowed: 10,
    egress: 'direct',
    assertions: [],
    result,
    exitCode: result === 'PASS' ? 0 : 1,
  } as VerifyReport
}

function deployment(versionId: string): WorkerDeployment {
  return {
    id: `d-${versionId}`,
    created_on: '2026-10-15T00:00:00Z',
    versions: [{ version_id: versionId, percentage: 100 }],
  }
}

function tagged(id: string, tag?: string): WorkerVersion {
  return {
    id,
    metadata: { created_on: '2026-10-15T00:00:00Z' },
    ...(tag ? { annotations: { 'workers/tag': tag } } : {}),
  } as WorkerVersion
}

function client(
  deployments: WorkerDeployment[],
  versions: WorkerVersion[] = [],
): { client: WranglerVersionsClient; deployed: Array<{ id: string; percentage: number }> } {
  const deployed: Array<{ id: string; percentage: number }> = []
  return {
    deployed,
    client: {
      listVersions: async () => ({ versions, complete: true, limit: 20, source: 'api' }),
      listDeployments: async () => deployments,
      deployVersion: async (id, percentage) => {
        deployed.push({ id, percentage })
      },
      rollback: async () => {},
    },
  }
}

/** A wrangler that writes an upload receipt and records its argv. */
function uploadingSpawn(argv: string[][], worker = 'harmony-hot-sauce-staging'): SpawnWrangler {
  return (_command, args, options) => {
    argv.push(args)
    const receipt = options.env.WRANGLER_OUTPUT_FILE_PATH!
    writeFileSync(
      receipt,
      `${JSON.stringify({ type: 'wrangler-session' })}\n` +
        `${JSON.stringify({ type: 'version-upload', worker_name: worker, version_id: STAGING_VERSION })}\n`,
    )
    return { status: 0, signal: null }
  }
}

function stagingContext(
  appDir: string,
  overrides: Partial<StagingContext> = {},
): StagingContext & { argv: string[][]; deployed: Array<{ id: string; percentage: number }> } {
  const argv: string[][] = []
  const stub = client([deployment(PREVIOUS_VERSION)])
  return {
    appDir,
    env: ACTIONS_ENV,
    headSha: () => SHA,
    spawn: uploadingSpawn(argv),
    client: stub.client,
    verify: async () => report('PASS'),
    log: () => {},
    argv,
    deployed: stub.deployed,
    ...overrides,
  }
}

describe('parseStagingArgs', () => {
  it('requires the full 40-character commit CI verified', () => {
    expect(parseStagingArgs(['--sha', SHA.toUpperCase(), '--json']).sha).toBe(SHA)
    expect(() => parseStagingArgs([])).toThrow(/--sha/u)
    expect(() => parseStagingArgs(['--sha', SHA.slice(0, 7)])).toThrow(/40-character/u)
    expect(() => parseStagingArgs(['--sha', SHA, '--force'])).toThrow(/Unknown/u)
  })
})

describe('planStagingConfig', () => {
  it('derives a renamed, rebound, custom-domain config from production', () => {
    const { config, committedPath } = planStagingConfig({
      root: '/r',
      production: PRODUCTION_WRANGLER,
      deployment: block(),
    })
    expect(committedPath).toBeNull()
    expect(config.name).toBe('harmony-hot-sauce-staging')
    expect(config.routes).toEqual([{ pattern: 'staging.harmonyhotsauce.com', custom_domain: true }])
    expect(config.d1_databases).toEqual([
      { binding: 'DB', database_name: 'staging-db', database_id: 'staging-db-id' },
    ])
    expect(config.kv_namespaces).toEqual([{ binding: 'KV', id: 'staging-kv' }])
    expect(config.r2_buckets).toEqual([{ binding: 'BUCKET', bucket_name: 'staging-bucket' }])
    expect(config.keep_vars).toBe(true)
  })

  it('refuses a stage that leaves a binding on production data', () => {
    const uncovered = block(stagingBlock({ bindings: { d1: STAGING_BINDINGS.d1, kv: [], r2: [] } }))
    expect(() =>
      planStagingConfig({ root: '/r', production: PRODUCTION_WRANGLER, deployment: uncovered }),
    ).toThrow(/staging\.bindings has no entry for kv:KV, r2:BUCKET/u)
    const reused = block(
      stagingBlock({
        bindings: { ...STAGING_BINDINGS, kv: [{ binding: 'KV', id: 'prod-kv' }] },
      }),
    )
    expect(() =>
      planStagingConfig({ root: '/r', production: PRODUCTION_WRANGLER, deployment: reused }),
    ).toThrow(/production resource: kv:KV id=prod-kv/u)
  })

  it('refuses to derive a config when production binds state it cannot rebind', () => {
    expect(() =>
      planStagingConfig({
        root: '/r',
        production: {
          ...PRODUCTION_WRANGLER,
          hyperdrive: [{ binding: 'HD', id: 'prod-hd' }],
          queues: { producers: [{ binding: 'Q', queue: 'prod-q' }] },
        },
        deployment: block(),
      }),
    ).toThrow(/binds hyperdrive, queues.*staging\.wranglerConfig/u)
  })

  const committed = {
    ...PRODUCTION_WRANGLER,
    name: 'harmony-hot-sauce-staging',
    routes: [{ pattern: 'staging.harmonyhotsauce.com', custom_domain: true }],
    vars: { AUTH_BACKEND: 'local' },
    d1_databases: STAGING_BINDINGS.d1,
    kv_namespaces: STAGING_BINDINGS.kv,
    r2_buckets: STAGING_BINDINGS.r2,
  }

  it('uses a committed staging config as written once it matches the declaration', () => {
    const plan = planStagingConfig({
      root: '/r',
      production: PRODUCTION_WRANGLER,
      deployment: block(stagingBlock({ wranglerConfig: 'apps/web/wrangler.staging.json' })),
      read: () => committed,
    })
    expect(plan.committedPath).toBe('/r/apps/web/wrangler.staging.json')
    expect(plan.config.vars).toEqual({ AUTH_BACKEND: 'local' })
  })

  it('refuses a committed config that names another Worker, route or database', () => {
    const wrong = {
      ...committed,
      name: 'harmony-hot-sauce',
      routes: [{ pattern: 'harmonyhotsauce.com' }],
      d1_databases: [{ binding: 'DB', database_name: 'prod-db', database_id: 'prod-db-id' }],
      env: { staging: {} },
    }
    expect(() =>
      planStagingConfig({
        root: '/r',
        production: PRODUCTION_WRANGLER,
        deployment: block(stagingBlock({ wranglerConfig: 'apps/web/wrangler.staging.json' })),
        read: () => wrong,
      }),
    ).toThrow(
      /name is "harmony-hot-sauce".*env block.*routes no pattern to staging\.harmonyhotsauce\.com.*d1:DB binds database_id=prod-db-id/u,
    )
  })
})

describe('deployment.staging.wranglerConfig', () => {
  it('is configuration for a stage, so a disabled stage rejects it', () => {
    const outcome = readDeploymentBlock(
      deploymentDoc({ enabled: false, wranglerConfig: 'apps/web/wrangler.staging.json' }),
    )
    expect(outcome.kind).toBe('invalid')
  })
})

describe('runStagingDeploy', () => {
  it('is a no-op that exits 0 when staging is not enabled', async () => {
    const { appDir } = checkout({ enabled: false })
    const result = await runStagingDeploy(parseStagingArgs(['--sha', SHA]), stagingContext(appDir))
    expect(result.outcome).toBe('not-enabled')
    expect(result.exitCode).toBe(STAGING_EXIT.ok)
  })

  it('uploads the verified commit tagged, deploys it at 100% and proves the hostname', async () => {
    const { appDir } = checkout()
    let proofArgs: string[] = []
    const context = stagingContext(appDir, {
      verify: async (args) => {
        proofArgs = args
        return report('PASS')
      },
    })
    const result = await runStagingDeploy(parseStagingArgs(['--sha', SHA]), context)
    expect(result.outcome).toBe('proven')
    expect(result.exitCode).toBe(STAGING_EXIT.ok)
    expect(result.versionId).toBe(STAGING_VERSION)
    expect(result.previousVersionId).toBe(PREVIOUS_VERSION)
    expect(result.approval).toBe('auto-after-proof')
    const upload = context.argv[0]
    expect(upload.slice(0, 2)).toEqual(['exec', 'wrangler'])
    expect(upload).toEqual(expect.arrayContaining(['versions', 'upload', '--tag', SHA]))
    const configPath = upload[upload.indexOf('--config') + 1]
    expect(configPath).toBe(join(appDir, STAGING_CONFIG_FILENAME))
    expect(JSON.parse(readFileSync(configPath, 'utf8')).name).toBe('harmony-hot-sauce-staging')
    expect(context.deployed).toEqual([{ id: STAGING_VERSION, percentage: 100 }])
    expect(proofArgs.slice(0, 4)).toEqual([
      '--live',
      'https://staging.harmonyhotsauce.com',
      '--expect-sha',
      SHA,
    ])
    expect(proofArgs).toEqual(
      expect.arrayContaining([
        '--smoke-path',
        '/api/auth/runtime-public',
        '--expect-content-type',
        'application/json',
        '--attempts',
        '10',
      ]),
    )
  })

  it('rolls staging back and exits 4 when the proof fails, so production never runs', async () => {
    const { appDir } = checkout()
    const context = stagingContext(appDir, { verify: async () => report('FAIL') })
    const result = await runStagingDeploy(parseStagingArgs(['--sha', SHA]), context)
    expect(result.outcome).toBe('proof-failed')
    expect(result.exitCode).toBe(STAGING_EXIT.proofFailed)
    expect(result.rolledBackTo).toBe(PREVIOUS_VERSION)
    expect(context.deployed).toEqual([
      { id: STAGING_VERSION, percentage: 100 },
      { id: PREVIOUS_VERSION, percentage: 100 },
    ])
  })

  it('treats a proof that throws as a failed proof and rolls staging back', async () => {
    const { appDir } = checkout()
    const context = stagingContext(appDir, {
      verify: async () => {
        throw new Error('fetch failed')
      },
    })
    const result = await runStagingDeploy(parseStagingArgs(['--sha', SHA]), context)
    expect(result.outcome).toBe('proof-failed')
    expect(result.rolledBackTo).toBe(PREVIOUS_VERSION)
  })

  it('refuses outside Actions, off the production branch, or on another checkout', async () => {
    const { appDir } = checkout()
    const local = await runStagingDeploy(
      parseStagingArgs(['--sha', SHA]),
      stagingContext(appDir, { env: { NARDUK_APP_CONFIG_SOURCE: 'file' } }),
    )
    expect(local.outcome).toBe('guard-refused')
    const branch = await runStagingDeploy(
      parseStagingArgs(['--sha', SHA]),
      stagingContext(appDir, { env: { ...ACTIONS_ENV, GITHUB_REF_NAME: 'feature' } }),
    )
    expect(branch.detail).toMatch(/not the declared production branch main/u)
    const pr = await runStagingDeploy(
      parseStagingArgs(['--sha', SHA]),
      stagingContext(appDir, { env: { ...ACTIONS_ENV, GITHUB_EVENT_NAME: 'pull_request' } }),
    )
    expect(pr.exitCode).toBe(STAGING_EXIT.refused)
    const head = stagingContext(appDir, { headSha: () => OTHER })
    const moved = await runStagingDeploy(parseStagingArgs(['--sha', SHA]), head)
    expect(moved.outcome).toBe('guard-refused')
    expect(head.argv).toEqual([])
  })

  it('refuses before uploading when the staging bundle was not built', async () => {
    const { appDir } = checkout(stagingBlock(), { built: false })
    const context = stagingContext(appDir)
    const result = await runStagingDeploy(parseStagingArgs(['--sha', SHA]), context)
    expect(result.outcome).toBe('invalid-config')
    expect(result.detail).toMatch(/not built/u)
    expect(context.argv).toEqual([])
  })

  it('refuses an upload receipt for any Worker but the staging one', async () => {
    const { appDir } = checkout()
    const argv: string[][] = []
    const context = stagingContext(appDir, { spawn: uploadingSpawn(argv, 'harmony-hot-sauce') })
    const result = await runStagingDeploy(parseStagingArgs(['--sha', SHA]), context)
    expect(result.outcome).toBe('wrangler-failed')
    expect(result.trafficMayHaveChanged).toBe(false)
    expect(context.deployed).toEqual([])
  })

  it('dry-run resolves the stage and touches nothing', async () => {
    const { appDir } = checkout(
      stagingBlock({ wranglerConfig: 'apps/web/wrangler.staging.json' }),
      {
        committed: {
          ...PRODUCTION_WRANGLER,
          name: 'harmony-hot-sauce-staging',
          routes: [{ pattern: 'staging.harmonyhotsauce.com', custom_domain: true }],
          d1_databases: STAGING_BINDINGS.d1,
          kv_namespaces: STAGING_BINDINGS.kv,
          r2_buckets: STAGING_BINDINGS.r2,
        },
      },
    )
    const context = stagingContext(appDir)
    const result = await runStagingDeploy(parseStagingArgs(['--sha', SHA, '--dry-run']), context)
    expect(result.outcome).toBe('dry-run')
    expect(result.config).toBe('wrangler.staging.json')
    expect(context.argv).toEqual([])
    expect(context.deployed).toEqual([])
  })
})

describe('readUploadReceipt', () => {
  it('reads the version id and refuses a malformed receipt', () => {
    const line = JSON.stringify({ type: 'version-upload', version_id: STAGING_VERSION })
    expect(readUploadReceipt(line, 'w')).toBe(STAGING_VERSION)
    expect(() => readUploadReceipt('', 'w')).toThrow(/no version-upload/u)
    expect(() =>
      readUploadReceipt(JSON.stringify({ type: 'version-upload', version_id: 'x' }), 'w'),
    ).toThrow(/no valid version id/u)
  })
})

describe('writeStagingStepOutputs', () => {
  it('writes the outcome and the production gate for the workflow', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'narduk-staging-out-')), 'out')
    writeFileSync(file, '')
    writeStagingStepOutputs(
      {
        outcome: 'proven',
        worker: 'w',
        hostname: 'h.example.com',
        sha: SHA,
        versionId: STAGING_VERSION,
        previousVersionId: null,
        approval: 'environment',
        environment: 'production',
        config: null,
        detail: '',
        exitCode: 0,
      },
      { GITHUB_OUTPUT: file },
    )
    expect(readFileSync(file, 'utf8')).toContain('approval=environment\nenvironment=production')
  })
})

describe('checkStagingServesSha', () => {
  it('passes only when staging serves a version tagged with this commit', async () => {
    const ok = client([deployment(STAGING_VERSION)], [tagged(STAGING_VERSION, SHA)])
    expect(await checkStagingServesSha(SHA, 's', ok.client)).toBeNull()
    const other = client([deployment(STAGING_VERSION)], [tagged(STAGING_VERSION, OTHER)])
    expect(await checkStagingServesSha(SHA, 's', other.client)).toMatch(/tagged 0000/u)
    const split: WorkerDeployment = {
      id: 'd',
      created_on: '2026-10-15T00:00:00Z',
      versions: [
        { version_id: 'a', percentage: 50 },
        { version_id: 'b', percentage: 50 },
      ],
    }
    expect(await checkStagingServesSha(SHA, 's', client([split]).client)).toMatch(
      /no single version/u,
    )
  })
})

describe('versions-promote with staging enabled', () => {
  const PROD_VERSION = 'prod-version'
  function promoteContext(stagingVersions: WorkerVersion[]) {
    const production = client([deployment('prod-old')], [tagged(PROD_VERSION, SHA)])
    const staging = client([deployment(STAGING_VERSION)], stagingVersions)
    return {
      production,
      context: {
        client: production.client,
        stagingClient: staging.client,
        staging: () => ({ workerName: 'harmony-hot-sauce-staging', accountId: ACCOUNT }),
        env: { ...ACTIONS_ENV, GITHUB_EVENT_NAME: 'workflow_run' },
        resolveWorkerName: () => 'harmony-hot-sauce',
        appDir: '/tmp/app',
        log: () => {},
        ancestry: () => ({ kind: 'unknown', detail: 'test' }) as never,
        containment: () => ({ kind: 'contained' }) as never,
      },
    }
  }

  it('refuses production (exit 11) while staging does not serve the commit', async () => {
    const { production, context } = promoteContext([tagged(STAGING_VERSION, OTHER)])
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--no-gate-attestation', 'test', '--force']),
      context,
    )
    expect(result.outcome).toBe('staging-not-proven')
    expect(result.exitCode).toBe(PROMOTE_EXIT.stagingNotProven)
    expect(production.deployed).toEqual([])
  })

  it('promotes production once staging serves the same commit', async () => {
    const { production, context } = promoteContext([tagged(STAGING_VERSION, SHA)])
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--no-gate-attestation', 'test', '--force']),
      context,
    )
    expect(result.outcome).toBe('promoted')
    expect(production.deployed).toEqual([{ id: PROD_VERSION, percentage: 100 }])
  })

  it('leaves the production dry run alone, which runs before the staging stage', async () => {
    const { context } = promoteContext([tagged(STAGING_VERSION, OTHER)])
    const result = await runVersionsPromote(
      parseVersionsPromoteArgs(['--sha', SHA, '--no-gate-attestation', 'test', '--dry-run']),
      context,
    )
    expect(result.outcome).toBe('dry-run')
  })
})
