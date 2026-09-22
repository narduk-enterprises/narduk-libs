import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * lint-budget.mjs is plain ESM with JSDoc types and no declaration file, so it
 * is loaded through a computed URL like the packs are (see packs.test.ts).
 */
interface Verdict {
  overBudget: Array<{ ruleId: string; count: number; budget: number }>
  lowered: Array<{ ruleId: string; count: number; budget: number }>
  unbudgeted: Array<{ ruleId: string; count: number }>
  blocked: Array<{ ruleId: string; count: number }>
  recorded: Array<{ ruleId: string; count: number }>
  cleared: Array<{ ruleId: string; budget: number }>
  nextBudget: Record<string, number>
  stale: boolean
}

interface BudgetModule {
  EXIT_OK: number
  EXIT_LINT_FAILURE: number
  EXIT_USAGE: number
  evaluateBudget: (
    counts: Record<string, number>,
    budget: Record<string, number>,
    options?: { strict?: boolean },
  ) => Verdict
  parseArgs: (
    argv: string[],
    env?: Record<string, string>,
  ) => { ci: boolean; patterns: string[]; ignorePatterns: string[] }
  runNardukLint: (
    argv: string[],
    options: {
      cwd: string
      env: Record<string, string>
      log: (line: string) => void
      logError: (line: string) => void
    },
  ) => Promise<number>
  serializeBudget: (rules: Record<string, number>, options?: { strict?: boolean }) => string
  topLocations: (locations: Array<{ file: string; line: number }>, limit?: number) => string[]
}

let budgetModule: BudgetModule
let EXIT_OK: number
let EXIT_LINT_FAILURE: number
let EXIT_USAGE: number

beforeAll(async () => {
  budgetModule = (await import(
    new URL('../../lint-budget.mjs', import.meta.url).href
  )) as BudgetModule
  ;({ EXIT_OK, EXIT_LINT_FAILURE, EXIT_USAGE } = budgetModule)
})

const serializeBudget = (rules: Record<string, number>, options?: { strict?: boolean }) =>
  budgetModule.serializeBudget(rules, options)

const CONFIG = `export default [
  { files: ['**/*.js'], rules: { 'no-console': 'warn', 'no-var': 'warn', 'no-debugger': 'error' } },
]
`

const tempDirs: string[] = []

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'narduk-lint-'))
  tempDirs.push(dir)
  writeFileSync(join(dir, 'eslint.config.mjs'), CONFIG)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

