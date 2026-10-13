import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  E2E_ALLOW_BROAD_ENV,
  E2E_MAX_LOCAL_SPECS,
  E2E_SWEEP_TAG,
  assertLocalE2eScope,
  createNardukPlaywrightPreset,
  e2eBudgetDefaults,
  e2eBudgetLifted,
  hasSweepTag,
  listSpecFiles,
  listSweepSpecs,
  localScopeRefusal,
  localScopeVerdict,
  selectedSpecs,
  specFilters,
} from '../src/playwright/config.js'

const specs = [
  'agents-screen.spec.ts',
  'hosts-screen.spec.ts',
  'keys-screen.spec.ts',
  'runs-screen.spec.ts',
  'nested/deep.spec.ts',
  '11-smoke.spec.ts',
  '95-no-unknown-text.spec.ts',
]
const sweeps = ['11-smoke.spec.ts', '95-no-unknown-text.spec.ts']
const SPEC_DIR = '/work/app/tests/e2e'
// `cwd` + the default `specDir` resolve to SPEC_DIR; specs and sweeps are given, so nothing is read.
const local = { env: {}, cwd: '/work/app', specs, sweeps }
const PAGE = 'tests/e2e/agents-screen.spec.ts'

describe('localScopeVerdict', () => {
  it('passes one page spec, a line filter, and the re-run / listing flags', () => {
    expect(localScopeVerdict([PAGE, '--workers=1'], local)).toEqual({ ok: true })
    expect(localScopeVerdict([`${PAGE}:42`, '-g', 'Watch'], local)).toEqual({ ok: true })
    expect(localScopeVerdict(['--last-failed', '--workers=1'], local)).toEqual({ ok: true })
    expect(localScopeVerdict(['--list'], local)).toEqual({ ok: true })
    expect(localScopeVerdict(['--only-changed'], local)).toEqual({ ok: true })
  })

  it('refuses a run that names no spec file', () => {
    const verdict = localScopeVerdict([], local)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.problems.join('\n')).toContain('no spec file named')
    expect(verdict.ok === false && verdict.problems.join('\n')).toContain(`${specs.length} files`)
    expect(localScopeVerdict(['--workers=1'], local).ok).toBe(false)
  })

  it('refuses a bare --grep: it still loads and walks every file', () => {
    expect(localScopeVerdict(['-g', 'agents'], local).ok).toBe(false)
    expect(localScopeVerdict(['--grep=agents'], local).ok).toBe(false)
    expect(localScopeVerdict(['--grep', 'agents', '--grep-invert', 'slow'], local).ok).toBe(false)
  })

  it('does not take the value of a value flag for a spec filter', () => {
    expect(localScopeVerdict(['--project', 'chromium', '--reporter', 'line'], local).ok).toBe(false)
    // `-p` is --project: `-p agents-screen` names a project, not a spec.
    expect(localScopeVerdict(['-p', 'agents-screen'], local).ok).toBe(false)
    expect(specFilters(['-p', 'pr', PAGE, '-j', '2', '--shard', '1/4'])).toEqual([PAGE])
  })

  it('refuses a route sweep even beside the page spec, and names it', () => {
    const verdict = localScopeVerdict([PAGE, 'tests/e2e/95-no-unknown-text.spec.ts'], local)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.problems.join('\n')).toContain(
      '95-no-unknown-text.spec.ts',
    )
    expect(localScopeVerdict(['tests/e2e/11-smoke.spec.ts'], local).ok).toBe(false)
  })

  it(`refuses more than ${E2E_MAX_LOCAL_SPECS} spec files, by name or by one broad filter`, () => {
    const four = specs.slice(0, E2E_MAX_LOCAL_SPECS + 1).map((name) => `tests/e2e/${name}`)
    expect(localScopeVerdict(four, local).ok).toBe(false)
    expect(localScopeVerdict(four.slice(0, E2E_MAX_LOCAL_SPECS), local)).toEqual({ ok: true })
    // `screen` matches the four *-screen specs.
    const broad = localScopeVerdict(['screen'], local)
    expect(broad.ok).toBe(false)
    expect(broad.ok === false && broad.problems.join('\n')).toContain('4 spec files selected')
  })

  it('refuses nothing in CI or under the override', () => {
    expect(localScopeVerdict([], { ...local, env: { CI: 'true' } })).toEqual({ ok: true })
    expect(localScopeVerdict([], { ...local, env: { [E2E_ALLOW_BROAD_ENV]: '1' } })).toEqual({
      ok: true,
    })
    // Only the value 1 lifts it.
    expect(localScopeVerdict([], { ...local, env: { [E2E_ALLOW_BROAD_ENV]: '0' } }).ok).toBe(false)
    expect(e2eBudgetLifted({ CI: '1' })).toBe(true)
    expect(e2eBudgetLifted({})).toBe(false)
  })

  it('takes the limit, the override env and the spec dir as options', () => {
    // maxSpecs
    const two = [PAGE, 'tests/e2e/hosts-screen.spec.ts']
    expect(localScopeVerdict(two, { ...local, maxSpecs: 1 }).ok).toBe(false)
    expect(localScopeVerdict(two, { ...local, maxSpecs: 2 })).toEqual({ ok: true })
    // allowBroadEnv: the portal's default name no longer lifts it
    const named = { ...local, allowBroadEnv: 'MY_BROAD' }
    expect(localScopeVerdict([], { ...named, env: { [E2E_ALLOW_BROAD_ENV]: '1' } }).ok).toBe(false)
    expect(localScopeVerdict([], { ...named, env: { MY_BROAD: '1' } })).toEqual({ ok: true })
    // specDir: a filter naming the default dir selects nothing in another one
    const other = { ...local, specDir: 'e2e/specs' }
    expect(localScopeVerdict([PAGE], other)).toEqual({ ok: true }) // selects 0 specs: nothing to refuse
    expect(
      localScopeVerdict(['e2e/specs/a', 'e2e/specs/b', 'e2e/specs/c', 'e2e/specs/d'], {
        ...other,
        specs: ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts'],
        sweeps: [],
      }).ok,
    ).toBe(false)
  })
})

