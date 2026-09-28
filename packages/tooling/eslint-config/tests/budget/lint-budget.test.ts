import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
      now?: () => Date
    },
  ) => Promise<number>
  evaluateExpiry: (
    counts: Record<string, number>,
    rules: Record<string, number>,
    expires: Record<string, string>,
    nextRules: Record<string, number>,
    options: { today: string; stampUnstamped: boolean },
  ) => ExpiryVerdict
  addDays: (isoDate: string, days: number) => string
  isIsoDate: (value: unknown) => boolean
  serializeBudget: (rules: Record<string, number>, options?: BudgetOptions) => string
  topLocations: (locations: Array<{ file: string; line: number }>, limit?: number) => string[]
}

interface BudgetOptions {
  strict?: boolean
  maxWarnings?: number
  expires?: Record<string, string>
}

interface ExpiryVerdict {
  expired: Array<{ ruleId: string; count: number; expires: string }>
  owed: Array<{ ruleId: string; count: number; expires: string }>
  unstamped: Array<{ ruleId: string; count: number }>
  blocked: Array<{ ruleId: string; count: number }>
  stamped: Array<{ ruleId: string; expires: string }>
  nextExpires: Record<string, string>
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

const serializeBudget = (rules: Record<string, number>, options?: BudgetOptions) =>
  budgetModule.serializeBudget(rules, options)

/** An expiry of `date` for every entry that allows warnings. */
const stamp = (rules: Record<string, number>, date = STAMPED) =>
  Object.fromEntries(
    Object.entries(rules)
      .filter(([, count]) => count > 0)
      .map(([ruleId]) => [ruleId, date]),
  )

/** A budget whose entries were recorded on TODAY, as 2.7.0+ writes them. */
const entries = (rules: Record<string, number>, options: BudgetOptions = {}) =>
  serializeBudget(rules, { expires: stamp(rules), ...options })

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

/**
 * Every run reads a fixed clock, so no assertion depends on the wall clock.
 * An entry recorded on TODAY expires on STAMPED.
 */
const TODAY = '2026-09-28'
const STAMPED = '2026-10-05'
const clockAt = (isoDate: string) => () => new Date(`${isoDate}T12:00:00Z`)

async function run(
  dir: string,
  argv: string[] = [],
  env: Record<string, string> = {},
  today: string = TODAY,
) {
  const out: string[] = []
  const err: string[] = []
  const code = await budgetModule.runNardukLint(argv, {
    cwd: dir,
    env,
    log: (line) => out.push(line),
    logError: (line) => err.push(line),
    now: clockAt(today),
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
    expect(result.out).toContain(`recorded: no-console = 3, expires ${STAMPED}`)
    expect(budgetOf(dir)).toEqual({
      rules: { 'no-console': 3 },
      expires: { 'no-console': STAMPED },
    })
  })

  it('local: fails over budget, prints rule/count/budget/locations, and never raises', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': entries({ 'no-console': 1 }),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('over budget: no-console has 3 warning(s), budget is 1')
    expect(result.err).toContain('a.js:1')
    expect(budgetOf(dir)).toEqual({
      rules: { 'no-console': 1 },
      expires: { 'no-console': STAMPED },
    })
  })

  it('local: lowers a budget when the count drops, and deletes entries that reach zero', async () => {
    const dir = fixture({
      'a.js': 'console.log(1)\n',
      'lint-budget.json': entries({ 'no-console': 4, 'no-var': 2 }),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('lowered: no-console 4 → 1')
    expect(result.out).toContain('cleared: no-var 2 → 0')
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(
      `{\n  "rules": {\n    "no-console": 1\n  },\n  "expires": {\n    "no-console": "${STAMPED}"\n  }\n}\n`,
    )
  })

  it('local: leaves an exactly-met budget untouched', async () => {
    const original = entries({ 'no-console': 3 })
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
    const original = entries({ 'no-console': 9 })
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
    const result = await run(dir, ['--ci'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('budget can ratchet: no-console 9 → 3')
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(original)
  })

  it('ci: over budget fails', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': entries({ 'no-console': 2 }),
    })
    const result = await run(dir, ['--ci'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
  })

  it('--local overrides CI=true', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES })
    const result = await run(dir, ['--local'], { CI: 'true' })
    expect(result.code).toBe(EXIT_OK)
    expect(budgetOf(dir)).toEqual({
      rules: { 'no-console': 3 },
      expires: { 'no-console': STAMPED },
    })
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
      expires: { 'no-console': STAMPED },
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
    expect(budgetOf(dir)).toEqual({
      strict: true,
      rules: { 'no-console': 3 },
      expires: { 'no-console': STAMPED },
    })
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
      'lint-budget.json': entries({ 'no-console': 5, 'no-var': 2 }, { strict: true }),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(budgetOf(dir)).toEqual({
      strict: true,
      rules: { 'no-console': 3 },
      expires: { 'no-console': STAMPED },
    })
  })

