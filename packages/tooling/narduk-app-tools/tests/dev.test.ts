import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDevInvocation,
  buildNvaultRunArgs,
  formatDevInvocation,
  parseDevArgs,
  resolveChildExitCode,
  runDev,
} from '../src/dev.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

/**
 * A PATH containing argv-recording stubs for `nvault` and `doppler`. No test
 * here may reach a real secret manager: the stubs record their argument vector
 * and exit, so the assertions are about the command this package builds.
 */
function stubbedPath(): { doppler: string; nvault: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'narduk-app-tools-dev-'))
  tempDirs.push(dir)
  const records: Record<string, string> = {}
  for (const name of ['nvault', 'doppler']) {
    const record = join(dir, `${name}.argv`)
    records[name] = record
    writeFileSync(
      join(dir, name),
      [
        '#!/bin/sh',
        `{ for arg in "$@"; do echo "$arg"; done; } >> ${JSON.stringify(record)}`,
        'exit "${STUB_EXIT_CODE:-0}"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
  }
  return { doppler: records.doppler, nvault: records.nvault, path: dir }
}

function recordedArgv(path: string): string[] {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []
}

describe('narduk-app dev argument parsing', () => {
  it('defaults to running nuxt dev directly, with no credential route', () => {
    expect(parseDevArgs([])).toEqual({
      command: ['nuxt', 'dev'],
      config: undefined,
      credentials: 'none',
      dryRun: false,
      environment: undefined,
      project: undefined,
    })
  })

  it('passes the child command through unchanged after the separator', () => {
    const flags = parseDevArgs(['--', 'nuxt', 'dev', '--host', '127.0.0.1'])
    expect(flags.command).toEqual(['nuxt', 'dev', '--host', '127.0.0.1'])
    expect(buildDevInvocation(flags)).toEqual({
      args: ['dev', '--host', '127.0.0.1'],
      command: 'nuxt',
    })
  })

  it('does not treat child options as its own', () => {
    const flags = parseDevArgs(['--dry-run', '--', 'nuxt', 'dev', '--dry-run', '--project', 'x'])
    expect(flags.dryRun).toBe(true)
    expect(flags.command).toEqual(['nuxt', 'dev', '--dry-run', '--project', 'x'])
    expect(flags.project).toBeUndefined()
  })

  it('builds the registered nvault route from a complete selector', () => {
    const flags = parseDevArgs([
      '--credentials',
      'nvault',
      '--project',
      'demo',
      '--environment',
      'dev',
      '--config',
      'default',
      '--',
      'nuxt',
      'dev',
    ])
    expect(buildNvaultRunArgs(flags)).toEqual([
      'run',
      '-p',
      'demo',
      '-e',
      'dev',
      '-c',
      'default',
      '--',
      'nuxt',
      'dev',
    ])
    expect(formatDevInvocation(buildDevInvocation(flags))).toBe(
      'nvault run -p demo -e dev -c default -- nuxt dev',
    )
  })

  it('names every missing selector instead of resolving a partial nvault scope', () => {
    expect(() => parseDevArgs(['--credentials', 'nvault', '--project', 'demo'])).toThrow(
      '--credentials nvault requires --environment, --config',
    )
    expect(() => parseDevArgs(['--credentials', 'nvault'])).toThrow(
      '--credentials nvault requires --project, --environment, --config',
    )
  })

  it('rejects an unknown or retired credential route', () => {
    expect(() => parseDevArgs(['--credentials', 'vault'])).toThrow(
      'Unknown credential route: vault. Use none or nvault.',
    )
    expect(() => parseDevArgs(['--credentials'])).toThrow('--credentials requires a value')
    expect(() => parseDevArgs(['--credentials', 'doppler'])).toThrow(
      'narduk-app dev no longer runs Doppler',
    )
  })

  it('rejects a selector passed without the nvault route', () => {
    expect(() =>
      parseDevArgs(['--credentials', 'none', '--project', 'demo', '--', 'nuxt', 'dev']),
    ).toThrow('--project is only valid with --credentials nvault.')
  })
})

describe('the retired Doppler invocation', () => {
  // Every known caller used exactly this shape (narduk-libs#321). It must fail
  // loudly with the migration path rather than silently start a dev server
  // without the environment it used to receive.
  const legacy = ['--project', 'demo', '--config', 'dev', '--', 'nuxt', 'dev', '--host', '127.0.0.1']

  it('fails with an actionable migration message', () => {
    expect(() => parseDevArgs(legacy)).toThrow('narduk-app dev no longer runs Doppler')
    expect(() => parseDevArgs(legacy)).toThrow('--credentials nvault')
    expect(() => parseDevArgs(legacy)).toThrow('narduk-libs#321')
  })

  it('never falls back to a Doppler child, even when doppler is on PATH', () => {
    const stubs = stubbedPath()
    expect(() => parseDevArgs(legacy)).toThrow()
    const status = runDev(parseDevArgs(['--', 'nvault', 'ignored']), {
      PATH: stubs.path,
    } as NodeJS.ProcessEnv)
    expect(status).toBe(0)
    expect(recordedArgv(stubs.nvault)).toEqual(['ignored'])
    expect(recordedArgv(stubs.doppler)).toEqual([])
  })
})

describe('running the dev child', () => {
  it('spawns the nvault route with the exact registered argument vector', () => {
    const stubs = stubbedPath()
    const flags = parseDevArgs([
      '--credentials',
      'nvault',
      '--project',
      'demo',
      '--environment',
      'dev',
      '--config',
      'default',
      '--',
      'nuxt',
      'dev',
      '--host',
      '127.0.0.1',
    ])
    expect(runDev(flags, { PATH: stubs.path } as NodeJS.ProcessEnv)).toBe(0)
    expect(recordedArgv(stubs.nvault)).toEqual([
      'run',
      '-p',
      'demo',
      '-e',
      'dev',
      '-c',
      'default',
      '--',
      'nuxt',
      'dev',
      '--host',
      '127.0.0.1',
    ])
    expect(recordedArgv(stubs.doppler)).toEqual([])
  })

  it('runs the command directly when no credentials are requested', () => {
    expect(
      runDev(parseDevArgs(['--', process.execPath, '-e', 'process.exit(0)']), {
        PATH: stubbedPath().path,
      } as NodeJS.ProcessEnv),
    ).toBe(0)
  })

  it('propagates the child exit code from either route', () => {
    const stubs = stubbedPath()
    const env = { PATH: stubs.path, STUB_EXIT_CODE: '3' } as NodeJS.ProcessEnv
    const flags = parseDevArgs([
      '--credentials',
      'nvault',
      '--project',
      'demo',
      '--environment',
      'dev',
      '--config',
      'default',
      '--',
      'nuxt',
      'dev',
    ])
    expect(runDev(flags, env)).toBe(3)
    expect(runDev(parseDevArgs(['--', process.execPath, '-e', 'process.exit(4)']), env)).toBe(4)
  })

  it('prints the resolved command for a dry run without spawning it', () => {
    const stubs = stubbedPath()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const flags = parseDevArgs([
      '--credentials',
      'nvault',
      '--project',
      'demo',
      '--environment',
      'dev',
      '--config',
      'default',
      '--dry-run',
      '--',
      'nuxt',
      'dev',
    ])
    expect(runDev(flags, { PATH: stubs.path } as NodeJS.ProcessEnv)).toBe(0)
    expect(log).toHaveBeenCalledWith('nvault run -p demo -e dev -c default -- nuxt dev')
    expect(recordedArgv(stubs.nvault)).toEqual([])
  })

  it('reports a missing route binary instead of a misleading child failure', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const empty = mkdtempSync(join(tmpdir(), 'narduk-app-tools-empty-'))
    tempDirs.push(empty)
    const flags = parseDevArgs([
      '--credentials',
      'nvault',
      '--project',
      'demo',
      '--environment',
      'dev',
      '--config',
      'default',
      '--',
      'nuxt',
      'dev',
    ])
    expect(runDev(flags, { PATH: empty } as NodeJS.ProcessEnv)).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain('Could not run nvault')
  })

  it('maps a signalled child to its conventional exit code', () => {
    expect(resolveChildExitCode({ signal: null, status: 0 })).toBe(0)
    expect(resolveChildExitCode({ signal: 'SIGINT', status: null })).toBe(130)
    expect(resolveChildExitCode({ signal: 'SIGTERM', status: null })).toBe(143)
    expect(resolveChildExitCode({ signal: 'SIGKILL', status: null })).toBe(1)
  })
})
