import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertOgImageSigningSecretForBuild,
  CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
  CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE,
  isOgImageSigningSecretConfigured,
  MISSING_OG_IMAGE_SECRET_MESSAGE,
  resolveOgImageSigningSecret,
} from '../shared/ogImageSecret'
import { BUILD_CI_OUTPUT_MARKER, writeBuildCiOutputMarker } from '../src/buildCiOutputMarker'

const repoPackages = join(dirname(fileURLToPath(import.meta.url)), '../../..')

afterEach(() => {
  vi.unstubAllEnvs()
})

const REAL_OG_SECRET = 'production-og-secret'

describe('OG image signing secret', () => {
  it('treats empty, whitespace, and non-strings as unconfigured', () => {
    expect(resolveOgImageSigningSecret('')).toBe('')
    expect(resolveOgImageSigningSecret('   ')).toBe('')
    expect(resolveOgImageSigningSecret(undefined)).toBe('')
    expect(resolveOgImageSigningSecret(false)).toBe('')
    expect(isOgImageSigningSecretConfigured('')).toBe(false)
    expect(isOgImageSigningSecretConfigured('   ')).toBe(false)
    expect(isOgImageSigningSecretConfigured(undefined)).toBe(false)
  })

  it('trims a configured secret', () => {
    expect(resolveOgImageSigningSecret(`  ${REAL_OG_SECRET}  `)).toBe(REAL_OG_SECRET)
    expect(isOgImageSigningSecretConfigured(REAL_OG_SECRET)).toBe(true)
  })

  it('fails a non-dev build when runtime OG is enabled without a secret', () => {
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: '',
      }),
    ).toThrow(MISSING_OG_IMAGE_SECRET_MESSAGE)
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: '   ',
      }),
    ).toThrow(/NUXT_OG_IMAGE_SECRET/u)
  })

  it('stays permissive in dev, prepare, and when runtime generation is off', () => {
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: true,
        runtimeGenerationEnabled: true,
        secret: '',
      }),
    ).not.toThrow()
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        isPrepare: true,
        runtimeGenerationEnabled: true,
        secret: '',
      }),
    ).not.toThrow()
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: false,
        secret: '',
      }),
    ).not.toThrow()
  })

  it('accepts a real secret on a deploy build and on a plain build', () => {
    vi.stubEnv('WORKERS_CI', '1')
    vi.stubEnv('NARDUK_CLOUDFLARE_BUILD', '')
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: REAL_OG_SECRET,
      }),
    ).not.toThrow()

    vi.stubEnv('WORKERS_CI', '')
    vi.stubEnv('WORKERS_CI_BRANCH', '')
    vi.stubEnv('NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY', '')
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: REAL_OG_SECRET,
      }),
    ).not.toThrow()
  })

  it('rejects the committed CI placeholder on a Workers Builds deploy build', () => {
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'production')
    vi.stubEnv('NARDUK_CLOUDFLARE_BUILD', '')
    vi.stubEnv('WORKERS_CI', '1')
    vi.stubEnv('WORKERS_CI_BRANCH', 'main')

    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: `  ${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET}  `,
      }),
    ).toThrow(CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE)
  })

  it('rejects the placeholder on Workers Builds cf:build even if the CI flag is copied', () => {
    vi.stubEnv('NARDUK_CLOUDFLARE_BUILD', '1')
    vi.stubEnv('WORKERS_CI', '1')
    vi.stubEnv('WORKERS_CI_BRANCH', 'main')

    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
      }),
    ).toThrow(CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE)
  })

  it('rejects the placeholder on a plain build that is not build:ci', () => {
    // ogpreview-app and gonogo defaulted this literal from `build` / `cf:build`
    // with no NARDUK_CLOUDFLARE_BUILD, then deployed the output (narduk-libs#1155).
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'production')
    vi.stubEnv('NARDUK_CLOUDFLARE_BUILD', '')
    vi.stubEnv('WORKERS_CI', '')
    vi.stubEnv('WORKERS_CI_BRANCH', '')
    vi.stubEnv('NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY', '')

    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
      }),
    ).toThrow(CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE)
  })

  it('rejects the placeholder when the local wrangler deploy escape hatch is on', () => {
    vi.stubEnv('NARDUK_CLOUDFLARE_BUILD', '1')
    vi.stubEnv('WORKERS_CI', '')
    vi.stubEnv('WORKERS_CI_BRANCH', '')
    vi.stubEnv('NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY', '1')

    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
      }),
    ).toThrow(CI_TEST_ONLY_OG_IMAGE_SECRET_MESSAGE)
  })

  it('accepts the placeholder on NARDUK_CLOUDFLARE_BUILD=1 and says the output must be marked', () => {
    // Generated nuxt.config.ts does `NARDUK_DEPLOY_TARGET ??= production`
    // when WORKERS_CI_BRANCH is unset, so build:ci also sees production.
    // A local cf:build or ship:build sets the same variable, which is why
    // acceptance is reported to the caller instead of trusted (#1155).
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'production')
    vi.stubEnv('NARDUK_CLOUDFLARE_BUILD', '1')
    vi.stubEnv('WORKERS_CI', '')
    vi.stubEnv('WORKERS_CI_BRANCH', '')
    vi.stubEnv('NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY', '')

    expect(
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
      }),
    ).toBe(true)
  })

  it('reports no placeholder for a real secret, dev, prepare, or disabled runtime', () => {
    vi.stubEnv('NARDUK_CLOUDFLARE_BUILD', '1')
    vi.stubEnv('WORKERS_CI', '')
    vi.stubEnv('WORKERS_CI_BRANCH', '')
    vi.stubEnv('NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY', '')
    const base = { isDev: false, runtimeGenerationEnabled: true }

    expect(assertOgImageSigningSecretForBuild({ ...base, secret: REAL_OG_SECRET })).toBe(false)
    for (const input of [
      { isDev: true },
      { isPrepare: true },
      { runtimeGenerationEnabled: false },
    ]) {
      expect(
        assertOgImageSigningSecretForBuild({
          ...base,
          ...input,
          secret: CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
        }),
      ).toBe(false)
    }
  })

  it('writes the deploy-refused marker into the Nitro output dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-seo-marker-'))
    try {
      const outputDir = join(root, '.output')
      const path = writeBuildCiOutputMarker(outputDir)
      expect(path).toBe(join(outputDir, BUILD_CI_OUTPUT_MARKER))
      expect(readFileSync(path, 'utf8')).toContain('test-only placeholder')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('uses the marker name narduk-app deploy refuses', () => {
    const deploySrc = readFileSync(
      join(repoPackages, 'tooling/narduk-app-tools/src/deploy.ts'),
      'utf8',
    )
    expect(deploySrc).toContain(`export const BUILD_CI_OUTPUT_MARKER = '${BUILD_CI_OUTPUT_MARKER}'`)
  })

  it('shares one placeholder literal with the generator files that emit it', () => {
    const generateSrc = readFileSync(
      join(repoPackages, 'tooling/create-narduk-app/src/generate.ts'),
      'utf8',
    )
    expect(generateSrc).toContain(`NUXT_OG_IMAGE_SECRET=${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET}`)

    const ciTestEnvPath = join(repoPackages, 'tooling/create-narduk-app/src/ci-test-env.ts')
    if (existsSync(ciTestEnvPath)) {
      expect(readFileSync(ciTestEnvPath, 'utf8')).toContain(
        `'${CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET}'`,
      )
    }
  })
})