  it('exits 2 when strict is not a boolean', async () => {
    const dir = fixture({ 'a.js': 'export const a = 1\n', 'lint-budget.json': '{"strict":"yes"}' })
    expect((await run(dir)).code).toBe(EXIT_USAGE)
  })
})

describe('narduk-lint maxWarnings ceiling', () => {
  const FIVE_WARNINGS = `${THREE_CONSOLES}var a = 1\nvar b = 2\nexport { a, b }\n`
  const withCeiling = (rules: Record<string, number>, maxWarnings: number, strict = true) =>
    entries(rules, { strict, maxWarnings })

  it('over the ceiling fails locally and in CI, even when every rule is within budget', async () => {
    const original = withCeiling({ 'no-console': 3, 'no-var': 2 }, 4)
    const dir = fixture({ 'a.js': FIVE_WARNINGS, 'lint-budget.json': original })
    const local = await run(dir)
    expect(local.code).toBe(EXIT_LINT_FAILURE)
    expect(local.err).toContain('over ceiling: 5 warning(s) in total, maxWarnings is 4')
    expect(local.err).toContain('no-console: 3')
    expect(local.err).toContain('no-var: 2')
    expect(local.err).not.toContain('over budget')
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(original)
    const ci = await run(dir, [], { CI: 'true' })
    expect(ci.code).toBe(EXIT_LINT_FAILURE)
    expect(ci.err).toContain('over ceiling')
  })

  it('at the ceiling passes', async () => {
    const original = withCeiling({ 'no-console': 3, 'no-var': 2 }, 5)
    const dir = fixture({ 'a.js': FIVE_WARNINGS, 'lint-budget.json': original })
    const result = await run(dir, ['--ci'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('5 warning(s) across 2 rule(s), maxWarnings 5')
    expect(result.err).toBe('')
  })

  it('under the ceiling passes, and a local ratchet keeps the ceiling and strict', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': withCeiling({ 'no-console': 4, 'no-var': 1 }, 10),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(
      `{\n  "strict": true,\n  "maxWarnings": 10,\n  "rules": {\n    "no-console": 3\n  },\n  "expires": {\n    "no-console": "${STAMPED}"\n  }\n}\n`,
    )
  })

  it('strict with empty rules still means zero warnings under a ceiling', async () => {
    const dir = fixture({ 'a.js': 'console.log(1)\n', 'lint-budget.json': withCeiling({}, 10) })
    const result = await run(dir, ['--ci'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('unbudgeted: no-console has 1 warning(s)')
    expect(result.err).not.toContain('over ceiling')
  })

  it('--accept-new-rules records up to the ceiling', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': withCeiling({}, 3) })
    const result = await run(dir, ['--accept-new-rules'])
    expect(result.code).toBe(EXIT_OK)
    expect(budgetOf(dir)).toEqual({
      strict: true,
      maxWarnings: 3,
      rules: { 'no-console': 3 },
      expires: { 'no-console': STAMPED },
    })
  })

  it('--accept-new-rules refuses to record past the ceiling and leaves the file alone', async () => {
    const original = withCeiling({ 'no-var': 2 }, 4)
    const dir = fixture({ 'a.js': FIVE_WARNINGS, 'lint-budget.json': original })
    const result = await run(dir, ['--accept-new-rules'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain(
      'not recorded: no-console (3) would bring the recorded total to 5, past maxWarnings 4',
    )
    expect(result.out).not.toContain('recorded: no-console')
    expect(readFileSync(join(dir, 'lint-budget.json'), 'utf8')).toBe(original)
  })

  it('past the ceiling a local run still ratchets down, but records nothing new', async () => {
    const dir = fixture({
      'a.js': FIVE_WARNINGS,
      'lint-budget.json': withCeiling({ 'no-var': 9 }, 4, false),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.out).toContain('lowered: no-var 9 → 2')
    expect(budgetOf(dir)).toEqual({
      maxWarnings: 4,
      rules: { 'no-var': 2 },
      expires: { 'no-var': STAMPED },
    })
  })

  it('a non-strict budget under the ceiling records as before and keeps the ceiling', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': withCeiling({}, 10, false) })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(budgetOf(dir)).toEqual({
      maxWarnings: 10,
      rules: { 'no-console': 3 },
      expires: { 'no-console': STAMPED },
    })
  })

  it('without the field nothing changes: no ceiling, no maxWarnings written', async () => {
    const dir = fixture({
      'a.js': FIVE_WARNINGS,
      'lint-budget.json': entries({ 'no-console': 3, 'no-var': 9 }, { strict: true }),
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('5 warning(s) across 2 rule(s)\n')
    expect(result.out).not.toContain('maxWarnings')
    expect(budgetOf(dir)).toEqual({
      strict: true,
      rules: { 'no-console': 3, 'no-var': 2 },
      expires: { 'no-console': STAMPED, 'no-var': STAMPED },
    })
  })

  it.each([
    ['a negative number', '-1'],
    ['a fraction', '2.5'],
    ['a string', '"10"'],
    ['null', 'null'],
    ['a boolean', 'true'],
  ])('exits 2 when maxWarnings is %s', async (_label, value) => {
    const dir = fixture({
      'a.js': 'export const a = 1\n',
      'lint-budget.json': `{ "strict": true, "maxWarnings": ${value}, "rules": {} }`,
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.err).toContain('"maxWarnings" must be a non-negative integer')
  })

  it('maxWarnings 0 is valid and fails on any warning', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': withCeiling({ 'no-console': 3 }, 0),
    })
    const result = await run(dir, ['--ci'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('maxWarnings is 0')
  })

  it('--max-warnings stays refused and points at the budget field', async () => {
    const dir = fixture({ 'a.js': 'export const a = 1\n' })
    const result = await run(dir, ['--max-warnings=10'])
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.err).toContain('"maxWarnings"')
  })
})

describe('narduk-lint entry expiry (7 days)', () => {
  const readRaw = (dir: string) => readFileSync(join(dir, 'lint-budget.json'), 'utf8')
  const strictEntries = (rules: Record<string, number>, expires: Record<string, string>) =>
    serializeBudget(rules, { strict: true, maxWarnings: 10, expires })

  it('stamps a recorded entry 7 days out, across month and year ends', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': serializeBudget({}, { strict: true, maxWarnings: 10 }),
    })
    const result = await run(dir, ['--accept-new-rules'], {}, '2026-12-29')
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('recorded: no-console = 3, expires 2027-01-05')
    expect(readRaw(dir)).toBe(
      '{\n  "strict": true,\n  "maxWarnings": 10,\n  "rules": {\n    "no-console": 3\n  },\n  "expires": {\n    "no-console": "2027-01-05"\n  }\n}\n',
    )
    expect(budgetModule.addDays('2028-02-26', 7)).toBe('2028-03-04')
    expect(budgetModule.addDays('2026-09-28', 7)).toBe(STAMPED)
  })

  it('a rewrite with nothing new is byte-identical, keys in a fixed order', async () => {
    const original = strictEntries(
      { 'no-var': 2, 'no-console': 3 },
      stamp({ 'no-var': 2, 'no-console': 3 }),
    )
    expect(original).toBe(
      `{\n  "strict": true,\n  "maxWarnings": 10,\n  "rules": {\n    "no-console": 3,\n    "no-var": 2\n  },\n  "expires": {\n    "no-console": "${STAMPED}",\n    "no-var": "${STAMPED}"\n  }\n}\n`,
    )
    const dir = fixture({
      'a.js': `${THREE_CONSOLES}var a = 1\nvar b = 2\nexport { a, b }\n`,
      'lint-budget.json': original,
    })
    for (const argv of [[], ['--accept-new-rules']]) {
      const result = await run(dir, argv, {}, '2026-10-01')
      expect(result.code).toBe(EXIT_OK)
      expect(result.out).not.toContain('updated lint-budget.json')
      expect(readRaw(dir)).toBe(original)
    }
  })

  it('no renewal: a later --accept-new-rules keeps the original expiry', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': serializeBudget({}, { strict: true }),
    })
    await run(dir, ['--accept-new-rules'])
    const stamped = readRaw(dir)
    expect(budgetOf(dir)).toEqual({
      strict: true,
      rules: { 'no-console': 3 },
      expires: { 'no-console': STAMPED },
    })
    const again = await run(dir, ['--accept-new-rules'], {}, '2026-10-04')
    expect(again.code).toBe(EXIT_OK)
    expect(readRaw(dir)).toBe(stamped)
  })

  it('no renewal: a new rule gets its own date and leaves the older entry alone', async () => {
    const dir = fixture({
      'a.js': `${THREE_CONSOLES}var a = 1\nexport { a }\n`,
      'lint-budget.json': serializeBudget(
        { 'no-console': 3 },
        { strict: true, expires: { 'no-console': STAMPED } },
      ),
    })
    const result = await run(dir, ['--accept-new-rules'], {}, '2026-10-02')
    expect(result.code).toBe(EXIT_OK)
    expect(budgetOf(dir)).toEqual({
      strict: true,
      rules: { 'no-console': 3, 'no-var': 1 },
      expires: { 'no-console': STAMPED, 'no-var': '2026-10-09' },
    })
  })

  it('no renewal: a hand-raised count or a lowered count keeps the expiry', async () => {
    const raised = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': serializeBudget(
        { 'no-console': 9 },
        { strict: true, expires: { 'no-console': STAMPED } },
      ),
    })
    const result = await run(raised, [], {}, '2026-10-03')
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('lowered: no-console 9 → 3')
    expect(budgetOf(raised)).toEqual({
      strict: true,
      rules: { 'no-console': 3 },
      expires: { 'no-console': STAMPED },
    })
  })

  it('names what is owed and when, while an entry is live', async () => {
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'lint-budget.json': strictEntries({ 'no-console': 3 }, { 'no-console': STAMPED }),
    })
    const result = await run(dir, ['--ci'], {}, STAMPED)
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain(
      `owed: no-console has 3 warning(s); fix by ${STAMPED} (UTC), after which they fail`,
    )
  })

  it('an entry past its expiry that still has warnings fails locally and in CI', async () => {
    const original = strictEntries({ 'no-console': 3 }, { 'no-console': STAMPED })
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
    const local = await run(dir, [], {}, '2026-10-06')
    expect(local.code).toBe(EXIT_LINT_FAILURE)
    expect(local.err).toContain(
      `expired: no-console has 3 warning(s); its budget entry expired after ${STAMPED} (today is 2026-10-06, UTC)`,
    )
    expect(local.err).toContain('a.js:1')
    expect(local.err).toContain('Fix those warnings, run `narduk-lint` locally with no paths')
    expect(local.err).toContain(
      'narduk-lint never moves an existing expiry (`--accept-new-rules` keeps it)',
    )
    expect(readRaw(dir)).toBe(original)
    const ci = await run(dir, [], { CI: 'true' }, '2026-10-06')
    expect(ci.code).toBe(EXIT_LINT_FAILURE)
    expect(ci.err).toContain('expired: no-console')
  })

  it('--accept-new-rules does not rescue or re-stamp an expired entry', async () => {
    const original = strictEntries({ 'no-console': 3 }, { 'no-console': STAMPED })
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
    const result = await run(dir, ['--accept-new-rules'], {}, '2026-10-20')
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('expired: no-console')
    expect(readRaw(dir)).toBe(original)
  })

  it('an expired entry lowered by a local run keeps its date and still fails', async () => {
    const dir = fixture({
      'a.js': 'console.log(1)\n',
      'lint-budget.json': strictEntries({ 'no-console': 3 }, { 'no-console': STAMPED }),
    })
    const result = await run(dir, [], {}, '2026-10-06')
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(budgetOf(dir)).toEqual({
      strict: true,
      maxWarnings: 10,
      rules: { 'no-console': 1 },
      expires: { 'no-console': STAMPED },
    })
  })

  it('an expired entry with no warnings left passes and is cleared', async () => {
    const dir = fixture({
      'a.js': 'export const a = 1\n',
      'lint-budget.json': strictEntries({ 'no-console': 3 }, { 'no-console': STAMPED }),
    })
    const ci = await run(dir, ['--ci'], {}, '2026-10-06')
    expect(ci.code).toBe(EXIT_OK)
    expect(ci.out).toContain('budget can ratchet: no-console 3 → 0')
    const local = await run(dir, [], {}, '2026-10-06')
    expect(local.code).toBe(EXIT_OK)
    expect(readRaw(dir)).toBe(serializeBudget({}, { strict: true, maxWarnings: 10 }))
  })

  it('a cleared rule that comes back is new debt with a new date', async () => {
    const dir = fixture({
      'a.js': 'export const a = 1\n',
      'lint-budget.json': strictEntries({ 'no-console': 3 }, { 'no-console': STAMPED }),
    })
    await run(dir, [], {}, '2026-10-01')
    writeFileSync(join(dir, 'a.js'), 'console.log(1)\n')
    const strictFail = await run(dir, [], {}, '2026-10-10')
    expect(strictFail.code).toBe(EXIT_LINT_FAILURE)
    expect(strictFail.err).toContain('unbudgeted: no-console')
    await run(dir, ['--accept-new-rules'], {}, '2026-10-10')
    expect(budgetOf(dir)).toEqual({
      strict: true,
      maxWarnings: 10,
      rules: { 'no-console': 1 },
      expires: { 'no-console': '2026-10-17' },
    })
  })

  describe('an entry with no expiry (budget written before 2.7.0)', () => {
    const legacy = () => serializeBudget({ 'no-console': 3 }, { strict: true })

    it('strict: fails locally and in CI with the exact fix command, and writes nothing', async () => {
      const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': legacy() })
      const local = await run(dir)
      expect(local.code).toBe(EXIT_LINT_FAILURE)
      expect(local.err).toContain(
        'no expiry: no-console has 3 warning(s) under a budget entry with no "expires" date',
      )
      expect(local.err).toContain(
        `start the 7-day clock on purpose with \`narduk-lint --accept-new-rules\` locally (it stamps "expires": "${STAMPED}") and commit lint-budget.json`,
      )
      expect(readRaw(dir)).toBe(legacy())
      const ci = await run(dir, [], { CI: 'true' })
      expect(ci.code).toBe(EXIT_LINT_FAILURE)
      expect(ci.err).toContain('no expiry: no-console')
    })

    it('strict: --accept-new-rules stamps it once, and a later run keeps that date', async () => {
      const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': legacy() })
      const result = await run(dir, ['--accept-new-rules'])
      expect(result.code).toBe(EXIT_OK)
      expect(result.out).toContain(
        `stamped: no-console expires ${STAMPED} (the entry had no expiry)`,
      )
      const stamped = readRaw(dir)
      expect(budgetOf(dir)).toEqual({
        strict: true,
        rules: { 'no-console': 3 },
        expires: { 'no-console': STAMPED },
      })
      expect((await run(dir, ['--ci'])).code).toBe(EXIT_OK)
      await run(dir, ['--accept-new-rules'], {}, '2026-10-04')
      expect(readRaw(dir)).toBe(stamped)
    })

    it('strict: a local ratchet lowers it but does not stamp it', async () => {
      const dir = fixture({
        'a.js': 'console.log(1)\n',
        'lint-budget.json': legacy(),
      })
      const result = await run(dir)
      expect(result.code).toBe(EXIT_LINT_FAILURE)
      expect(budgetOf(dir)).toEqual({ strict: true, rules: { 'no-console': 1 } })
    })

    it('non-strict: a local run stamps it, as it records a new rule; CI notes it', async () => {
      const original = serializeBudget({ 'no-console': 3 })
      const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
      const ci = await run(dir, ['--ci'])
      expect(ci.code).toBe(EXIT_OK)
      expect(ci.out).toContain(
        `no expiry: no-console has warnings and no "expires" date; a local run stamps ${STAMPED}`,
      )
      expect(ci.out).toContain('run `pnpm lint` locally and commit lint-budget.json')
      expect(readRaw(dir)).toBe(original)
      const local = await run(dir)
      expect(local.code).toBe(EXIT_OK)
      expect(budgetOf(dir)).toEqual({
        rules: { 'no-console': 3 },
        expires: { 'no-console': STAMPED },
      })
    })

    it('an entry of 0 allows no warnings, so it needs no expiry', async () => {
      const dir = fixture({
        'a.js': THREE_CONSOLES,
        'lint-budget.json': serializeBudget({ 'no-console': 0 }, { strict: true }),
      })
      const result = await run(dir, ['--ci'])
      expect(result.code).toBe(EXIT_LINT_FAILURE)
      expect(result.err).toContain('over budget: no-console has 3 warning(s), budget is 0')
      expect(result.err).not.toContain('no expiry')
    })
  })

  it('the ceiling refuses an entry before it is stamped', async () => {
    const original = strictEntries({ 'no-var': 2 }, { 'no-var': STAMPED })
    const dir = fixture({
      'a.js': `${THREE_CONSOLES}var a = 1\nvar b = 2\nexport { a, b }\n`,
      'lint-budget.json': original.replace('"maxWarnings": 10', '"maxWarnings": 4'),
    })
    const result = await run(dir, ['--accept-new-rules'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('not recorded: no-console (3)')
    expect(readRaw(dir)).toBe(original.replace('"maxWarnings": 10', '"maxWarnings": 4'))
  })

  it.each([
    ['not an object', '"expires": []', '"expires" must be an object'],
    ['a string date', '"expires": { "no-console": "soon" }', 'must be a YYYY-MM-DD date'],
    ['a number', '"expires": { "no-console": 20261005 }', 'must be a YYYY-MM-DD date'],
    [
      'an impossible date',
      '"expires": { "no-console": "2026-02-30" }',
      'must be a YYYY-MM-DD date',
    ],
    [
      'a timestamp',
      '"expires": { "no-console": "2026-10-05T00:00:00Z" }',
      'must be a YYYY-MM-DD date',
    ],
    ['a rule with no entry', '"expires": { "no-var": "2026-10-05" }', 'has no entry in "rules"'],
  ])('exits 2 when expires is %s', async (_label, field, message) => {
    const dir = fixture({
      'a.js': 'export const a = 1\n',
      'lint-budget.json': `{ "strict": true, "rules": { "no-console": 1 }, ${field} }`,
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.err).toContain(message)
  })
})

/**
 * A narrowed run (paths, `--ignore-pattern`, or a run from below the budget's
 * directory) sees only some of the package's warnings. If it wrote, it would
 * clear entries whose warnings live in files it never linted, and the next
 * full run would record them again with a fresh date: a renewal. So a narrowed
 * run never writes (adversarial verify of narduk-libs#1237, claim 3).
 */
describe('narduk-lint narrowed runs never write the budget', () => {
  const readRaw = (dir: string) => readFileSync(join(dir, 'lint-budget.json'), 'utf8')
  const DUE = '2026-10-01'
  const owed = (options: BudgetOptions = {}) =>
    serializeBudget({ 'no-console': 3 }, { expires: { 'no-console': DUE }, ...options })

  it('strict: linting a clean file keeps the entry, and the next full run fails it as expired, not new', async () => {
    const original = owed({ strict: true })
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'b.js': 'export const b = 1\n',
      'lint-budget.json': original,
    })
    const subset = await run(dir, ['b.js'], {}, '2026-09-30')
    expect(subset.code).toBe(EXIT_OK)
    expect(subset.out).not.toContain('• cleared')
    expect(subset.out).toContain(
      'narrowed run (paths b.js): lint-budget.json not written, and lowered or cleared entries are not reported',
    )
    expect(readRaw(dir)).toBe(original)

    const full = await run(dir, [], {}, '2026-10-02')
    expect(full.code).toBe(EXIT_LINT_FAILURE)
    expect(full.err).toContain(
      `expired: no-console has 3 warning(s); its budget entry expired after ${DUE}`,
    )
    expect(full.err).not.toContain('unbudgeted')

    const accept = await run(dir, ['--accept-new-rules'], {}, '2026-10-02')
    expect(accept.code).toBe(EXIT_LINT_FAILURE)
    expect(readRaw(dir)).toBe(original)
  })

  it('non-strict: an --ignore-pattern run keeps the entry, and the next full run fails it as expired', async () => {
    const original = owed()
    const dir = fixture({
      'a.js': THREE_CONSOLES,
      'b.js': 'export const b = 1\n',
      'lint-budget.json': original,
    })
    const subset = await run(dir, ['--ignore-pattern', 'a.js'], {}, '2026-09-30')
    expect(subset.code).toBe(EXIT_OK)
    expect(subset.out).toContain('narrowed run (--ignore-pattern a.js)')
    expect(readRaw(dir)).toBe(original)

    const full = await run(dir, [], {}, '2026-10-02')
    expect(full.code).toBe(EXIT_LINT_FAILURE)
    expect(full.err).toContain('expired: no-console')
    expect(readRaw(dir)).toBe(original)
  })

  it('a narrowed run does not record, lower or stamp either', async () => {
    const original = serializeBudget({ 'no-var': 2, 'no-console': 3 })
    const dir = fixture({ 'a.js': 'console.log(1)\n', 'lint-budget.json': original })
    const result = await run(dir, ['a.js'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).not.toMatch(/• (?:lowered|cleared|recorded|stamped)/u)
    expect(readRaw(dir)).toBe(original)
  })

  it('a narrowed run still fails what it saw: errors, over budget and expired', async () => {
    const original = owed({ strict: true })
    const dir = fixture({
      'a.js': `${THREE_CONSOLES}console.log(4)\n`,
      'b.js': 'debugger\n',
      'lint-budget.json': original,
    })
    const over = await run(dir, ['a.js'], {}, '2026-09-30')
    expect(over.code).toBe(EXIT_LINT_FAILURE)
    expect(over.err).toContain('over budget: no-console has 4 warning(s), budget is 3')
    expect((await run(dir, ['b.js'], {}, '2026-09-30')).code).toBe(EXIT_LINT_FAILURE)
    const expired = await run(dir, ['a.js'], {}, '2026-10-02')
    expect(expired.err).toContain('expired: no-console')
    expect(readRaw(dir)).toBe(original)
  })

  it('refuses --accept-new-rules on a narrowed run, since it would write', async () => {
    const original = owed({ strict: true })
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
    for (const argv of [
      ['a.js', '--accept-new-rules'],
      ['--ignore-pattern', 'b.js', '--accept-new-rules'],
    ]) {
      const result = await run(dir, argv)
      expect(result.code).toBe(EXIT_USAGE)
      expect(result.err).toContain('--accept-new-rules writes the budget')
    }
    expect(readRaw(dir)).toBe(original)
  })

  it('ci: prints the narrowed line and no ratchet notices', async () => {
    const dir = fixture({ 'a.js': 'export const a = 1\n', 'lint-budget.json': owed() })
    const result = await run(dir, ['a.js', '--ci'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('narrowed run (paths a.js)')
    expect(result.out).not.toContain('budget can ratchet')
    expect(result.out).not.toContain('is stale')
  })

  it('the package root itself is not narrowed: ".", "./" and its absolute path write', async () => {
    for (const path of ['.', './', undefined]) {
      const dir = fixture({ 'a.js': 'export const a = 1\n', 'lint-budget.json': owed() })
      const result = await run(dir, [path ?? dir])
      expect(result.code).toBe(EXIT_OK)
      expect(result.out).toContain('cleared: no-console 3 → 0')
      expect(readRaw(dir)).toBe(serializeBudget({}))
    }
  })

  it('a run from below the budget directory is narrowed', async () => {
    const original = owed()
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'b.js'), 'export const b = 1\n')
    const result = await run(join(dir, 'sub'), ['--budget', '../lint-budget.json'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain("narrowed run (not run from the budget file's directory)")
    expect(readRaw(dir)).toBe(original)
  })

  it('a run from a sibling directory pointed at the budget is narrowed', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'narduk-lint-'))
    tempDirs.push(parent)
    const pkg = join(parent, 'pkg')
    const sibling = join(parent, 'sibling')
    const original = owed({ strict: true })
    for (const [dir, files] of [
      [pkg, { 'a.js': THREE_CONSOLES, 'lint-budget.json': original }],
      [sibling, { 'b.js': 'export const b = 1\n' }],
    ] as const) {
      mkdirSync(dir)
      writeFileSync(join(dir, 'eslint.config.mjs'), CONFIG)
      for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
    }
    const result = await run(sibling, ['--budget', '../pkg/lint-budget.json'], {}, '2026-09-30')
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).not.toContain('• cleared')
    expect(result.out).toContain("narrowed run (not run from the budget file's directory)")
    expect(readFileSync(join(pkg, 'lint-budget.json'), 'utf8')).toBe(original)
    const accept = await run(sibling, ['--budget', '../pkg/lint-budget.json', '--accept-new-rules'])
    expect(accept.code).toBe(EXIT_USAGE)
    // The whole-package run afterwards still sees the original date.
    const full = await run(pkg, [], {}, '2026-10-02')
    expect(full.code).toBe(EXIT_LINT_FAILURE)
    expect(full.err).toContain(`expired after ${DUE}`)
  })

  it('compares real paths: a budget spelled through a symlink', async () => {
    const original = owed()
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'b.js'), 'export const b = 1\n')
    const link = `${dir}-link`
    symlinkSync(dir, link)
    tempDirs.push(link)
    // From a subdirectory, through the link: narrowed, nothing written.
    const narrowed = await run(join(dir, 'sub'), ['--budget', join(link, 'lint-budget.json')])
    expect(narrowed.out).toContain("narrowed run (not run from the budget file's directory)")
    expect(readRaw(dir)).toBe(original)
    // From the package itself, through the link: the same directory, so it writes.
    writeFileSync(join(dir, 'a.js'), 'export const a = 1\n')
    const whole = await run(dir, ['--budget', join(link, 'lint-budget.json')])
    expect(whole.out).toContain('cleared: no-console 3 → 0')
    expect(readRaw(dir)).toBe(serializeBudget({}))
  })

  it('"." mixed with another path, or a glob, is narrowed', async () => {
    const original = owed()
    const dir = fixture({ 'a.js': 'export const a = 1\n', 'lint-budget.json': original })
    for (const argv of [['.', 'a.js'], ['**/*.js']]) {
      const result = await run(dir, argv)
      expect(result.code).toBe(EXIT_OK)
      expect(result.out).toContain(`narrowed run (paths ${argv.join(' ')})`)
      expect(readRaw(dir)).toBe(original)
    }
  })

  it('a run inside a package with no budget of its own writes no stray budget', async () => {
    const original = owed()
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': original })
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'b.js'), 'console.log(1)\n')
    const result = await run(join(dir, 'sub'))
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('narrowed run (inside the package of ')
    expect(() => readFileSync(join(dir, 'sub', 'lint-budget.json'))).toThrow()
    expect(readRaw(dir)).toBe(original)
  })

  it('a run with a lint error never writes: a parse error hides its warnings', async () => {
    const original = owed()
    const dir = fixture({ 'a.js': 'console.log(1\n', 'lint-budget.json': original })
    const result = await run(dir, [], {}, '2026-09-30')
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.out).not.toContain('• cleared')
    expect(result.out).toContain('this run has lint errors, so lint-budget.json is not ratcheted')
    expect(readRaw(dir)).toBe(original)
  })
})

