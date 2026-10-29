import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import {
  CONFORMANT_REALITY,
  itemStatus,
  makeTempRepo,
  subCheckStatus,
  writeConformantBaseline,
  writeCoolifyOnlyApp,
  writeFile,
  writeJson,
} from './helpers.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

async function run(root: string) {
  return runFoundationCheck({
    root,
    toolVersion: '0.0.0-test',
    reality: CONFORMANT_REALITY,
    appOverrides: { repo: 'x/y', commit: 'a'.repeat(40) },
  })
}

function sub12(artefact: Awaited<ReturnType<typeof run>>) {
  const found = artefact.items.flatMap((item) => item.checks).find((check) => check.id === '1.2')
  if (!found) throw new Error('no sub-check 1.2 in artefact')
  return found
}

describe('item 1 -- scaffold parity', () => {
  it('1.1 passes on the declared preset, and fails when the seeded lie changes it', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '1.1')).toBe('pass')

    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'node-server' },
      access: { exposureClass: 'public' },
      bindings: { r2: [] },
    })
    expect(subCheckStatus(await run(root), '1.1')).toBe('fail')
  })

  it('1.1 resolves the preset for real from nuxt.config when Config/cloudflare-app.json is absent', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/Config/cloudflare-app.json`, { force: true })
    writeFile(
      root,
      'nuxt.config.ts',
      'export default defineNuxtConfig({ nitro: { preset: "cloudflare_module" } })',
    )
    expect(subCheckStatus(await run(root), '1.1')).toBe('pass')

    writeFile(
      root,
      'nuxt.config.ts',
      'export default defineNuxtConfig({ nitro: { preset: "node-server" } })',
    )
    expect(subCheckStatus(await run(root), '1.1')).toBe('fail')

    rmSync(`${root}/nuxt.config.ts`, { force: true })
    expect(subCheckStatus(await run(root), '1.1')).toBe('unknown')
  })

  it('1.1 accepts the hyphenated spelling a completed build writes (narduk-libs#350)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/Config/cloudflare-app.json`, { force: true })
    // What Nitro itself writes after `nuxt build --preset=cloudflare_module`:
    // the canonical name is hyphenated, and `.output/nitro.json` is the
    // strongest of the three live-build signals, so it decides 1.1.
    writeJson(root, 'apps/web/.output/nitro.json', { preset: 'cloudflare-module' })
    expect(subCheckStatus(await run(root), '1.1')).toBe('pass')

    // The separator is the only thing normalized -- a genuinely different
    // preset in the same file still fails.
    writeJson(root, 'apps/web/.output/nitro.json', { preset: 'cloudflare-pages' })
    expect(subCheckStatus(await run(root), '1.1')).toBe('fail')
  })

  it('1.1 accepts either spelling declared in Config/cloudflare-app.json', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare-module' },
      access: { exposureClass: 'public' },
      bindings: { r2: [] },
    })
    expect(subCheckStatus(await run(root), '1.1')).toBe('pass')
  })

  it('1.2 fails when a declared binding is not mirrored, and passes once it is', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'wrangler.json', { d1_databases: [{ binding: 'DB', database_name: 'x' }] })
    expect(subCheckStatus(await run(root), '1.2')).toBe('fail')

    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      access: { exposureClass: 'public' },
      bindings: { r2: [], d1: [{ binding: 'DB' }] },
    })
    expect(subCheckStatus(await run(root), '1.2')).toBe('pass')
  })

  it('1.2 reads bindings from a real wrangler.toml (not JSON-only)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/wrangler.json`, { force: true })
    writeFile(root, 'wrangler.toml', '[[d1_databases]]\nbinding = "DB"\ndatabase_name = "x"\n')
    // cloudflare-app.json does not mirror DB yet -> fail
    expect(subCheckStatus(await run(root), '1.2')).toBe('fail')

    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      access: { exposureClass: 'public' },
      bindings: { r2: [], d1: [{ binding: 'DB' }] },
    })
    expect(subCheckStatus(await run(root), '1.2')).toBe('pass')
  })

  it("1.2 judges a hybrid repo against the web app's own wrangler config (narduk-libs#1967)", async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    // Hybrid layout: a data-plane Worker at the repo root, the Nuxt app in web/.
    rmSync(`${root}/wrangler.json`, { force: true })
    rmSync(`${root}/nuxt.config.ts`, { force: true })
    writeJson(root, 'wrangler.jsonc', {
      d1_databases: [{ binding: 'DB', database_name: 'x' }],
      vars: { STATIONMAP_URL: 'https://example.test' },
    })
    writeFile(root, 'web/nuxt.config.ts', 'export default defineNuxtConfig({})')
    writeJson(root, 'web/wrangler.jsonc', {
      services: [{ binding: 'HYDROGEN_API', service: 'hydrogen' }],
    })
    const manifest = (extra: Record<string, unknown>) => ({
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      access: { exposureClass: 'public' },
      bindings: { r2: [], ...extra },
    })

    // The manifest declares only the web Worker's binding: pass, and the root
    // Worker's DB / STATIONMAP_URL are not demanded of it.
    writeJson(
      root,
      'Config/cloudflare-app.json',
      manifest({ services: [{ binding: 'HYDROGEN_API' }] }),
    )
    const passing = sub12(await run(root))
    expect(passing.status).toBe('pass')
    expect(passing.evidence).toBe('web/wrangler.jsonc')

    // A web binding the manifest does not mirror still fails, naming web/.
    writeJson(root, 'Config/cloudflare-app.json', manifest({}))
    const failing = sub12(await run(root))
    expect(failing.status).toBe('fail')
    expect(failing.detail).toContain('web/wrangler.jsonc')
    expect(failing.detail).toContain('HYDROGEN_API')
    expect(failing.detail).not.toContain('STATIONMAP_URL')
  })

  it('1.2 reads the wrangler config the manifest declares in worker.wranglerConfig', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    // Monorepo layout: the app's Worker lives outside every known candidate path.
    rmSync(`${root}/wrangler.json`, { force: true })
    writeJson(root, 'apps/facility/wrangler.jsonc', {
      kv_namespaces: [{ binding: 'CACHE', id: 'x' }],
    })
    const manifest = (wranglerConfig: string, extra: Record<string, unknown>) => ({
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module', wranglerConfig },
      access: { exposureClass: 'public' },
      bindings: { r2: [], ...extra },
    })

    writeJson(
      root,
      'Config/cloudflare-app.json',
      manifest('apps/facility/wrangler.jsonc', { kv: ['CACHE'] }),
    )
    const passing = sub12(await run(root))
    expect(passing.status).toBe('pass')
    expect(passing.evidence).toBe('apps/facility/wrangler.jsonc')

    // The declared config beats a root candidate, so its unmirrored binding fails.
    writeJson(root, 'wrangler.json', {})
    writeJson(root, 'Config/cloudflare-app.json', manifest('./apps/facility/wrangler.jsonc', {}))
    const failing = sub12(await run(root))
    expect(failing.status).toBe('fail')
    expect(failing.detail).toContain('CACHE')
    rmSync(`${root}/wrangler.json`, { force: true })

    // A path that escapes the checkout, or names no file, is ignored: the root
    // candidate decides.
    writeJson(root, 'wrangler.json', {})
    for (const declared of [
      '../apps/facility/wrangler.jsonc',
      `${root}/apps/facility/wrangler.jsonc`,
      'apps/gone/wrangler.jsonc',
    ]) {
      writeJson(root, 'Config/cloudflare-app.json', manifest(declared, {}))
      const fallback = sub12(await run(root))
      expect(fallback.status).toBe('not-applicable')
      expect(fallback.evidence).toBe('wrangler.json')
    }
  })

  it('1.2 falls back to the root wrangler config when the web app has none of its own', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    rmSync(`${root}/nuxt.config.ts`, { force: true })
    writeFile(root, 'web/nuxt.config.ts', 'export default defineNuxtConfig({})')
    writeJson(root, 'wrangler.json', { d1_databases: [{ binding: 'DB', database_name: 'x' }] })
    expect(subCheckStatus(await run(root), '1.2')).toBe('fail')
  })

  it('1.3 fails without manifests:validate, passes with it', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'package.json', { name: 'fixture-app', scripts: {} })
    expect(subCheckStatus(await run(root), '1.3')).toBe('fail')

    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '1.3')).toBe('pass')
  })

  it('1.4 applies only to authenticated-public apps, and fails when hardening is missing', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    // public, not authenticated -> not-applicable regardless of the flags
    expect(subCheckStatus(await run(root), '1.4')).toBe('not-applicable')

    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      access: { exposureClass: 'authenticated-public' },
      bindings: { r2: [] },
    })
    // wrangler.json still sets workers_dev/preview_urls true -> fail now that it applies
    expect(subCheckStatus(await run(root), '1.4')).toBe('fail')

    writeJson(root, 'wrangler.json', { workers_dev: false, preview_urls: false })
    expect(subCheckStatus(await run(root), '1.4')).toBe('pass')
  })

  it('1.1/1.2/1.4/1.5 are not-applicable for a Coolify-only app (narduk-libs#158)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeCoolifyOnlyApp(root)
    const artefact = await run(root)
    expect(subCheckStatus(artefact, '1.1')).toBe('not-applicable')
    expect(subCheckStatus(artefact, '1.2')).toBe('not-applicable')
    expect(subCheckStatus(artefact, '1.3')).toBe('pass')
    expect(subCheckStatus(artefact, '1.4')).toBe('not-applicable')
    expect(subCheckStatus(artefact, '1.5')).toBe('not-applicable')
    expect(itemStatus(artefact, 1)).toBe('pass')
  })

  it('1.5 is not-applicable for a Coolify-only app with a leftover placeholder D1 binding', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeCoolifyOnlyApp(root)
    writeJson(root, 'wrangler.json', {
      d1_databases: [
        {
          binding: 'DB',
          database_name: 'fixture-app-db',
          database_id: '00000000-0000-0000-0000-000000000000',
        },
      ],
    })
    const artefact = await run(root)
    expect(subCheckStatus(artefact, '1.5')).toBe('not-applicable')
    expect(itemStatus(artefact, 1)).toBe('pass')
  })

  it('1.1 still fails node-server when lifecycle also names cloudflare', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeCoolifyOnlyApp(root)
    writeJson(root, 'Config/project-lifecycle.json', {
      schemaVersion: 1,
      environments: [
        {
          name: 'production',
          deploymentTargets: [{ provider: 'coolify' }, { provider: 'cloudflare' }],
        },
      ],
    })
    expect(subCheckStatus(await run(root), '1.1')).toBe('fail')
  })

  it('1.1 is not-applicable for a Worker that declares nitroPreset none', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'wrangler.json', { d1_databases: [{ binding: 'DB', database_name: 'x' }] })
    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'none' },
      access: { exposureClass: 'public' },
      bindings: { r2: [], d1: [{ binding: 'DB' }] },
    })
    const artefact = await run(root)
    expect(subCheckStatus(artefact, '1.1')).toBe('not-applicable')
    expect(subCheckStatus(artefact, '1.2')).toBe('pass')
  })
})