describe('selectedSpecs', () => {
  it('reads a filter as a path fragment: a substring of the absolute path, `\\.` as `.`, a trailing `$` as ends-with', () => {
    expect(selectedSpecs(['agents-screen'], specs, SPEC_DIR)).toEqual(['agents-screen.spec.ts'])
    expect(selectedSpecs(['tests/e2e/agents-screen\\.spec\\.ts$'], specs, SPEC_DIR)).toEqual([
      'agents-screen.spec.ts',
    ])
    expect(selectedSpecs(['agents-screen.spec.ts$'], specs, SPEC_DIR)).toEqual([
      'agents-screen.spec.ts',
    ])
    // `$` anchors the end: a fragment that is only a prefix of the name selects nothing.
    expect(selectedSpecs(['agents-screen$'], specs, SPEC_DIR)).toEqual([])
    expect(selectedSpecs(['nested/deep.spec.ts:7:3'], specs, SPEC_DIR)).toEqual([
      'nested/deep.spec.ts',
    ])
    expect(selectedSpecs(['no-such-spec'], specs, SPEC_DIR)).toEqual([])
  })

  it('fails closed on a filter that is still a pattern: it selects every spec', () => {
    for (const pattern of [
      '.*',
      'agents|hosts',
      '[ah]',
      'agents-screen.spec.ts(unclosed',
      '^tests',
      'a+',
      'a?',
    ]) {
      expect(selectedSpecs([pattern], specs, SPEC_DIR), pattern).toEqual(specs)
    }
    expect(localScopeVerdict(['tests/e2e/(agents|hosts)-screen'], local).ok).toBe(false)
  })

  it('never builds a regular expression from the command line', () => {
    const source = readFileSync(new URL('../src/playwright/e2e-budget.ts', import.meta.url), 'utf8')
    // The sweep tag is the only RegExp, and it is escaped.
    expect(source.match(/new RegExp\(/g)).toHaveLength(1)
    expect(source).toMatch(/const escaped = tag\.replace/)
  })
})

describe('the sweep tag', () => {
  it('is read only as a comment line in the first ten lines', () => {
    expect(hasSweepTag('// @sweep\nimport x')).toBe(true)
    expect(hasSweepTag('// @fixture-switch\n// @sweep\n')).toBe(true)
    expect(hasSweepTag('const tag = "@sweep"')).toBe(false)
    expect(hasSweepTag('// @sweeper\n')).toBe(false)
    expect(hasSweepTag(`${'\n'.repeat(10)}// @sweep`)).toBe(false)
    expect(E2E_SWEEP_TAG).toBe('@sweep')
  })

  it('takes the tag as an option, and escapes it', () => {
    expect(hasSweepTag('// @walk-all\n', '@walk-all')).toBe(true)
    expect(hasSweepTag('// @sweep\n', '@walk-all')).toBe(false)
    expect(hasSweepTag('// a.b\n', 'a.b')).toBe(true)
    expect(hasSweepTag('// axb\n', 'a.b')).toBe(false)
  })
})

describe('reading the spec directory', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'e2e-budget-'))
    mkdirSync(join(root, 'tests/e2e/nested'), { recursive: true })
    mkdirSync(join(root, 'tests/e2e/node_modules'), { recursive: true })
    writeFileSync(join(root, 'tests/e2e/page.spec.ts'), "import { test } from '@playwright/test'\n")
    writeFileSync(join(root, 'tests/e2e/sweep.spec.ts'), '// @sweep\nimport x\n')
    writeFileSync(join(root, 'tests/e2e/nested/deep.spec.js'), '\n')
    writeFileSync(join(root, 'tests/e2e/global.setup.ts'), '\n')
    writeFileSync(join(root, 'tests/e2e/helper.ts'), '\n')
    writeFileSync(join(root, 'tests/e2e/node_modules/skip.spec.ts'), '\n')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('lists spec files only, recursively, with posix relative names', () => {
    expect(listSpecFiles(join(root, 'tests/e2e'))).toEqual([
      'nested/deep.spec.js',
      'page.spec.ts',
      'sweep.spec.ts',
    ])
    expect(listSpecFiles(join(root, 'does-not-exist'))).toEqual([])
    expect(listSweepSpecs(join(root, 'tests/e2e'))).toEqual(['sweep.spec.ts'])
  })

  it('judges the real files with no specs or sweeps given', () => {
    const real = { env: {}, cwd: root }
    expect(localScopeVerdict(['page.spec.ts'], real)).toEqual({ ok: true })
    expect(localScopeVerdict(['page.spec.ts', 'sweep.spec.ts'], real).ok).toBe(false)
    expect(localScopeVerdict(['sweep.spec.ts'], real).ok).toBe(false)
    expect(localScopeVerdict([], real).ok).toBe(false)
  })
})

