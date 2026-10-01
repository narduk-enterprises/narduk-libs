import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeAll, describe, expect, it } from 'vitest'

/**
 * lint-budget.mjs is plain ESM with JSDoc types and no declaration file, so it
 * is loaded through a computed URL like the packs are (see packs.test.ts).
 *
 * The contract is strict: 0 errors, 0 warnings. Any warning fails, a budget file
 * that still allows warnings fails, and nothing is ever written.
 */
interface BudgetModule {
  EXIT_OK: number
  EXIT_LINT_FAILURE: number
  EXIT_USAGE: number
  parseArgs: (argv: string[]) => { patterns: string[]; ignorePatterns: string[]; fix: boolean }
  readBudget: (path: string) => { exists: boolean; entries: string[] }
  runNardukLint: (
    argv: string[],
    options: { cwd: string; log: (line: string) => void; logError: (line: string) => void },
  ) => Promise<number>
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

async function run(dir: string, argv: string[] = []) {
  const out: string[] = []
  const err: string[] = []
  const code = await budgetModule.runNardukLint(argv, {
    cwd: dir,
    log: (line) => out.push(line),
    logError: (line) => err.push(line),
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

const read = (dir: string, name: string) => readFileSync(join(dir, name), 'utf8')

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const THREE_CONSOLES = 'console.log(1)\nconsole.log(2)\nconsole.log(3)\n'
const CLEAN = 'export const a = 1\n'

describe('narduk-lint is strict: 0 errors, 0 warnings', () => {
  it('passes a clean tree and writes nothing', async () => {
    const dir = fixture({ 'a.js': CLEAN })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_OK)
    expect(result.out).toContain('0 error(s), 0 warning(s)')
    expect(() => read(dir, 'lint-budget.json')).toThrow()
  })

  it('fails on a lint error, even with no warnings', async () => {
    const dir = fixture({ 'a.js': 'debugger\n' })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.out).toContain('no-debugger')
    expect(result.out).toContain('1 error(s), 0 warning(s)')
  })

  it('fails on a single warning with no budget file at all', async () => {
    const dir = fixture({ 'a.js': 'console.log(1)\n' })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.out).toContain('0 error(s), 1 warning(s)')
    expect(result.out).toContain('no-console')
    expect(result.err).toContain('no-console: 1 warning(s)')
    expect(result.err).toContain('any warning fails')
    expect(() => read(dir, 'lint-budget.json')).toThrow()
  })

  it('fails on a single warning with an empty strict budget file', async () => {
    const dir = fixture({
      'a.js': 'console.log(1)\n',
      'lint-budget.json': '{ "strict": true, "rules": {} }',
    })
    expect((await run(dir)).code).toBe(EXIT_LINT_FAILURE)
  })

  it('fails on a single warning in a non-strict budget file, and in CI mode', async () => {
    const dir = fixture({ 'a.js': 'var a = 1\nexport { a }\n', 'lint-budget.json': '{}' })
    expect((await run(dir)).code).toBe(EXIT_LINT_FAILURE)
    expect((await run(dir, ['--ci'])).code).toBe(EXIT_LINT_FAILURE)
    expect((await run(dir, ['--local'])).code).toBe(EXIT_LINT_FAILURE)
  })

  it('prints every warning without --verbose', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES })
    const result = await run(dir)
    expect(result.out.match(/no-console/gu)?.length).toBeGreaterThanOrEqual(3)
  })

  it('fails the files it was pointed at and passes the clean ones', async () => {
    const dir = fixture({ 'a.js': 'console.log(1)\n', 'b.js': CLEAN })
    expect((await run(dir, ['b.js'])).code).toBe(EXIT_OK)
    expect((await run(dir, ['a.js'])).code).toBe(EXIT_LINT_FAILURE)
  })

  it('--fix applies fixes before counting', async () => {
    const dir = fixture({ 'a.js': 'var a = 1\nexport { a }\n' })
    const result = await run(dir, ['--fix'])
    expect(result.code).toBe(EXIT_OK)
    expect(read(dir, 'a.js')).toBe('let a = 1\nexport { a }\n')
    expect(result.out).toContain('0 warning(s)')
  })
})

