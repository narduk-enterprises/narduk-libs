import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseFoundationCheckArgs } from '../src/commands/foundation-check.js'
import { parseMigrationArgs } from '../src/cli.js'
import { buildDevInvocation, parseDevArgs } from '../src/dev.js'
import {
  buildWranglerCommandArgs,
  isDryRunDeploy,
  isLocalDeployAllowed,
  isWorkersBuildDeployAllowed,
  parseDeployArgs,
  readWranglerScriptName,
  resolveAppDir,
  resolveWranglerConfigPath,
  runDeploy,
  writeFlattenedWranglerDeployConfig,
} from '../src/deploy.js'
import {
  isGitWorkingTreeClean,
  isNonLocalHttpsUrl,
  normalizeDeployHostname,
  parseDeployLocalArgs,
} from '../src/deploy-local.js'
import { parsePerformanceBudgetArgs } from '../src/performance.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('app-local command planning', () => {
  it('names the invoking command when foundation-check-style args are unknown', () => {
    expect(() => parseFoundationCheckArgs(['--bogus'])).toThrow(
      'Unknown foundation:check option: --bogus',
    )
    expect(() =>
      parseFoundationCheckArgs(['--bogus'], 'foundation:check:shared-ui-pinned'),
    ).toThrow('Unknown foundation:check:shared-ui-pinned option: --bogus')
  })

  it('runs dev through the registered nvault route without a file-backed env plan', () => {
    const flags = parseDevArgs([
      '--credentials',
      'nvault',
      '--project',
      'app',
      '--environment',
      'dev',
      '--config',
      'default',
      '--',
      'node',
      '-e',
      'x',
    ])
    expect(buildDevInvocation(flags)).toEqual({
      args: ['run', '-p', 'app', '-e', 'dev', '-c', 'default', '--', 'node', '-e', 'x'],
      command: 'nvault',
    })
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

  it('guards generated remote migrations behind Workers Builds attestation', () => {
    expect(
      parseMigrationArgs([
        '--config',
        'migrations.sources.json',
        '--database',
        'app-db',
        '--remote',
        '--workers-build-only',
      ]),
    ).toMatchObject({ location: '--remote', workersBuildOnly: true })
    expect(() =>
      parseMigrationArgs([
        '--config',
        'migrations.sources.json',
        '--database',
        'app-db',
        '--local',
        '--workers-build-only',
      ]),
    ).toThrow('valid only with --remote')
  })

  it('accepts package-manager passthrough before performance budget flags', () => {
    expect(parsePerformanceBudgetArgs(['--', '--json', '--font-total-budget-kb', '120'])).toEqual({
      fontTotalBudgetKb: 120,
      json: true,
    })
    expect(parsePerformanceBudgetArgs(['--font-total-budget-kb', '140', '--', '--json'])).toEqual({
      fontTotalBudgetKb: 140,
      json: true,
    })
    expect(() => parsePerformanceBudgetArgs(['--', '--', '--json'])).toThrow(
      'Unknown performance-budget option: --',
    )
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

  it('preserves hotfix runtime vars in generated configuration without changing source', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-hotfix-config-'))
    tempDirs.push(root)
    const path = join(root, 'wrangler.jsonc')
    const source = JSON.stringify({ name: 'example', keep_vars: false, vars: { MODE: 'prod' } })
    writeFileSync(path, source)
    const ordinary = writeFlattenedWranglerDeployConfig(path)
    expect(JSON.parse(readFileSync(ordinary, 'utf8')).keep_vars).toBe(false)
    const hotfix = writeFlattenedWranglerDeployConfig(path, { keepVars: true })
    expect(JSON.parse(readFileSync(hotfix, 'utf8'))).toMatchObject({
      keep_vars: true,
      vars: { MODE: 'prod' },
      main: '.output/server/index.mjs',
    })
    expect(readFileSync(path, 'utf8')).toBe(source)
  })

  it('refuses to silently ignore the keep-vars contract without a source config', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-hotfix-no-config-'))
    tempDirs.push(root)
    expect(() => runDeploy(['versions-upload', '--dry-run'], root, {}, { keepVars: true })).toThrow(
      'requires a source Wrangler config and built output',
    )
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
