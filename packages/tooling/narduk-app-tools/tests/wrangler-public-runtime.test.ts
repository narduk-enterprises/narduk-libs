/**
 * Workers Builds does not export wrangler.json `vars` into `nuxt build`.
 * Apps were hand-rolling a reader (buoys `public-runtime-from-wrangler.ts`);
 * this helper is that reader (narduk-libs#516).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyWranglerVarsToEnv,
  publicRuntimeFromWrangler,
  readWranglerVarsForBuild,
} from '../src/wrangler-public-runtime.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

function writeWrangler(
  contents: string,
  filename = 'wrangler.jsonc',
): { cwd: string; path: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'wrangler-public-runtime-'))
  tempDirs.push(cwd)
  const path = join(cwd, filename)
  writeFileSync(path, contents)
  return { cwd, path }
}

describe('wrangler vars to Nuxt public runtime (narduk-libs#516)', () => {
  it('maps wrangler.jsonc vars onto public runtime keys when process.env is empty', () => {
    const { cwd } = writeWrangler(`{
  // Workers Builds never injects these into nuxt build
  "name": "buoys",
  "vars": {
    "SITE_URL": "https://buoys.nard.uk",
    "NUXT_PUBLIC_ALLOW_GEOLOCATION": "true",
    "POSTHOG_PUBLIC_KEY": "phc_test",
    "NUXT_SESSION_PASSWORD": "do-not-publish",
  },
}
`)

    const publicRuntime = publicRuntimeFromWrangler({ cwd, env: {} })

    expect(publicRuntime).toMatchObject({
      siteUrl: 'https://buoys.nard.uk',
      appUrl: 'https://buoys.nard.uk',
      allowGeolocation: true,
      posthogPublicKey: 'phc_test',
    })
    expect(publicRuntime).not.toHaveProperty('sessionPassword')
    expect(JSON.stringify(publicRuntime)).not.toContain('do-not-publish')
  })

  it('lets an already-set process.env value win over wrangler.json vars', () => {
    const { path } = writeWrangler(
      JSON.stringify({
        vars: {
          SITE_URL: 'https://from-wrangler.example',
          NUXT_PUBLIC_ALLOW_GEOLOCATION: 'true',
        },
      }),
      'wrangler.json',
    )

    const env = {
      SITE_URL: 'https://from-build-variable.example',
      NUXT_PUBLIC_ALLOW_GEOLOCATION: '0',
    }
    const publicRuntime = publicRuntimeFromWrangler({ wranglerPath: path, env })

    expect(publicRuntime.siteUrl).toBe('https://from-build-variable.example')
    expect(publicRuntime.allowGeolocation).toBe(false)
  })

  it('applies only unset wrangler vars onto the build environment', () => {
    const { cwd } = writeWrangler(
      JSON.stringify({
        vars: {
          SITE_URL: 'https://from-wrangler.example',
          NUXT_PUBLIC_ALLOW_GEOLOCATION: 'true',
        },
      }),
    )
    const env: NodeJS.ProcessEnv = { SITE_URL: 'https://already-set.example' }

    const applied = applyWranglerVarsToEnv({ cwd, env })

    expect(applied).toEqual({ NUXT_PUBLIC_ALLOW_GEOLOCATION: 'true' })
    expect(env.SITE_URL).toBe('https://already-set.example')
    expect(env.NUXT_PUBLIC_ALLOW_GEOLOCATION).toBe('true')
  })

  it('overlays named wrangler env vars when NUXT_WRANGLER_ENVIRONMENT is set', () => {
    const { cwd } = writeWrangler(
      JSON.stringify({
        vars: { SITE_URL: 'https://production.example' },
        env: {
          preview: { vars: { SITE_URL: 'https://preview.example' } },
        },
      }),
    )

    const merged = readWranglerVarsForBuild({
      cwd,
      env: { NUXT_WRANGLER_ENVIRONMENT: 'preview' },
    })

    expect(merged.SITE_URL).toBe('https://preview.example')
  })

  it('finds apps/web/wrangler.jsonc from the repository root', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrangler-public-runtime-root-'))
    tempDirs.push(cwd)
    mkdirSync(join(cwd, 'apps', 'web'), { recursive: true })
    writeFileSync(
      join(cwd, 'apps', 'web', 'wrangler.jsonc'),
      JSON.stringify({ vars: { NUXT_PUBLIC_APP_NAME: 'LakeStat' } }),
    )

    expect(publicRuntimeFromWrangler({ cwd, env: {} })).toEqual({ appName: 'LakeStat' })
  })

  it('throws when there is no wrangler config to read', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wrangler-public-runtime-missing-'))
    tempDirs.push(cwd)

    expect(() => publicRuntimeFromWrangler({ cwd, env: {} })).toThrow(/wrangler\.jsonc/u)
  })
})
