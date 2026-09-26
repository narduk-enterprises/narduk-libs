import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  findStarterIdentityPlaceholders,
  isGeneratedFileCurrent,
  parseEnsureGeneratedArgs,
  parseStarterIdentityArgs,
  runEnsureGenerated,
  runStarterIdentityCheck,
} from '../src/app-scripts.js'
import { main } from '../src/cli.js'

const tempDirs: string[] = []
const GENERATED = '.nuxt/nuxt.d.ts'
const PREPARE = ['nuxt', 'prepare']

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'narduk-app-scripts-'))
  tempDirs.push(dir)
  return dir
}

function write(root: string, path: string, content: string): void {
  const absolute = join(root, path)
  mkdirSync(join(absolute, '..'), { recursive: true })
  writeFileSync(absolute, content)
}

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { force: true, recursive: true })
})

describe('ensure-generated', () => {
  it('parses targets and the command around --', () => {
    expect(parseEnsureGeneratedArgs(['a.d.ts', 'b.json', '--', ...PREPARE])).toEqual({
      targets: ['a.d.ts', 'b.json'],
      command: PREPARE,
    })
    expect(() => parseEnsureGeneratedArgs(['--', 'nuxt'])).toThrow('Usage')
    expect(() => parseEnsureGeneratedArgs(['a.d.ts', '--'])).toThrow('Usage')
    expect(() => parseEnsureGeneratedArgs(['a.d.ts', 'nuxt'])).toThrow('Usage')
  })

  it('treats a file importing a vanished pnpm store path as stale', () => {
    const root = tempDir()
    const store = 'node_modules/.pnpm/nuxt@4.0.0/node_modules/nuxt/index.d.ts'
    write(root, GENERATED, `import '../${store}'\nexport * from "../${store}"\n`)
    expect(isGeneratedFileCurrent(join(root, GENERATED))).toBe(false)
    write(root, store, '')
    expect(isGeneratedFileCurrent(join(root, GENERATED))).toBe(true)
    expect(isGeneratedFileCurrent(join(root, 'missing.d.ts'))).toBe(false)
  })

  it('skips the command when every target is current', () => {
    const runs: string[][] = []
    const status = runEnsureGenerated(
      { targets: ['a'], command: PREPARE },
      { isCurrent: () => true, run: (command) => (runs.push(command), 0) },
    )
    expect(status).toBe(0)
    expect(runs).toEqual([])
  })

  it('runs the command, then waits for the targets to appear', () => {
    let checks = 0
    const sleeps: number[] = []
    const status = runEnsureGenerated(
      { targets: ['a'], command: PREPARE },
      {
        isCurrent: () => (checks += 1) > 3,
        run: () => 0,
        sleep: (ms) => sleeps.push(ms),
      },
    )
    expect(status).toBe(0)
    expect(sleeps).toEqual([1000, 1000])
  })

  it('fails naming the stale targets after five checks', () => {
    const lines: string[] = []
    const status = runEnsureGenerated(
      { targets: ['a', 'b'], command: PREPARE },
      {
        isCurrent: (target) => target.endsWith('/a'),
        run: () => 0,
        sleep: () => {},
        log: (line) => lines.push(line),
      },
    )
    expect(status).toBe(1)
    expect(lines).toEqual([
      'Expected generated file(s) missing or stale after: nuxt prepare',
      'Missing or stale: b',
    ])
  })

  it("returns the command's own failure", () => {
    expect(
      runEnsureGenerated(
        { targets: ['a'], command: PREPARE },
        { isCurrent: () => false, run: () => 7 },
      ),
    ).toBe(7)
  })

  it('runs a real command through the CLI', async () => {
    const root = tempDir()
    const target = join(root, 'out.txt')
    const status = await main([
      'ensure-generated',
      target,
      '--',
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(target)}, 'ok')`,
    ])
    expect(status).toBe(0)
    expect(isGeneratedFileCurrent(target)).toBe(true)
  })
})

describe('check-starter-identity', () => {
  it('reports placeholders on identity surfaces only', () => {
    const root = tempDir()
    write(root, 'README.md', '# __DISPLAY_NAME__\n')
    write(root, 'apps/web/app/pages/index.vue', '<h1>__APP_NAME__</h1>')
    write(root, 'apps/web/package.json', '{"name":"__APP_NAME__"}')
    write(root, 'apps/web/server/api/x.ts', '__APP_NAME__')
    write(root, 'node_modules/pkg/README.md', '__APP_NAME__')
    write(root, 'pnpm-lock.yaml', '__APP_NAME__')
    expect(findStarterIdentityPlaceholders(root)).toEqual([
      'README.md: __DISPLAY_NAME__',
      'apps/web/app/pages/index.vue: __APP_NAME__',
      'apps/web/package.json: __APP_NAME__',
    ])
    const out: string[] = []
    expect(runStarterIdentityCheck(root, (text) => out.push(text))).toBe(1)
    expect(out.join('\n')).toContain('- README.md: __DISPLAY_NAME__')
  })

  it('passes a renamed app', () => {
    const root = tempDir()
    write(root, 'README.md', '# Harmony Hot Sauce\n')
    expect(runStarterIdentityCheck(root, () => {})).toBe(0)
  })

  it('parses --cwd and refuses unknown options', () => {
    expect(parseStarterIdentityArgs(['--cwd', 'apps/web'], '/repo')).toBe('/repo/apps/web')
    expect(parseStarterIdentityArgs([], '/repo')).toBe('/repo')
    expect(() => parseStarterIdentityArgs(['--fix'])).toThrow('Unknown check-starter-identity')
  })
})
