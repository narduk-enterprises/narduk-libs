import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import {
  CONFORMANT_REALITY,
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

describe('item 3 -- capability packages', () => {
  it('3.1/3.2 are unknown with no exposureClass recorded', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      bindings: { r2: [] },
    })
    const artefact = await run(root)
    expect(subCheckStatus(artefact, '3.1')).toBe('unknown')
    expect(subCheckStatus(artefact, '3.2')).toBe('unknown')
  })

  it('3.1 fails a public site missing narduk-seo/narduk-analytics, passes with both', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'package.json', {
      name: 'x',
      scripts: { 'manifests:validate': 'true' },
      dependencies: {
        '@narduk-enterprises/narduk-core': '3.4.1',
        '@narduk-enterprises/narduk-testkit': '2.0.0',
        '@narduk-enterprises/narduk-app-tools': '0.1.3',
        '@narduk-enterprises/eslint-config': '2.0.0',
      },
    })
    expect(subCheckStatus(await run(root), '3.1')).toBe('fail')

    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '3.1')).toBe('pass')
  })

  it('3.2 fails an authenticated app missing narduk-auth, passes with it', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      access: { exposureClass: 'authenticated-public' },
      bindings: { r2: [] },
    })
    expect(subCheckStatus(await run(root), '3.2')).toBe('fail')

    writeJson(root, 'package.json', {
      name: 'x',
      scripts: { 'manifests:validate': 'true' },
      dependencies: {
        '@narduk-enterprises/narduk-core': '3.4.1',
        '@narduk-enterprises/narduk-testkit': '2.0.0',
        '@narduk-enterprises/narduk-app-tools': '0.1.3',
        '@narduk-enterprises/eslint-config': '2.0.0',
        '@narduk-enterprises/narduk-auth': '1.0.0',
      },
    })
    expect(subCheckStatus(await run(root), '3.2')).toBe('pass')
  })

  it('3.1/3.2 treat customer-authenticated as a login app, not a public site (narduk-libs#1212)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      access: { exposureClass: 'customer-authenticated' },
      bindings: { r2: [] },
    })
    const artefact = await run(root)
    expect(subCheckStatus(artefact, '3.1')).toBe('not-applicable')
    expect(subCheckStatus(artefact, '3.2')).toBe('fail')
  })

  it('3.3 fails an R2-writing app missing narduk-uploads, passes with it', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      access: { exposureClass: 'public' },
      bindings: { r2: [{ binding: 'ASSETS' }] },
    })
    expect(subCheckStatus(await run(root), '3.3')).toBe('fail')

    writeJson(root, 'package.json', {
      name: 'x',
      scripts: { 'manifests:validate': 'true' },
      dependencies: {
        '@narduk-enterprises/narduk-core': '3.4.1',
        '@narduk-enterprises/narduk-testkit': '2.0.0',
        '@narduk-enterprises/narduk-app-tools': '0.1.3',
        '@narduk-enterprises/eslint-config': '2.0.0',
        '@narduk-enterprises/narduk-seo': '1.0.0',
        '@narduk-enterprises/narduk-analytics': '1.0.0',
        '@narduk-enterprises/narduk-uploads': '1.0.0',
      },
    })
    expect(subCheckStatus(await run(root), '3.3')).toBe('pass')
  })

  describe('3.3 R2 bucket roles (narduk-libs#1285)', () => {
    function appWithR2(r2: unknown[]): string {
      const root = makeTempRepo()
      tempDirs.push(root)
      writeConformantBaseline(root)
      writeJson(root, 'Config/cloudflare-app.json', {
        product: { name: 'Fixture App', repository: 'narduk-enterprises/fixture-app' },
        worker: { nitroPreset: 'cloudflare_module' },
        access: { exposureClass: 'public' },
        bindings: { r2 },
      })
      return root
    }
    function sub33(artefact: Awaited<ReturnType<typeof run>>) {
      for (const item of artefact.items) {
        const sub = item.checks.find((c) => c.id === '3.3')
        if (sub) return sub
      }
      throw new Error('no 3.3')
    }

    it('is not-applicable when every bucket is app-data or read-only-assets', async () => {
      const root = appWithR2([
        { binding: 'TIMELINES', bucketName: 'music-timelines', role: 'app-data' },
        { binding: 'IMAGES', bucketName: 'images', role: 'read-only-assets' },
      ])
      const sub = sub33(await run(root))
      expect(sub.status).toBe('not-applicable')
      expect(sub.detail).toContain('TIMELINES: app-data')
      expect(sub.detail).toContain('IMAGES: read-only-assets')
    })

    it('fails a bucket with no role and no narduk-uploads (the default is uploads)', async () => {
      const root = appWithR2([{ binding: 'ASSETS', bucketName: 'assets' }])
      const sub = sub33(await run(root))
      expect(sub.status).toBe('fail')
      expect(sub.detail).toContain('ASSETS')
    })

    it('fails an explicit uploads bucket without narduk-uploads', async () => {
      const root = appWithR2([{ binding: 'BUCKET', bucketName: 'b', role: 'uploads' }])
      expect(subCheckStatus(await run(root), '3.3')).toBe('fail')
    })

    it('fails mixed roles when one is uploads and the package is missing', async () => {
      const root = appWithR2([
        { binding: 'TIMELINES', bucketName: 't', role: 'app-data' },
        { binding: 'BUCKET', bucketName: 'b', role: 'uploads' },
      ])
      const sub = sub33(await run(root))
      expect(sub.status).toBe('fail')
      expect(sub.detail).toContain('BUCKET')
      expect(sub.detail).not.toContain('TIMELINES')
    })

    it('treats an unrecognised role as uploads so a typo cannot turn 3.3 off', async () => {
      const root = appWithR2([{ binding: 'TIMELINES', bucketName: 't', role: 'timelines' }])
      expect(subCheckStatus(await run(root), '3.3')).toBe('fail')
    })

    it('passes mixed roles once narduk-uploads is a dependency', async () => {
      const root = appWithR2([
        { binding: 'TIMELINES', bucketName: 't', role: 'app-data' },
        { binding: 'BUCKET', bucketName: 'b' },
      ])
      writeJson(root, 'package.json', {
        name: 'x',
        scripts: { 'manifests:validate': 'true' },
        dependencies: {
          '@narduk-enterprises/narduk-core': '3.4.1',
          '@narduk-enterprises/narduk-testkit': '2.0.0',
          '@narduk-enterprises/narduk-app-tools': '0.1.3',
          '@narduk-enterprises/eslint-config': '2.0.0',
          '@narduk-enterprises/narduk-seo': '1.0.0',
          '@narduk-enterprises/narduk-analytics': '1.0.0',
          '@narduk-enterprises/narduk-uploads': '1.0.0',
        },
      })
      expect(subCheckStatus(await run(root), '3.3')).toBe('pass')
    })

    it('fails a read-only-assets bucket that server code writes or deletes', async () => {
      for (const call of ['IMAGES.put(key, body)', 'env.IMAGES?.delete(key)']) {
        const root = appWithR2([
          { binding: 'IMAGES', bucketName: 'images', role: 'read-only-assets' },
        ])
        writeFile(root, 'server/routes/images/[...slug].get.ts', `await ${call}\n`)
        const sub = sub33(await run(root))
        expect(sub.status).toBe('fail')
        expect(sub.detail).toContain('server/routes/images/[...slug].get.ts')
      }
    })

    it('leaves a read-only-assets bucket that server code only reads not-applicable', async () => {
      const root = appWithR2([
        { binding: 'IMAGES', bucketName: 'images', role: 'read-only-assets' },
      ])
      writeFile(root, 'server/routes/images/[...slug].get.ts', 'await IMAGES.get(slug)\n')
      expect(subCheckStatus(await run(root), '3.3')).toBe('not-applicable')
    })

    it('keeps the wrangler fallback (no manifest r2 entries) failing as uploads', async () => {
      const root = appWithR2([])
      writeFile(
        root,
        'wrangler.json',
        '{"name":"x","r2_buckets":[{"binding":"BUCKET","bucket_name":"b"}]}',
      )
      expect(subCheckStatus(await run(root), '3.3')).toBe('fail')
    })
  })

  it.each([
    ['Fixture App', { name: 'fixture-app' }],
    ['Riverstatus', { name: 'riverstatus' }],
    ['BuoyStat.us', { name: 'buoys' }],
    ['Fixture App', { name: 'fixture-app', scripts: { status: 'git status' } }],
    ['Riverstatus', { dependencies: { '@narduk-enterprises/status-runtime': '1.0.2' } }],
  ])('3.4 stays retired for %s and manifest %j', async (productName, manifest) => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: productName, repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      access: { exposureClass: 'public' },
      bindings: { r2: [] },
    })
    writeJson(root, 'package.json', manifest)
    const artefact = await run(root)
    expect(subCheckStatus(artefact, '3.4')).toBe('not-applicable')
    // Retiring the category must not exempt the app from its public-site rule.
    expect(subCheckStatus(artefact, '3.1')).toBe('fail')
    expect(artefact.items).toHaveLength(7)
  })

  it('3.5 fails a @narduk-geo scoped chart/map dependency outright', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'package.json', {
      name: 'x',
      scripts: { 'manifests:validate': 'true' },
      dependencies: {
        '@narduk-enterprises/narduk-core': '3.4.1',
        '@narduk-enterprises/narduk-testkit': '2.0.0',
        '@narduk-enterprises/narduk-app-tools': '0.1.3',
        '@narduk-enterprises/eslint-config': '2.0.0',
        '@narduk-enterprises/narduk-seo': '1.0.0',
        '@narduk-enterprises/narduk-analytics': '1.0.0',
        '@narduk-geo/narduk-mapkit': '1.0.0',
      },
    })
    expect(subCheckStatus(await run(root), '3.5')).toBe('fail')
  })

  it('3.1/3.2 read exposureClass from Config/coolify-app.json (narduk-libs#158)', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeCoolifyOnlyApp(root)
    const artefact = await run(root)
    expect(subCheckStatus(artefact, '3.1')).toBe('pass')
    expect(subCheckStatus(artefact, '3.2')).toBe('not-applicable')
  })

  it('3.5 fails a direct chart-library import with no owning package, passes not-applicable with neither', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '3.5')).toBe('not-applicable')

    writeFile(root, 'app/components/Map.vue', "<script setup>\nimport 'maplibre-gl'\n</script>")
    expect(subCheckStatus(await run(root), '3.5')).toBe('fail')
  })

  it('3.5 passes a maplibre-gl import when narduk-maps owns the map', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    writeJson(root, 'package.json', {
      name: 'x',
      scripts: { 'manifests:validate': 'true' },
      dependencies: {
        '@narduk-enterprises/narduk-core': '3.4.1',
        '@narduk-enterprises/narduk-testkit': '2.0.0',
        '@narduk-enterprises/narduk-app-tools': '0.1.3',
        '@narduk-enterprises/eslint-config': '2.0.0',
        '@narduk-enterprises/narduk-seo': '1.0.0',
        '@narduk-enterprises/narduk-analytics': '1.0.0',
        '@narduk-enterprises/narduk-maps': '0.2.1',
        'maplibre-gl': '6.0.0',
      },
    })
    writeFile(root, 'app/components/Map.vue', "<script setup>\nimport 'maplibre-gl'\n</script>")
    expect(subCheckStatus(await run(root), '3.5')).toBe('pass')
  })
})