describe('assertLocalE2eScope (the check playwright.config.ts runs as it loads)', () => {
  const argv = (...args: string[]) => ['node', 'playwright', 'test', ...args]
  const base = { cwd: '/work/app', specs, sweeps }

  it('exits 1 with the refusal for an out-of-budget local run', () => {
    const exit = vi.fn()
    const report = vi.fn()
    assertLocalE2eScope({
      ...base,
      argv: argv('tests/e2e/11-smoke.spec.ts'),
      env: {},
      exit,
      report,
    })
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(report.mock.calls[0]?.[0]).toContain('E2E_ALLOW_BROAD=1')
    expect(report.mock.calls[0]?.[0]).toContain('route sweeps selected')
  })

  it('names the project guidance and the override env it was given', () => {
    const message = localScopeRefusal(['x'], {
      allowBroadEnv: 'MY_BROAD',
      guidance: ['See AGENTS.md.'],
    })
    expect(message).toContain('See AGENTS.md.')
    expect(message).toContain('MY_BROAD=1')
    expect(message).not.toContain(E2E_ALLOW_BROAD_ENV)
  })

  it('leaves a worker, another subcommand and another config alone', () => {
    const exit = vi.fn()
    const call = (a: string[], env: Record<string, string> = {}, extra = {}) =>
      assertLocalE2eScope({ ...base, argv: a, env, exit, report: vi.fn(), ...extra })
    call(argv(), { TEST_WORKER_INDEX: '0' })
    call(['node', 'playwright', 'show-report'])
    call(argv('--config', 'playwright.performance.config.ts'))
    call(argv('--config=playwright.performance.config.ts'))
    call(argv('-c', 'apps/web/playwright.performance.config.ts'))
    call(argv(PAGE))
    call(argv('--last-failed'))
    expect(exit).not.toHaveBeenCalled()
  })

  it('still judges a run under the guarded config named explicitly, or a configFile option', () => {
    const exit = vi.fn()
    const run = (a: string[], extra = {}) =>
      assertLocalE2eScope({ ...base, argv: a, env: {}, exit, report: vi.fn(), ...extra })
    run(argv('--config', 'apps/web/playwright.config.ts'))
    expect(exit).toHaveBeenCalledTimes(1)
    run(argv('--config=e2e.config.ts'), { configFile: 'e2e.config.ts' })
    expect(exit).toHaveBeenCalledTimes(2)
    run(argv('--config=playwright.config.ts'), { configFile: 'e2e.config.ts' })
    expect(exit).toHaveBeenCalledTimes(2)
  })

  it('exits through process.exit and console.error by default', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      assertLocalE2eScope({ ...base, argv: argv(), env: {} })
      expect(exit).toHaveBeenCalledWith(1)
      expect(error).toHaveBeenCalledTimes(1)
    } finally {
      exit.mockRestore()
      error.mockRestore()
    }
  })
})

