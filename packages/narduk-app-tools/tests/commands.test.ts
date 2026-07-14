import { describe, expect, it } from 'vitest'

import { buildDopplerRunArgs, parseDevArgs } from '../src/dev'
import { buildWranglerCommandArgs, isLocalDeployAllowed, parseDeployArgs } from '../src/deploy'
import {
  isNonLocalHttpsUrl,
  normalizeDeployHostname,
  parseDeployLocalArgs,
} from '../src/deploy-local'

describe('app-local command planning', () => {
  it('runs dev through Doppler without a file-backed env plan', () => {
    const flags = parseDevArgs(['--project', 'app', '--config', 'dev', '--', 'node', '-e', 'x'])
    expect(buildDopplerRunArgs(flags)).toEqual([
      'run',
      '--project',
      'app',
      '--config',
      'dev',
      '--',
      'node',
      '-e',
      'x',
    ])
  })

  it('preserves deployment recovery safeguards', () => {
    expect(isLocalDeployAllowed({})).toBe(false)
    expect(isLocalDeployAllowed({ NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1' })).toBe(true)
    expect(parseDeployArgs(['versions-upload', '--minify'])).toEqual({
      action: 'versions-upload',
      passthroughArgs: ['--minify'],
    })
    expect(
      buildWranglerCommandArgs({
        action: 'deploy',
        appDir: '/tmp/app',
        hasGeneratedConfig: true,
        hasOutputEntrypoint: true,
        passthroughArgs: [],
        sourceConfigPath: null,
      }),
    ).toEqual([
      'exec',
      'wrangler',
      '--config',
      '/tmp/app/.output/server/wrangler.json',
      'deploy',
      '--env=',
      '--keep-vars',
    ])
  })

  it('parses headless local deploy options', () => {
    expect(
      parseDeployLocalArgs(['--yes', '--dry-run', '--skip-migrate', '--no-probe', '--force']),
    ).toEqual({
      dryRun: true,
      force: true,
      noProbe: true,
      skipMigrate: true,
      yes: true,
    })
  })

  it('rejects local deploy probe targets', () => {
    expect(isNonLocalHttpsUrl('http://example.com')).toBe(false)
    expect(isNonLocalHttpsUrl('https://localhost')).toBe(false)
    expect(isNonLocalHttpsUrl('https://127.0.0.1')).toBe(false)
    expect(isNonLocalHttpsUrl('https://example.com')).toBe(true)
    expect(normalizeDeployHostname('[::1]')).toBe('::1')
  })
})
