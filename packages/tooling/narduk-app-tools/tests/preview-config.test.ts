import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  findCloudflareAppConfig,
  selectDeployConfig,
  writeFlattenedWranglerDeployConfig,
} from '../src/deploy.js'
import { defaultDeploymentBlock } from '../src/deployment-config.js'
import { planPreviewConfig, PREVIEW_CONFIG_FILENAME } from '../src/preview-config.js'

const PROD_KV = 'b591b4b6ea1a4684900df2e24b19f551'
const PROD_OG = '03f10f45af19485286d57a095729932c'
const PREV_KV = '11111111111111111111111111111111'
const PREV_OG = '22222222222222222222222222222222'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

function twoKv(): Record<string, unknown> {
  return {
    name: 'buoys',
    kv_namespaces: [
      { binding: 'KV', id: PROD_KV },
      { binding: 'OG_IMAGE_CACHE', id: PROD_OG },
    ],
  }
}

const none = { d1: [], kv: [], r2: [] }

describe('planPreviewConfig', () => {
  it('rebinds every KV binding to its preview namespace', () => {
    const plan = planPreviewConfig(twoKv(), {
      ...none,
      kv: [
        { binding: 'KV', id: PREV_KV },
        { binding: 'OG_IMAGE_CACHE', id: PREV_OG },
      ],
    })
    expect(plan.status).toBe('ready')
    expect(plan.config?.kv_namespaces).toEqual([
      { binding: 'KV', id: PREV_KV },
      { binding: 'OG_IMAGE_CACHE', id: PREV_OG },
    ])
    expect(plan.rebound).toEqual([`kv:KV -> ${PREV_KV}`, `kv:OG_IMAGE_CACHE -> ${PREV_OG}`])
  })

  it('does not mutate the production config it was given', () => {
    const production = twoKv()
    planPreviewConfig(production, {
      ...none,
      kv: [
        { binding: 'KV', id: PREV_KV },
        { binding: 'OG_IMAGE_CACHE', id: PREV_OG },
      ],
    })
    expect(production).toEqual(twoKv())
  })

  it('rebinds D1 by id and name, and R2 by bucket, keeping every other field', () => {
    const plan = planPreviewConfig(
      {
        d1_databases: [
          { binding: 'DB', database_name: 'app', database_id: 'prod-id', migrations_dir: 'm' },
        ],
        r2_buckets: [{ binding: 'UPLOADS', bucket_name: 'app-uploads' }],
      },
      {
        d1: [{ binding: 'DB', database_id: 'preview-id', database_name: 'app-preview' }],
        kv: [],
        r2: [{ binding: 'UPLOADS', bucket_name: 'app-uploads-preview' }],
      },
    )
    expect(plan.status).toBe('ready')
    expect(plan.config?.d1_databases).toEqual([
      {
        binding: 'DB',
        database_name: 'app-preview',
        database_id: 'preview-id',
        migrations_dir: 'm',
      },
    ])
    expect(plan.config?.r2_buckets).toEqual([
      { binding: 'UPLOADS', bucket_name: 'app-uploads-preview' },
    ])
  })

  it('is declared-only when an entry is a bare name, and rebinds nothing at all', () => {
    const plan = planPreviewConfig(twoKv(), {
      ...none,
      kv: [{ binding: 'KV', id: PREV_KV }, 'OG_IMAGE_CACHE'],
    })
    expect(plan.status).toBe('declared-only')
    expect(plan.declaredOnly).toEqual(['kv:OG_IMAGE_CACHE'])
    expect(plan.config).toBeNull()
  })

  it('needs the D1 name as well as the id', () => {
    const plan = planPreviewConfig(
      { d1_databases: [{ binding: 'DB', database_name: 'app', database_id: 'prod-id' }] },
      { d1: [{ binding: 'DB', database_id: 'preview-id' }], kv: [], r2: [] },
    )
    expect(plan.status).toBe('declared-only')
  })

  it('is uncovered when a binding has no entry', () => {
    const plan = planPreviewConfig(twoKv(), { ...none, kv: [{ binding: 'KV', id: PREV_KV }] })
    expect(plan.status).toBe('uncovered')
    expect(plan.uncovered).toEqual(['kv:OG_IMAGE_CACHE'])
  })

  it('refuses a preview id that is its own production id', () => {
    const plan = planPreviewConfig(twoKv(), {
      ...none,
      kv: [
        { binding: 'KV', id: PROD_KV },
        { binding: 'OG_IMAGE_CACHE', id: PREV_OG },
      ],
    })
    expect(plan.status).toBe('unsafe')
    expect(plan.reused).toEqual([`kv:KV id=${PROD_KV}`])
    expect(plan.config).toBeNull()
  })

  it("refuses a preview id that is another binding's production id", () => {
    const plan = planPreviewConfig(twoKv(), {
      ...none,
      kv: [
        { binding: 'KV', id: PROD_OG },
        { binding: 'OG_IMAGE_CACHE', id: PREV_OG },
      ],
    })
    expect(plan.status).toBe('unsafe')
  })

  it('counts a production id declared only under an env scope of the source config', () => {
    const source = {
      ...twoKv(),
      env: { production: { kv_namespaces: [{ binding: 'X', id: PREV_KV }] } },
    }
    const plan = planPreviewConfig(
      twoKv(),
      {
        ...none,
        kv: [
          { binding: 'KV', id: PREV_KV },
          { binding: 'OG_IMAGE_CACHE', id: PREV_OG },
        ],
      },
      [source],
    )
    expect(plan.status).toBe('unsafe')
  })

  it('has nothing to do for a config with no D1, KV or R2', () => {
    expect(planPreviewConfig({ name: 'x' }, none).status).toBe('no-bindings')
  })
})