describe('a budget file that still allows warnings', () => {
  const ENTRIES = JSON.stringify(
    {
      strict: true,
      maxWarnings: 10,
      rules: { 'no-console': 3 },
      expires: { 'no-console': '2099-01-01' },
    },
    null,
    2,
  )

  it('fails with the fix, even when the tree has no warnings', async () => {
    const dir = fixture({ 'a.js': CLEAN, 'lint-budget.json': ENTRIES })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('lint-budget.json still allows warnings')
    expect(result.err).toContain('no-console (3)')
    expect(result.err).toContain('maxWarnings 10')
    expect(result.err).toContain('fix those warnings, delete the entries')
  })

  it('does not let the entries permit the warnings they cover', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': ENTRIES })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('no-console: 3 warning(s)')
    expect(result.err).toContain('still allows warnings')
  })

  it('fails the same way in CI', async () => {
    const dir = fixture({ 'a.js': CLEAN, 'lint-budget.json': ENTRIES })
    const result = await run(dir, ['--ci'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('still allows warnings')
  })

  it('fails on a maxWarnings ceiling alone', async () => {
    const dir = fixture({
      'a.js': CLEAN,
      'lint-budget.json': '{ "strict": true, "maxWarnings": 10, "rules": {} }',
    })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('maxWarnings 10')
  })

  it('treats a malformed entry as an allowance, not as zero', async () => {
    const dir = fixture({
      'a.js': CLEAN,
      'lint-budget.json': '{ "rules": { "no-console": 1.5 } }',
    })
    expect((await run(dir)).code).toBe(EXIT_LINT_FAILURE)
  })

  it('never rewrites the file: not down, not cleared, not up', async () => {
    for (const source of [
      CLEAN,
      'console.log(1)\n',
      THREE_CONSOLES,
      'console.log(1)\n'.repeat(9),
    ]) {
      const dir = fixture({ 'a.js': source, 'lint-budget.json': ENTRIES })
      await run(dir)
      await run(dir, ['--ci'])
      await run(dir, ['--local'])
      expect(read(dir, 'lint-budget.json'), source).toBe(ENTRIES)
    }
  })

  it('never writes a new budget file either', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES })
    await run(dir)
    expect(() => read(dir, 'lint-budget.json')).toThrow()
  })

  it('--budget points at another file', async () => {
    const dir = fixture({ 'a.js': CLEAN, 'custom-budget.json': ENTRIES })
    expect((await run(dir)).code).toBe(EXIT_OK)
    const result = await run(dir, ['--budget', 'custom-budget.json'])
    expect(result.code).toBe(EXIT_LINT_FAILURE)
    expect(result.err).toContain('custom-budget.json still allows warnings')
  })
})

describe('an obsolete budget file that allows nothing', () => {
  it('passes with a notice to delete it, whatever its other keys say', async () => {
    for (const body of [
      '{}',
      '{ "strict": true, "rules": {} }',
      '{ "strict": true, "maxWarnings": 0, "rules": { "no-console": 0 } }',
    ]) {
      const dir = fixture({ 'a.js': CLEAN, 'lint-budget.json': body })
      const result = await run(dir)
      expect(result.code, body).toBe(EXIT_OK)
      expect(result.out, body).toContain('obsolete')
      expect(read(dir, 'lint-budget.json'), body).toBe(body)
    }
  })
})

describe('usage errors', () => {
  it('exits 2 on a malformed budget file', async () => {
    const dir = fixture({ 'a.js': THREE_CONSOLES, 'lint-budget.json': '{ nope' })
    const result = await run(dir)
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.err).toContain('not valid JSON')
  })

  it('exits 2 when the budget file is not an object or its rules are not', async () => {
    const dir = fixture({ 'lint-budget.json': '[]' })
    expect((await run(dir)).code).toBe(EXIT_USAGE)
    writeFileSync(join(dir, 'lint-budget.json'), '{ "rules": [] }')
    expect((await run(dir)).code).toBe(EXIT_USAGE)
  })

  it('exits 2 on --max-warnings, --accept-new-rules and unknown flags', async () => {
    const dir = fixture({ 'a.js': CLEAN })
    const maxWarnings = await run(dir, ['--max-warnings', '0'])
    expect(maxWarnings.code).toBe(EXIT_USAGE)
    expect(maxWarnings.err).toContain('already fails every warning')
    const accept = await run(dir, ['--accept-new-rules'])
    expect(accept.code).toBe(EXIT_USAGE)
    expect(accept.err).toContain('removed')
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

describe('parseArgs', () => {
  it('lints "." by default and keeps paths, --fix and --ignore-pattern', () => {
    expect(budgetModule.parseArgs([]).patterns).toEqual(['.'])
    const parsed = budgetModule.parseArgs(['src', '--fix', '--ignore-pattern', 'x.js'])
    expect(parsed.patterns).toEqual(['src'])
    expect(parsed.fix).toBe(true)
    expect(parsed.ignorePatterns).toEqual(['x.js'])
  })

  it('accepts the flags that no longer change anything', () => {
    expect(budgetModule.parseArgs(['--ci', '--local', '--no-write', '--verbose']).patterns).toEqual(
      ['.'],
    )
  })
})
