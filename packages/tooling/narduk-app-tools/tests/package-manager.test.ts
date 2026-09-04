import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  resolvePnpmInvocation,
  resolveWranglerInvocation,
  spawnPnpmSync,
  spawnWranglerSync,
} from '../src/package-manager.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('package-manager invocation', () => {
  it('executes a native npm_execpath directly', () => {
    expect(resolvePnpmInvocation({ npm_execpath: process.execPath, PATH: '' })).toEqual({
      argsPrefix: [],
      command: process.execPath,
    })
  })

  it('uses npm_execpath through Node when PATH cannot resolve pnpm', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-pnpm-invocation-'))
    tempDirs.push(root)
    const packageManagerEntrypoint = join(root, 'pnpm.cjs')
    writeFileSync(
      packageManagerEntrypoint,
      'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
    )

    const env = { npm_execpath: packageManagerEntrypoint, PATH: '' }
    expect(resolvePnpmInvocation(env)).toEqual({
      argsPrefix: [packageManagerEntrypoint],
      command: process.execPath,
    })

    for (const invocation of ['first', 'second']) {
      const result = spawnPnpmSync(['exec', 'wrangler', invocation], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(['exec', 'wrangler', invocation])
    }
  })

  it('ignores a stale JavaScript npm_execpath and repeatedly uses PNPM_HOME without PATH', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-pnpm-home-'))
    tempDirs.push(root)
    const pnpmHome = join(root, 'pnpm-home')
    mkdirSync(pnpmHome)
    const packageManagerExecutable = join(pnpmHome, 'pnpm')
    writeFileSync(
      packageManagerExecutable,
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))`,
    )
    chmodSync(packageManagerExecutable, 0o755)

    const env = {
      npm_execpath: join(root, 'removed', 'pnpm.cjs'),
      PATH: '',
      PNPM_HOME: pnpmHome,
    }
    expect(resolvePnpmInvocation(env)).toEqual({
      argsPrefix: [],
      command: packageManagerExecutable,
    })

    for (const invocation of ['first', 'second']) {
      const result = spawnPnpmSync(['exec', 'wrangler', invocation], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual(['exec', 'wrangler', invocation])
    }
  })
})

describe('wrangler invocation', () => {
  it('spawns the consumer-local wrangler binary directly, bypassing npm exec argument mangling', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-app-wrangler-local-bin-'))
    tempDirs.push(root)
    const binDir = join(root, 'node_modules', '.bin')
    mkdirSync(binDir, { recursive: true })
    const wranglerBin = join(binDir, 'wrangler')
    writeFileSync(
      wranglerBin,
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))`,
    )
    chmodSync(wranglerBin, 0o755)

    expect(resolveWranglerInvocation(root)).toEqual({
      argsPrefix: [],
      command: wranglerBin,
    })

    // An npm-based consumer sets npm_execpath to npm-cli.js. Under the old
    // `spawnPnpmSync(['exec', 'wrangler', ...])` routing this would either
    // invoke `npm exec` (which drops the `--command` flag's value) or crash
    // outright. spawnWranglerSync must resolve and run the binary directly,
    // so the args array — `--command` included — reaches wrangler intact
    // regardless of which package manager is active.
    const env = {
      npm_execpath: '/usr/local/lib/node_modules/npm/bin/npm-cli.js',
      PATH: '',
    }
    const result = spawnWranglerSync(root, ['d1', 'execute', 'db', '--command', 'SELECT 1'], {
      cwd: root,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['d1', 'execute', 'db', '--command', 'SELECT 1'])
  })

  it('falls back to Node module resolution when no local .bin/wrangler exists', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'narduk-app-wrangler-require-resolve-')))
    tempDirs.push(root)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'consumer' }))
    const wranglerDir = join(root, 'node_modules', 'wrangler', 'bin')
    mkdirSync(wranglerDir, { recursive: true })
    const wranglerEntrypoint = join(wranglerDir, 'wrangler.js')
    writeFileSync(wranglerEntrypoint, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')

    expect(resolveWranglerInvocation(root)).toEqual({
      argsPrefix: [wranglerEntrypoint],
      command: process.execPath,
    })
  })
})
