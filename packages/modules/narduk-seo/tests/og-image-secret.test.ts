import { existsSync, readFileSync } from 'node:fs'
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

const repoPackages = join(dirname(fileURLToPath(import.meta.url)), '../../..')

afterEach(() => {
  vi.unstubAllEnvs()
})

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
    expect(resolveOgImageSigningSecret('  production-og-secret  ')).toBe('production-og-secret')
    expect(isOgImageSigningSecretConfigured('production-og-secret')).toBe(true)
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

  it('accepts a non-dev build when a secret is configured', () => {
    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: 'production-og-secret',
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

  it('accepts the placeholder for a build no estate path deploys', () => {
    // narduk-libs#440's packed-consumer smoke fills NUXT_OG_IMAGE_SECRET with
    // this literal and builds the generated fixture app with the plain `build`
    // script, so NARDUK_CLOUDFLARE_BUILD is unset. That artefact is built in a
    // temp directory and never deployed, so it must not be rejected.
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
    ).not.toThrow()
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

  it('keeps accepting the placeholder on GitHub Actions build:ci', () => {
    // Generated nuxt.config.ts does `NARDUK_DEPLOY_TARGET ??= production`
    // when WORKERS_CI_BRANCH is unset, so build:ci also sees production.
    vi.stubEnv('NARDUK_DEPLOY_TARGET', 'production')
    vi.stubEnv('NARDUK_CLOUDFLARE_BUILD', '1')
    vi.stubEnv('WORKERS_CI', '')
    vi.stubEnv('WORKERS_CI_BRANCH', '')

    expect(() =>
      assertOgImageSigningSecretForBuild({
        isDev: false,
        runtimeGenerationEnabled: true,
        secret: CI_TEST_ONLY_NUXT_OG_IMAGE_SECRET,
      }),
    ).not.toThrow()
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
