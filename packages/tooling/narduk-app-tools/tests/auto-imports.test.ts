import { describe, expect, it, vi } from 'vitest'

import {
  AUTO_IMPORTS_EXIT,
  formatAutoImportsReport,
  parseAutoImportsArgs,
  runAutoImportsCheck,
  scanDuplicatedImports,
} from '../src/auto-imports.js'
import { main } from '../src/cli.js'

const APP = '/work/app'
/** Shape of a real `nuxt prepare` run (unimport 6.5): Nuxt and Nitro each log it. */
const REAL_LOG = [
  '',
  ` WARN  Duplicated imports "eventBody", the one from "${APP}/app/utils/c.ts" has been ignored and "${APP}/app/utils/d.ts" is used`,
  '',
  '',
  ` WARN  Duplicated imports "utcDay", the one from "${APP}/server/utils/a.ts" has been ignored and "${APP}/server/utils/b.ts" is used`,
  '',
  '',
  ` WARN  Duplicated imports "eventBody", the one from "${APP}/app/utils/c.ts" has been ignored and "${APP}/app/utils/d.ts" is used`,
  '',
  ` WARN  Duplicated imports "utcDay", the one from "${APP}/server/utils/a.ts" has been ignored and "${APP}/server/utils/b.ts" is used`,
  '◆  Types generated in .nuxt.',
].join('\n')

function silent() {
  return { log: vi.fn(), out: vi.fn() }
}

describe('scanDuplicatedImports', () => {
  it('lists each collision once with app-relative paths', () => {
    expect(scanDuplicatedImports(REAL_LOG, APP)).toEqual({
      duplicates: [
        { name: 'eventBody', ignored: 'app/utils/c.ts', used: 'app/utils/d.ts' },
        { name: 'utcDay', ignored: 'server/utils/a.ts', used: 'server/utils/b.ts' },
      ],
      unparsed: [],
    })
  })

  it('keeps absolute paths without a root and paths outside it', () => {
    const log =
      'WARN Duplicated imports "x", the one from "/elsewhere/a.ts" has been ignored and "/work/app/b.ts" is used'
    expect(scanDuplicatedImports(log).duplicates[0]).toMatchObject({ ignored: '/elsewhere/a.ts' })
    expect(scanDuplicatedImports(log, APP).duplicates[0]).toEqual({
      name: 'x',
      ignored: '/elsewhere/a.ts',
      used: 'b.ts',
    })
  })

  it('strips ANSI colour and handles CRLF', () => {
    const log = `\u001B[33m WARN \u001B[39m  Duplicated imports "a", the one from "/p/1.ts" has been ignored and "/p/2.ts" is used\r\n`
    expect(scanDuplicatedImports(log).duplicates).toHaveLength(1)
  })

  it('reports a reworded warning as unparsed instead of passing', () => {
    const scan = scanDuplicatedImports('WARN Duplicated imports found for "a" in 2 files')
    expect(scan.duplicates).toEqual([])
    expect(scan.unparsed).toEqual(['WARN Duplicated imports found for "a" in 2 files'])
  })

  it('ignores unrelated output', () => {
    expect(scanDuplicatedImports('◆  Types generated in .nuxt.\nWARN other')).toEqual({
      duplicates: [],
      unparsed: [],
    })
  })
})

describe('parseAutoImportsArgs', () => {
  it('defaults to the cwd', () => {
    expect(parseAutoImportsArgs([], '/w')).toEqual({
      cwd: '/w',
      json: false,
      jsonPath: null,
      logPath: null,
    })
  })

  it('resolves --cwd, --log and --json [path] against the cwd', () => {
    expect(
      parseAutoImportsArgs(['--cwd', 'apps/web', '--log', 'p.log', '--json', 'o.json'], '/w'),
    ).toEqual({
      cwd: '/w/apps/web',
      json: true,
      jsonPath: '/w/o.json',
      logPath: '/w/p.log',
    })
    expect(parseAutoImportsArgs(['--json', '--log', 'p.log'], '/w')).toMatchObject({
      json: true,
      jsonPath: null,
      logPath: '/w/p.log',
    })
  })

  it('rejects a missing value and unknown flags', () => {
    expect(() => parseAutoImportsArgs(['--cwd'])).toThrow('--cwd requires a value')
    expect(() => parseAutoImportsArgs(['--log', '--json'])).toThrow('--log requires a value')
    expect(() => parseAutoImportsArgs(['--bogus'])).toThrow('Unknown check-auto-imports option')
  })
})

