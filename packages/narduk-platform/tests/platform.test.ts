import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ENV_CATALOG, MODULE_IDS } from '../src/env-catalog'
import { patchPackageRegistryNpmrcContent } from '../src/package-registry'
import {
  buildAppEnvContract,
  mergeAppEnvContractDefinitions,
  normalizeAppEnvContractDefinition,
} from '../src/provision-env-contract'
import { getCloudflareWorkersBuildsSettings } from '../src/provision-metadata'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('neutral platform contracts', () => {
  it('does not publish template composition entry points', () => {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
    }

    expect(packageJson.exports).not.toHaveProperty('./layer-bundle-manifest')
    expect(packageJson.exports).not.toHaveProperty('./starter-composition')
    expect(packageJson.exports).toHaveProperty('./onboarding-metadata')
    expect(existsSync(join(packageRoot, 'dist', 'layer-bundle-manifest.js'))).toBe(false)
    expect(existsSync(join(packageRoot, 'dist', 'starter-composition.js'))).toBe(false)
  })

  it('contains only app capability environment entries', () => {
    expect(MODULE_IDS.every((moduleId) => !moduleId.startsWith('command-'))).toBe(true)
    expect(
      ENV_CATALOG.every(
        (entry) =>
          entry.key !== 'CONTROL_PLANE_URL' &&
          !entry.key.startsWith('COMMAND_') &&
          !entry.from.startsWith('command:'),
      ),
    ).toBe(true)
  })

  it('builds an app-owned contract from explicit capabilities', () => {
    const contract = buildAppEnvContract({ capabilities: ['site', 'session'] })

    expect(contract.requirements.map((requirement) => requirement.key)).toEqual([
      'NUXT_PUBLIC_ALLOW_GEOLOCATION',
      'NUXT_SESSION_PASSWORD',
      'SITE_URL',
    ])
    expect(contract.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'SITE_URL',
          managedBy: 'app',
          expectedValueFrom: 'app.url',
        }),
      ]),
    )
  })

  it('rejects retired template-managed contracts and merges app-owned requirements', () => {
    expect(
      normalizeAppEnvContractDefinition({
        version: 1,
        requirements: [{ key: 'SITE_URL', managedBy: 'template' }],
      }),
    ).toBeNull()

    const existing = buildAppEnvContract({ capabilities: ['site'] })
    const required = buildAppEnvContract({ capabilities: ['session'] })
    const merged = mergeAppEnvContractDefinitions({ existing, required })

    expect(merged.requirements.map((requirement) => requirement.key)).toEqual([
      'NUXT_PUBLIC_ALLOW_GEOLOCATION',
      'NUXT_SESSION_PASSWORD',
      'SITE_URL',
    ])
    expect(merged.requirements.every((requirement) => requirement.managedBy === 'app')).toBe(true)
  })

  it('routes both package scopes to GitHub Packages', () => {
    const patched = patchPackageRegistryNpmrcContent(
      [
        '@narduk-geo:registry=https://registry.npmjs.org',
        '@narduk-enterprises:registry=https://old.example.test',
        '',
      ].join('\n'),
    )

    expect(patched).toContain('@narduk-geo:registry=https://npm.pkg.github.com')
    expect(patched).toContain('@narduk-enterprises:registry=https://npm.pkg.github.com')
    expect(patched).not.toContain('@narduk-geo:registry=https://registry.npmjs.org')
  })

  it('advertises the app-owned Workers Builds commands emitted by the generator', () => {
    const settings = getCloudflareWorkersBuildsSettings()

    expect(settings.rootDirectory).toBe('.')
    expect(settings.skipDependencyInstall).toBe(false)
    expect(settings.requiredBuildSecrets).toEqual(['NARDUK_PLATFORM_GH_PACKAGES_READ'])
    expect(settings.requiredRuntimeVariables).toEqual(['SITE_URL'])
    expect(settings.targets.production.buildCommand).toBe('pnpm run cf:build')
    expect(settings.targets.production.deployCommand).toBe('pnpm run cf:deploy')
    expect(settings.targets.production.previewDeployCommand).toBe('pnpm run cf:deploy:preview')
  })
})
