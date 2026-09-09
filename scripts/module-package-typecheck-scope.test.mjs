import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { loadWorkspace } from './compute-affected-packages.mjs'

/**
 * narduk-libs#176: a `packages/modules/*` package that runs `nuxt typecheck`,
 * ships no `app/` tree and declares no explicit `srcDir` keeps the package root
 * as srcDir, so Nuxt generates `include: ['../**\/*']` in
 * `.nuxt/tsconfig.json`. That include is what puts `src/module.ts` into a
 * project for typed linting, but it also drags `eslint.config.mjs` and the
 * untyped `.mjs` sources of `@narduk-enterprises/eslint-config` into the
 * typecheck — 36 unrelated errors on `narduk-tenancy`, 2026-09-09.
 *
 * The exclusion now lives once in
 * `@narduk-enterprises/narduk-core/nuxt-module-package-config`. This test fails
 * if a server-only module package stops using it, so the next one
 * (narduk-realtime, narduk-devices) does not rediscover the failure.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const fragmentSubpath = '@narduk-enterprises/narduk-core/nuxt-module-package-config'
const coreDirectory = join(repoRoot, 'packages/modules/narduk-core')

test('narduk-core publishes the shared server-only module typescript fragment', async () => {
  const manifest = JSON.parse(readFileSync(join(coreDirectory, 'package.json'), 'utf8'))
  const entry = manifest.exports['./nuxt-module-package-config']
  assert.deepEqual(entry, {
    types: './src/nuxt-module-package-config.ts',
    import: './src/nuxt-module-package-config.ts',
  })
  // `src/` is already published and is inside narduk-core's tsconfig project
  // (tsconfig.layer-tooling.json `include`), which a package-root file is not.
  assert.ok(manifest.files.includes('src/'), 'the fragment must be in the published files list')

  const { modulePackageTypeScript, modulePackageTsConfigExclude } = await import(
    join(coreDirectory, 'src/nuxt-module-package-config.ts')
  )
  assert.deepEqual([...modulePackageTsConfigExclude], ['../eslint.config.mjs'])
  assert.deepEqual(modulePackageTypeScript(), {
    tsConfig: { exclude: ['../eslint.config.mjs'] },
  })
  assert.deepEqual(modulePackageTypeScript({ exclude: ['../vitest.config.ts'] }), {
    tsConfig: { exclude: ['../eslint.config.mjs', '../vitest.config.ts'] },
  })
})

test('every server-only module package scopes nuxt typecheck through the shared fragment', () => {
  const modulePackages = loadWorkspace(repoRoot).packages.filter(({ relativeDirectory }) =>
    relativeDirectory.startsWith('packages/modules/'),
  )
  assert.ok(modulePackages.length > 0, 'expected module packages in the workspace')

  const serverOnly = []
  for (const workspacePackage of modulePackages) {
    const typecheck = workspacePackage.manifest.scripts?.typecheck ?? ''
    if (!/\bnuxt typecheck\b/u.test(typecheck)) continue
    if (existsSync(join(workspacePackage.directory, 'app'))) continue

    const configPath = join(workspacePackage.directory, 'nuxt.config.ts')
    assert.ok(
      existsSync(configPath),
      `${workspacePackage.name} runs nuxt typecheck without a config`,
    )
    const config = readFileSync(configPath, 'utf8')
    // An explicit srcDir keeps the generated include away from the package
    // root, so those packages are not affected by #176.
    if (/\bsrcDir\s*:/u.test(config)) continue

    serverOnly.push(workspacePackage.name)
    assert.ok(
      config.includes(fragmentSubpath) && config.includes('modulePackageTypeScript('),
      `${workspacePackage.name} must take its typescript.tsConfig.exclude from ${fragmentSubpath}`,
    )
  }

  assert.ok(
    serverOnly.includes('@narduk-enterprises/narduk-tenancy'),
    'narduk-tenancy is the reference server-only module package for #176',
  )
})
