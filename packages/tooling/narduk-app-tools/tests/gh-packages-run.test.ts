import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  GH_PACKAGES_RUN_USAGE,
  parseGhPackagesRunArgs,
  runGhPackagesCommand,
} from '../src/gh-packages-run.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('gh-packages-run', () => {
  it('requires a command after an optional --', () => {
    expect(() => parseGhPackagesRunArgs([])).toThrow(GH_PACKAGES_RUN_USAGE)
    expect(() => parseGhPackagesRunArgs(['--'])).toThrow(GH_PACKAGES_RUN_USAGE)
    expect(parseGhPackagesRunArgs(['--', 'pnpm', 'install'])).toEqual(['pnpm', 'install'])
    expect(parseGhPackagesRunArgs(['pnpm', 'install'])).toEqual(['pnpm', 'install'])
  })

  it('fails closed on a missing or newline-bearing token', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-gh-packages-missing-'))
    tempDirs.push(root)
    expect(() =>
      runGhPackagesCommand(['true'], { cwd: root, env: { PATH: process.env.PATH, HOME: root } }),
    ).toThrow(/Missing GH_PACKAGES_READ/u)
    expect(() =>
      runGhPackagesCommand(['true'], {
        cwd: root,
        env: { PATH: process.env.PATH, HOME: root, GH_PACKAGES_READ: 'test-value\nextra' },
      }),
    ).toThrow(/invalid GH_PACKAGES_READ/u)
  })

  it('writes a temp userconfig with a variable reference, then removes it', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-gh-packages-run-'))
    tempDirs.push(root)
    const stub = join(root, 'probe.mjs')
    const seen = join(root, 'seen.txt')
    writeFileSync(
      stub,
      [
        "import { readFileSync, statSync, writeFileSync } from 'node:fs'",
        "if (process.env.NPM_CONFIG_GLOBALCONFIG !== '/dev/null') process.exit(2)",
        'const auth = process.env.NPM_CONFIG_USERCONFIG',
        'if (!auth) process.exit(3)',
        "if (readFileSync(auth, 'utf8') !== '//npm.pkg.github.com/:_authToken=${GH_PACKAGES_READ}\\n') {",
        '  process.exit(4)',
        '}',
        `writeFileSync(${JSON.stringify(seen)}, String(statSync(auth).mode & 0o777))`,
        '',
      ].join('\n'),
    )

    const status = runGhPackagesCommand([process.execPath, stub], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        RUNNER_TEMP: root,
        GH_PACKAGES_READ: 'test-value',
      },
    })
    expect(status).toBe(0)
    expect(Number(readFileSync(seen, 'utf8'))).toBe(0o600)
    expect(readdirSync(root).filter((name) => name.startsWith('npmrc-auth.'))).toEqual([])
  })

  it('preserves a caller-owned NPM_CONFIG_USERCONFIG', () => {
    const root = mkdtempSync(join(tmpdir(), 'narduk-gh-packages-preserve-'))
    tempDirs.push(root)
    const callerConfig = join(root, 'caller.npmrc')
    writeFileSync(callerConfig, '//npm.pkg.github.com/:_authToken=already-set\n')
    const stub = join(root, 'probe.mjs')
    const seen = join(root, 'seen.txt')
    writeFileSync(
      stub,
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(seen)}, process.env.NPM_CONFIG_USERCONFIG ?? '')\n`,
    )

    const status = runGhPackagesCommand([process.execPath, stub], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        RUNNER_TEMP: root,
        NPM_CONFIG_USERCONFIG: callerConfig,
        GH_PACKAGES_READ: 'test-value',
      },
    })
    expect(status).toBe(0)
    expect(readFileSync(seen, 'utf8').trim()).toBe(callerConfig)
    expect(readdirSync(root).filter((name) => name.startsWith('npmrc-auth.'))).toEqual([])
  })
})
