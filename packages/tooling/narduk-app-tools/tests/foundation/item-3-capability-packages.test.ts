import { rmSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import { runFoundationCheck } from '../../src/foundation/evaluate.js'
import {
  CONFORMANT_REALITY,
  makeTempRepo,
  subCheckStatus,
  writeConformantBaseline,
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

  it('3.4 is not-applicable off a non-status name, and fails/passes a status app on narduk-ui + status-runtime', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '3.4')).toBe('not-applicable')

    writeJson(root, 'Config/cloudflare-app.json', {
      product: { name: 'Riverstatus', repository: 'narduk-enterprises/fixture-app' },
      worker: { nitroPreset: 'cloudflare_module' },
      access: { exposureClass: 'public' },
      bindings: { r2: [] },
    })
    expect(subCheckStatus(await run(root), '3.4')).toBe('fail')

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
        '@narduk-enterprises/narduk-ui': '1.0.0',
        'status-runtime': '1.0.0',
      },
    })
    expect(subCheckStatus(await run(root), '3.4')).toBe('pass')
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

  it('3.5 fails a direct chart-library import with no owning package, passes not-applicable with neither', async () => {
    const root = makeTempRepo()
    tempDirs.push(root)
    writeConformantBaseline(root)
    expect(subCheckStatus(await run(root), '3.5')).toBe('not-applicable')

    writeFile(root, 'app/components/Map.vue', "<script setup>\nimport 'maplibre-gl'\n</script>")
    expect(subCheckStatus(await run(root), '3.5')).toBe('fail')
  })
})