describe('evaluateExpiry', () => {
  it('keeps, stamps, flags and expires each entry', () => {
    const verdict = budgetModule.evaluateExpiry(
      { live: 2, late: 1, legacy: 4, fresh: 3, gone: 0 },
      { live: 2, late: 1, legacy: 4, gone: 5 },
      { live: '2026-10-01', late: '2026-09-27', gone: '2026-09-30' },
      { live: 2, late: 1, legacy: 4, fresh: 3 },
      { today: TODAY, stampUnstamped: false },
    )
    expect(verdict.owed).toEqual([{ ruleId: 'live', count: 2, expires: '2026-10-01' }])
    expect(verdict.expired).toEqual([{ ruleId: 'late', count: 1, expires: '2026-09-27' }])
    expect(verdict.unstamped).toEqual([{ ruleId: 'legacy', count: 4 }])
    expect(verdict.blocked).toEqual([{ ruleId: 'legacy', count: 4 }])
    expect(verdict.stamped).toEqual([{ ruleId: 'fresh', expires: STAMPED }])
    expect(verdict.nextExpires).toEqual({ fresh: STAMPED, late: '2026-09-27', live: '2026-10-01' })
  })

  it('stamps an unstamped entry only when asked to', () => {
    const verdict = budgetModule.evaluateExpiry(
      { legacy: 4 },
      { legacy: 4 },
      {},
      { legacy: 4 },
      { today: TODAY, stampUnstamped: true },
    )
    expect(verdict.blocked).toEqual([])
    expect(verdict.nextExpires).toEqual({ legacy: STAMPED })
  })

  it('an expiry date is the last day that passes', () => {
    const check = (today: string) =>
      budgetModule.evaluateExpiry(
        { r: 1 },
        { r: 1 },
        { r: STAMPED },
        { r: 1 },
        {
          today,
          stampUnstamped: false,
        },
      ).expired.length
    expect(check(STAMPED)).toBe(0)
    expect(check('2026-10-06')).toBe(1)
  })

  it('isIsoDate accepts only real calendar dates', () => {
    expect(budgetModule.isIsoDate('2028-02-29')).toBe(true)
    expect(budgetModule.isIsoDate('2026-02-29')).toBe(false)
    expect(budgetModule.isIsoDate('2026-9-28')).toBe(false)
    expect(budgetModule.isIsoDate(null)).toBe(false)
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
    expect(serializeBudget({}, { strict: true, maxWarnings: 10 })).toBe(
      '{\n  "strict": true,\n  "maxWarnings": 10,\n  "rules": {}\n}\n',
    )
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