async function run(dir: string, argv: string[] = [], env: Record<string, string> = {}) {
  const out: string[] = []
  const err: string[] = []
  const code = await budgetModule.runNardukLint(argv, {
    cwd: dir,
    env,
    log: (line) => out.push(line),
    logError: (line) => err.push(line),
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

function budgetOf(dir: string): unknown {
  return JSON.parse(readFileSync(join(dir, 'lint-budget.json'), 'utf8'))
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const THREE_CONSOLES = 'console.log(1)\nconsole.log(2)\nconsole.log(3)\n'

describe('narduk-lint end to end', () => {
  it('fails on any lint error, even with no warnings', async () => {
    const dir = fixture({ 'a.js': 'debugger\n' })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.out).toContain('no-debugger')
  })

  it('passes a clean tree and writes nothing', async () => {
    const dir = fixture({ 'a.js': 'export const a = 1\n' })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(() => budgetOf(dir)).toThrow()
  })

  it('local: records an unbudgeted warn rule and passes', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('unbudgeted: no-console has 3')
    expect(budgetOf(dir)).toEqual({ rules: { 'no-console': 3 } })
  })

  it('local: fails over budget, prints rule/count/budget/locations, and never raises', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': serializeBudget({ 'no-console': 1 }),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('over budget: no-console has 3 warning(s), budget is 1')
    expect(result.err).toContain('a.js:1')
    expect(budgetOf(dir)).toEqual({ rules: { 'no-console': 1 } })
  })

  it('local: lowers a budget when the count drops, and deletes entries that reach zero', async () => {
    const dir = fixture({
      'a.js': 'console.log(1)\n',
      'lint-budget.json': serializeBudget({ 'no-console': 4, 'no-var': 2 }),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('lowered: no-console 4 → 1')
    expect(result.out).toContain('cleared: no-var 2 → 0')
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(
      '{\n  "rules": {\n    "no-console": 1\n  }\n}\n',
    )
  })

  it('local: leaves an exactly-met budget untouched', async () => {
    const original = serializeBudget({ 'no-console': 3 })
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(original)
  })

  it('local --no-write: reports but does not touch the file', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES })
    const result = await run(dir, ['--no-write'])
    expect(result.code).toBe(EXIT_OK)
    expect(() => budgetOf(dir)).toThrow()
  })

  it('ci: never writes; an unbudgeted rule passes with a notice', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES })
    const result = await run(dir, [], { CI: 'true' })
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('unbudgeted: no-console')
    expect(result.out).toContain('run `pnpm lint` locally and commit lint-budget.json')
    expect(() => budgetOf(dir)).toThrow()
  })

  it('ci: a count below budget passes with a ratchet notice and no write', async () => {
    const original = serializeBudget({ 'no-console': 9 })
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
    const result = await run(dir, ['--ci'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('budget can ratchet: no-console 9 → 3')
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(original)
  })

  it('ci: over budget fails', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': serializeBudget({ 'no-console': 2 }),
    })
    const result = await run(dir, ['--ci'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
  })

  it('--local overrides CI=true', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES })
    const result = await run(dir, ['--local'], { CI: 'true' })
    expect(result.code).toBe(EXIT_OK)
    expect(budgetOf(dir)).toEqual({ rules: { 'no-console': 3 } })
  })

  it('passes explicit paths through to ESLint', async () => {
    const dir = fixture({ 'a.js': 'debugger\n', 'b.js': 'export const b = 1\n' })
    expect((await run(dir, ['b.js'])).code).toBe(EXIT_OK)
    expect((await run(dir, ['a.js'])).code).toBe(EXIT_LINT_FAILURE)
  })

  it('--fix applies fixes before counting', async () => {
    const dir = fixture({ 'a.js': 'var a = 1\nexport { a }\n' })
    const result = await run(dir, ['--fix', '--no-write'])
    expect(result.code).toBe(EXIT_OK)
    expect(readFileSync(join(dir, 'a.js'), 'utf8')).toBe('let a = 1\nexport { a }\n')
    expect(result.out).toContain('0 warning(s)')
  })

  it('--budget points at another file', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES })
    await run(dir, ['--budget', 'custom-budget.json'])
    expect(JSON.parse(readFileSync(join(dir, 'custom-budget.json'), 'utf8'))).toEqual({
      rules: { 'no-console': 3 },
    })
  })

  it('exits 2 on a malformed budget file', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': '{ nope' })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.err).toContain('not valid JSON')
  })

  it('exits 2 on a non-integer budget', async () => {
    const dir = fixture({ 'lint-budget.json': '{ "rules": { "no-console": 1.5 } }' })
    expect((await run(dir)).code).toBe(EXIT_USAGE)
  })

  it('exits 2 on --max-warnings and on unknown flags', async () => {
    const dir = fixture({ 'a.js': 'export const a = 1\n' })
    expect((await run(dir, ['--max-warnings', '0'])).code).toBe(EXIT_USAGE)
    expect((await run(dir, ['--wat'])).code).toBe(EXIT_USAGE)
  })

  it('exits 2 when ESLint itself fails (no files match)', async () => {
    const dir = fixture({})
    expect((await run(dir, ['missing/**/*.js'])).code).toBe(EXIT_USAGE)
  })

  it('--help exits 0', async () => {
    const dir = fixture({})
    const result = await run(dir, ['--help'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('Exit codes')
  })
})

