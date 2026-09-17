import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CATALOG_MODULE_RELATIVE_PATH,
  capabilityIdFor,
  deriveCapabilityCatalog,
  renderCatalogModule,
} from './generate-capability-catalog.mjs'
import { loadWorkspace } from './compute-affected-packages.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('the committed capability catalog matches the workspace it is derived from', async () => {
  const rendered = await renderCatalogModule(deriveCapabilityCatalog(repoRoot))
  const committed = readFileSync(join(repoRoot, CATALOG_MODULE_RELATIVE_PATH), 'utf8')
  assert.equal(
    committed,
    rendered,
    `${CATALOG_MODULE_RELATIVE_PATH} is stale. Run \`node scripts/generate-capability-catalog.mjs\` and commit the result.`,
  )
})

test('the catalog covers every published estate package and no private one', () => {
  const { capabilities, excluded } = deriveCapabilityCatalog(repoRoot)
  const workspace = loadWorkspace(repoRoot)

  const published = workspace.packages
    .filter(({ manifest }) => manifest.name.startsWith('@narduk-enterprises/'))
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ manifest }) => manifest.name)
    .sort()
  assert.deepEqual(
    capabilities.map((capability) => capability.package),
    published,
  )

  const privateNames = workspace.packages
    .filter(({ manifest }) => manifest.name.startsWith('@narduk-enterprises/'))
    .filter(({ manifest }) => manifest.private === true)
    .map(({ manifest }) => manifest.name)
    .sort()
  assert.deepEqual(excluded, privateNames)
  for (const name of privateNames) {
    assert.ok(
      !capabilities.some((capability) => capability.package === name),
      `${name} is private and must not be offered as a capability an app can adopt`,
    )
  }
})

test('the capabilities the compliance standard names are all present', () => {
  // Not the catalog's definition -- it is derived -- but a floor: if one of
  // these disappears, a package was renamed or unpublished and the coverage
  // item's detectors name an owner nothing publishes any more.
  const { capabilities } = deriveCapabilityCatalog(repoRoot)
  const ids = new Set(capabilities.map((capability) => capability.id))
  for (const id of [
    'logging',
    'seo',
    'analytics',
    'ui',
    'shell',
    'platform',
    'core',
    'charts',
    'mapkit',
    'auth',
    'realtime',
    'uploads',
    'testkit',
    'app-tools',
    'eslint-config',
  ]) {
    assert.ok(ids.has(id), `capability ${id} is missing from the derived catalog`)
  }
})

test('capability ids drop the scope and the narduk- prefix', () => {
  assert.equal(capabilityIdFor('@narduk-enterprises/narduk-seo'), 'seo')
  assert.equal(capabilityIdFor('@narduk-enterprises/narduk-mapkit-nuxt'), 'mapkit-nuxt')
  assert.equal(capabilityIdFor('@narduk-enterprises/eslint-config'), 'eslint-config')
  assert.equal(capabilityIdFor('@narduk-enterprises/create-narduk-app'), 'create-narduk-app')
})