describe('e2eBudgetDefaults', () => {
  it('states every bound, with a local stop after five failures and fifteen minutes', () => {
    expect(e2eBudgetDefaults({ env: {} })).toEqual({
      timeout: 30_000,
      expect: { timeout: 5_000 },
      maxFailures: 5,
      globalTimeout: 15 * 60_000,
      use: { actionTimeout: 15_000, navigationTimeout: 30_000 },
    })
  })

  it('runs every test in CI and under the override: no failure or whole-run limit', () => {
    for (const env of [{ CI: 'true' }, { [E2E_ALLOW_BROAD_ENV]: '1' }]) {
      const budget = e2eBudgetDefaults({ env })
      expect(budget.maxFailures).toBe(0)
      expect(budget.globalTimeout).toBe(0)
      expect(budget.timeout).toBe(30_000)
    }
    expect(e2eBudgetDefaults({ env: { MY: '1' }, allowBroadEnv: 'MY' }).maxFailures).toBe(0)
    expect(
      e2eBudgetDefaults({ env: { [E2E_ALLOW_BROAD_ENV]: '1' }, allowBroadEnv: 'MY' }).maxFailures,
    ).toBe(5)
  })

  it('takes each bound as an option', () => {
    expect(
      e2eBudgetDefaults({
        env: {},
        testTimeoutMs: 45_000,
        expectTimeoutMs: 7_000,
        actionTimeoutMs: 20_000,
        navigationTimeoutMs: 40_000,
        localMaxFailures: 2,
        localGlobalTimeoutMs: 60_000,
      }),
    ).toEqual({
      timeout: 45_000,
      expect: { timeout: 7_000 },
      maxFailures: 2,
      globalTimeout: 60_000,
      use: { actionTimeout: 20_000, navigationTimeout: 40_000 },
    })
  })

  it('merges over the tier preset without dropping baseURL or the action bounds', () => {
    const preset = createNardukPlaywrightPreset({ baseURL: 'http://127.0.0.1:3000' })
    const budget = e2eBudgetDefaults({ env: {} })
    const config = { ...preset, ...budget, use: { ...preset.use, ...budget.use } }
    expect(config.use).toEqual({
      baseURL: 'http://127.0.0.1:3000',
      actionTimeout: 15_000,
      navigationTimeout: 30_000,
    })
    expect(config.workers).toBe(2)
    expect(config.maxFailures).toBe(5)
  })
})