describe('narduk-lint strict budgets (#673)', () => {
  const strictEmpty = () => serializeBudget({}, { strict: true })

  it('non-strict: says that an unbudgeted rule was recorded rather than gated', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': serializeBudget({}) })
    const result = await run(dir, ['--ci'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('is not strict')
    const missing = await run(fixture({ 'a.js': THREE_CONSOLES }), ['--ci'])
    expect(missing.out).toContain('no lint-budget.json: warnings are not gated at all')
  })

  it('local: a warning in a rule with no entry fails and is not recorded', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': strictEmpty() })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('unbudgeted: no-console has 3 warning(s) and no budget entry')
    expect(result.err).toContain('a.js:1')
    expect(result.err).toContain('--accept-new-rules')
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(strictEmpty())
  })

  it('ci: the same tree gets the same verdict', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': strictEmpty() })
    const result = await run(dir, [], { CI: 'true' })
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(strictEmpty())
  })

  it('--accept-new-rules records the entry, keeps strict, and passes', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': strictEmpty() })
    const result = await run(dir, ['--accept-new-rules'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('recorded: no-console = 3')
    expect(budgetOf(dir)).toEqual({ strict: true, rules: { 'no-console': 3 } })
    expect((await run(dir, ['--ci'])).code).toBe(EXIT_OK)
  })

  it('--accept-new-rules is refused in CI and with --no-write', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': strictEmpty() })
    expect((await run(dir, ['--accept-new-rules'], { CI: 'true' })).code).toBe(EXIT_USAGE)
    expect((await run(dir, ['--accept-new-rules', '--no-write'])).code).toBe(EXIT_USAGE)
  })

  it('ratcheting a strict budget down keeps it strict', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': serializeBudget({ 'no-console': 5, 'no-var': 2 }, { strict: true }),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(budgetOf(dir)).toEqual({ strict: true, rules: { 'no-console': 3 } })
  })

  it('exits 2 when strict is not a boolean', async () => {
    const dir = fixture({ 'a.js': 'export const a = 1\n', 'lint-budget.json': '{"strict":"yes"}' })
    expect((await run(dir)).code).toBe(EXIT_USAGE)
  })
})

describe('evaluateBudget', () => {
  it('classifies every branch', () => {
    const verdict = budgetModule.evaluateBudget(
      { over: 5, lower: 1, same: 2, fresh: 3 },
      { over: 4, lower: 3, same: 2, gone: 7 },
    )
    expect(verdict.overBudget).toEqual([{ ruleId: 'over', count: 5, budget: 4 }])
    expect(verdict.lowered).toEqual([{ ruleId: 'lower', count: 1, budget: 3 }])
    expect(verdict.unbudgeted).toEqual([{ ruleId: 'fresh', count: 3 }])
    expect(verdict.cleared).toEqual([{ ruleId: 'gone', budget: 7 }])
    expect(verdict.nextBudget).toEqual({ over: 4, lower: 1, same: 2, fresh: 3 })
    expect(verdict.stale).toBe(true)
  })

  it('strict: blocks an unbudgeted rule instead of recording it', () => {
    const verdict = budgetModule.evaluateBudget(
      { fresh: 3, kept: 1 },
      { kept: 1 },
      { strict: true },
    )
    expect(verdict.blocked).toEqual([{ ruleId: 'fresh', count: 3 }])
    expect(verdict.recorded).toEqual([])
    expect(verdict.nextBudget).toEqual({ kept: 1 })
    expect(verdict.stale).toBe(false)
  })

  it('is not stale when every count matches', () => {
    expect(budgetModule.evaluateBudget({ a: 1 }, { a: 1 }).stale).toBe(false)
  })
})

describe('helpers', () => {
  it('serializeBudget sorts keys and ends with a newline', () => {
    expect(serializeBudget({ b: 1, a: 2 })).toBe(
      '{\n  "rules": {\n    "a": 2,\n    "b": 1\n  }\n}\n',
    )
    expect(serializeBudget({})).toBe('{\n  "rules": {}\n}\n')
    expect(serializeBudget({}, { strict: true })).toBe('{\n  "strict": true,\n  "rules": {}\n}\n')
  })

  it('topLocations favours the most-affected file and caps at five', () => {
    const locations = [
      { file: 'x.ts', line: 1 },
      { file: 'y.ts', line: 3 },
      { file: 'y.ts', line: 1 },
      ...Array.from({ length: 6 }, (_, index) => ({ file: 'z.ts', line: index + 1 })),
    ]
    expect(budgetModule.topLocations(locations)).toEqual([
      'z.ts:1',
      'z.ts:2',
      'z.ts:3',
      'z.ts:4',
      'z.ts:5',
    ])
  })

  it('parseArgs honours CI env and flags', () => {
    expect(budgetModule.parseArgs([], { CI: 'true' }).ci).toBe(true)
    expect(budgetModule.parseArgs([], { CI: 'false' }).ci).toBe(false)
    expect(budgetModule.parseArgs([], {}).patterns).toEqual(['.'])
    expect(
      budgetModule.parseArgs(['src', '--ignore-pattern', 'x', '--cache']).ignorePatterns,
    ).toEqual(['x'])
  })
})
