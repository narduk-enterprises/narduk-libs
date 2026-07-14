import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildDopplerRunArgs, parseDevArgs } from '../src/dev'
import {
  buildWranglerCommandArgs,
  isDryRunDeploy,
  isLocalDeployAllowed,
  isWorkersBuildDeployAllowed,
  parseDeployArgs,
  readWranglerScriptName,
  resolveAppDir,
  resolveWranglerConfigPath,
  writeFlattenedWranglerDeployConfig,
} from '../src/deploy'
import {
  isGitWorkingTreeClean,
  isNonLocalHttpsUrl,
  normalizeDeployHostname,
  parseDeployLocalArgs,
} from '../src/deploy-local'

const tempDirs: string[] = []

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

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
    expect(parseDeployArgs(['deploy', '--', '--dry-run'])).toEqual({
      action: 'deploy',
      passthroughArgs: ['--dry-run'],
    })
    expect(isDryRunDeploy(parseDeployArgs(['deploy', '--', '--dry-run']).passthroughArgs)).toBe(
      true,
    )
    expect(() => parseDeployArgs(['deploy', '--', '--', '--dry-run'])).toThrow(
      'bare -- is not allowed',
    )
    expect(isLocalDeployAllowed({ SKIP_DEPENDENCY_INSTALL: '1' })).toBe(false)
    expect(
      isWorkersBuildDeployAllowed({
        CI: 'true',
        WORKERS_CI: '1',
        WORKERS_CI_BRANCH: 'main',
        WORKERS_CI_BUILD_UUID: 'build-uuid',
        WORKERS_CI_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
      }),
    ).toBe(true)
    expect(isWorkersBuildDeployAllowed({ CI: 'true', WORKERS_CI: '1' })).toBe(false)
    expect(() => parseDeployArgs(['--minify'])).toThrow('deploy <deploy|versions-upload>')
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

  it('reads commented Wrangler JSONC and prefers it over legacy JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-jsonc-'))
    tempDirs.push(root)
    const appDir = join(root, 'apps', 'web')
    mkdirSync(appDir, { recursive: true })
    writeFileSync(join(appDir, 'wrangler.json'), '{"name":"legacy"}\n')
    writeFileSync(
      join(appDir, 'wrangler.jsonc'),
      '{\n  // canonical worker\n  "name": "jsonc-worker",\n  "env": { "staging": {} },\n}\n',
    )

    expect(resolveAppDir(root)).toBe(appDir)
    expect(resolveWranglerConfigPath(appDir)).toBe(join(appDir, 'wrangler.jsonc'))
    expect(readWranglerScriptName(appDir)).toBe('jsonc-worker')
    const flattened = writeFlattenedWranglerDeployConfig(join(appDir, 'wrangler.jsonc'))
    expect(flattened).toBe(join(appDir, '.wrangler.deploy.production.json'))
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

  it('treats a failed git status as unsafe', () => {
    expect(isGitWorkingTreeClean('/path/that/does/not/exist')).toBe(false)
  })
})