/** A repository shaped like Buoys: declaration at the root, app in apps/web. */
function repo(options: { previewBindings?: unknown; deployment?: Record<string, unknown> | null }) {
  const root = mkdtempSync(join(tmpdir(), 'narduk-preview-config-'))
  tempDirs.push(root)
  mkdirSync(join(root, '.git'))
  const appDir = join(root, 'apps', 'web')
  const write = (rel: string, value: unknown) => {
    const path = join(root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  }
  write('apps/web/wrangler.json', twoKv())
  const deployment =
    options.deployment === undefined
      ? {
          ...defaultDeploymentBlock({ appSlug: 'buoys' }),
          nonProductionBranchBuilds: true,
          previewBindings: options.previewBindings ?? {
            ...none,
            kv: [
              { binding: 'KV', id: PREV_KV },
              { binding: 'OG_IMAGE_CACHE', id: PREV_OG },
            ],
          },
        }
      : options.deployment
  write('Config/cloudflare-app.json', deployment === null ? {} : { deployment })
  const sourceConfigPath = join(appDir, 'wrangler.json')
  const productionConfigPath = writeFlattenedWranglerDeployConfig(sourceConfigPath)
  return { root, appDir, sourceConfigPath, productionConfigPath }
}

function select(
  fixture: ReturnType<typeof repo>,
  env: Record<string, string | undefined>,
  action: 'deploy' | 'versions-upload' = 'versions-upload',
  passthroughArgs: string[] = [],
) {
  const log: string[] = []
  const path = selectDeployConfig({
    action,
    appDir: fixture.appDir,
    sourceConfigPath: fixture.sourceConfigPath,
    productionConfigPath: fixture.productionConfigPath,
    passthroughArgs,
    env,
    log: (line) => log.push(line),
  })
  return { path, log: log.join('\n') }
}

function kvIdsIn(path: string): string[] {
  const config = JSON.parse(readFileSync(path, 'utf8')) as { kv_namespaces: Array<{ id: string }> }
  return config.kv_namespaces.map((entry) => entry.id)
}

describe('versions-upload on a non-production branch', () => {
  it('uploads with the generated preview config, and points the redirect at it', () => {
    const fixture = repo({})
    const { path, log } = select(fixture, { WORKERS_CI_BRANCH: 'codex/feature' })
    expect(path).toBe(join(fixture.appDir, PREVIEW_CONFIG_FILENAME))
    expect(kvIdsIn(path)).toEqual([PREV_KV, PREV_OG])
    const redirect = JSON.parse(
      readFileSync(join(fixture.appDir, '.wrangler', 'deploy', 'config.json'), 'utf8'),
    ) as { configPath: string }
    expect(redirect.configPath).toBe(`../../${PREVIEW_CONFIG_FILENAME}`)
    expect(log).toContain('uploading with .wrangler.deploy.preview.json')
    // The production file is untouched.
    expect(kvIdsIn(fixture.productionConfigPath)).toEqual([PROD_KV, PROD_OG])
  })

  it('keeps the production config on the production branch', () => {
    const fixture = repo({})
    const { path, log } = select(fixture, { WORKERS_CI_BRANCH: 'main' })
    expect(path).toBe(fixture.productionConfigPath)
    expect(existsSync(join(fixture.appDir, PREVIEW_CONFIG_FILENAME))).toBe(false)
    expect(log).toBe('')
  })

  it('never rebinds a deploy, whatever the branch', () => {
    const fixture = repo({})
    const { path } = select(fixture, { WORKERS_CI_BRANCH: 'codex/feature' }, 'deploy')
    expect(path).toBe(fixture.productionConfigPath)
  })

  it('keeps the production config outside a Workers Build', () => {
    const fixture = repo({})
    expect(select(fixture, {}).path).toBe(fixture.productionConfigPath)
  })

  it('keeps the production config for an app that has not adopted the standard', () => {
    const fixture = repo({ deployment: null })
    const { path, log } = select(fixture, { WORKERS_CI_BRANCH: 'codex/feature' })
    expect(path).toBe(fixture.productionConfigPath)
    expect(log).toBe('')
  })

  it('warns and keeps production when an entry is a bare name', () => {
    const fixture = repo({ previewBindings: { ...none, kv: ['KV', 'OG_IMAGE_CACHE'] } })
    const { path, log } = select(fixture, { WORKERS_CI_BRANCH: 'codex/feature' })
    expect(path).toBe(fixture.productionConfigPath)
    expect(log).toContain('WARNING')
    expect(log).toContain('PRODUCTION bindings')
    expect(existsSync(join(fixture.appDir, PREVIEW_CONFIG_FILENAME))).toBe(false)
  })

  it('warns and keeps production when a preview id is a production id', () => {
    const fixture = repo({
      previewBindings: {
        ...none,
        kv: [
          { binding: 'KV', id: PROD_KV },
          { binding: 'OG_IMAGE_CACHE', id: PREV_OG },
        ],
      },
    })
    const { path, log } = select(fixture, { WORKERS_CI_BRANCH: 'codex/feature' })
    expect(path).toBe(fixture.productionConfigPath)
    expect(log).toContain('names a production resource')
  })

  it('warns and keeps production with an explicit --env target', () => {
    const fixture = repo({})
    const { path, log } = select(
      fixture,
      { WORKERS_CI_BRANCH: 'codex/feature' },
      'versions-upload',
      ['--env=preview'],
    )
    expect(path).toBe(fixture.productionConfigPath)
    expect(log).toContain('--env')
  })
})

describe('findCloudflareAppConfig', () => {
  it('climbs from the app directory to the repository root', () => {
    const fixture = repo({})
    expect(findCloudflareAppConfig(fixture.appDir)).toBe(
      join(fixture.root, 'Config', 'cloudflare-app.json'),
    )
  })

  it('stops at the repository root', () => {
    const outer = mkdtempSync(join(tmpdir(), 'narduk-preview-outer-'))
    tempDirs.push(outer)
    mkdirSync(join(outer, 'Config'))
    writeFileSync(join(outer, 'Config', 'cloudflare-app.json'), '{}')
    const inner = join(outer, 'checkout', 'apps', 'web')
    mkdirSync(inner, { recursive: true })
    mkdirSync(join(outer, 'checkout', '.git'))
    expect(findCloudflareAppConfig(inner)).toBeNull()
  })
})