describe('runAutoImportsCheck', () => {
  const args = { cwd: APP, json: false, jsonPath: null, logPath: null }

  it('passes when prepare logs no duplicate', () => {
    const io = silent()
    const report = runAutoImportsCheck(args, {
      ...io,
      prepare: () => ({ output: 'Types generated', status: 0 }),
    })
    expect(report).toMatchObject({ exitCode: AUTO_IMPORTS_EXIT.clean, status: 'pass' })
    expect(io.out).toHaveBeenCalledWith('[auto-imports] PASS: no duplicated auto-imports')
  })

  it('fails with exit 1 naming each name and both files, even though prepare exited 0', () => {
    const io = silent()
    const report = runAutoImportsCheck(args, {
      ...io,
      prepare: () => ({ output: REAL_LOG, status: 0 }),
    })
    expect(report.exitCode).toBe(AUTO_IMPORTS_EXIT.duplicates)
    expect(report.status).toBe('fail')
    const text = io.log.mock.calls.map((c) => String(c[0])).join('\n')
    expect(text).toContain('- eventBody')
    expect(text).toContain('used:    app/utils/d.ts')
    expect(text).toContain('ignored: app/utils/c.ts')
    expect(text).toContain('- utcDay')
    expect(text).toContain('auto-import')
    expect(io.out).not.toHaveBeenCalled()
  })

  it('is inconclusive (exit 2) when prepare fails, and shows its output', () => {
    const io = silent()
    const report = runAutoImportsCheck(args, {
      ...io,
      prepare: () => ({ output: 'boom', status: 3 }),
    })
    expect(report).toMatchObject({
      exitCode: AUTO_IMPORTS_EXIT.inconclusive,
      status: 'inconclusive',
    })
    expect(report.reason).toContain('exited 3')
    expect(io.log).toHaveBeenCalledWith('boom')
  })

  it('is inconclusive when nuxt cannot be spawned', () => {
    const report = runAutoImportsCheck(args, {
      ...silent(),
      prepare: () => ({ output: '', status: 1, error: 'spawn nuxt ENOENT' }),
    })
    expect(report.status).toBe('inconclusive')
    expect(report.reason).toContain('spawn nuxt ENOENT')
  })

  it('scans --log without running prepare, and is inconclusive when it is unreadable', () => {
    const prepare = vi.fn()
    const found = runAutoImportsCheck(
      { ...args, logPath: '/tmp/prepare.log' },
      { ...silent(), prepare, readLog: () => REAL_LOG },
    )
    expect(found.exitCode).toBe(AUTO_IMPORTS_EXIT.duplicates)
    expect(prepare).not.toHaveBeenCalled()
    const missing = runAutoImportsCheck(
      { ...args, logPath: '/tmp/none.log' },
      {
        ...silent(),
        readLog: () => {
          throw new Error('ENOENT')
        },
      },
    )
    expect(missing).toMatchObject({ exitCode: AUTO_IMPORTS_EXIT.inconclusive })
    expect(missing.reason).toContain('ENOENT')
  })

  it('fails on a reworded warning', () => {
    const report = runAutoImportsCheck(args, {
      ...silent(),
      prepare: () => ({ output: 'WARN Duplicated imports: a', status: 0 }),
    })
    expect(report.exitCode).toBe(AUTO_IMPORTS_EXIT.duplicates)
    expect(report.unparsed).toHaveLength(1)
  })

  it('prints JSON on stdout and writes the --json path', () => {
    const io = silent()
    const writeJson = vi.fn()
    runAutoImportsCheck(
      { ...args, json: true, jsonPath: '/tmp/o.json' },
      { ...io, prepare: () => ({ output: REAL_LOG, status: 0 }), writeJson },
    )
    const printed = JSON.parse(String(io.out.mock.calls[0]?.[0]))
    expect(printed.status).toBe('fail')
    expect(printed.duplicates).toHaveLength(2)
    expect(writeJson).toHaveBeenCalledWith('/tmp/o.json', expect.stringContaining('"eventBody"'))
    expect(io.log).not.toHaveBeenCalled()
  })
})

describe('formatAutoImportsReport', () => {
  it('explains the collision and the fix', () => {
    const text = formatAutoImportsReport({
      duplicates: [{ name: 'a', ignored: 'x.ts', used: 'y.ts' }],
      exitCode: 1,
      reason: null,
      status: 'fail',
      unparsed: [],
    })
    expect(text).toContain('silently keeps')
    expect(text).toContain('delete the')
  })
})

describe('check-auto-imports through the CLI', () => {
  it('exits 1 for a scanned log with a duplicate and 0 for a clean one', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'narduk-auto-imports-'))
    try {
      writeFileSync(join(dir, 'dup.log'), REAL_LOG)
      writeFileSync(join(dir, 'clean.log'), 'Types generated\n')
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        expect(
          await main(['check-auto-imports', '--cwd', dir, '--log', join(dir, 'dup.log')]),
        ).toBe(1)
        expect(
          await main(['check-auto-imports', '--cwd', dir, '--log', join(dir, 'clean.log')]),
        ).toBe(0)
        expect(await main(['check-auto-imports', '--bogus'])).toBe(1)
      } finally {
        error.mockRestore()
        log.mockRestore()
      }
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
