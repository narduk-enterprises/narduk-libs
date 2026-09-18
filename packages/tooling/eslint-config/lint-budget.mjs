// @ts-check
/**
 * `narduk-lint` — ESLint with a checked-in, ratcheting warning budget.
 *
 * Replaces `eslint . --max-warnings 0`. The zero-warning gate made every new
 * warn-level rule in this package a breaking change for every consumer, so new
 * rules had to ride in a separate opt-in pack that somebody then had to track
 * and switch on by hand. With a budget:
 *
 * - an **error** always fails;
 * - a warn-level rule **over** its recorded budget fails, naming the rule, the
 *   count, the budget and the first offending locations;
 * - a warn-level rule with **no** budget entry passes and is reported as
 *   unbudgeted — so shipping a new warn rule never turns a consumer red;
 * - locally (the default) the budget file is rewritten whenever a count went
 *   **down** or a rule is unbudgeted: entries are lowered or recorded, never
 *   raised, and deleted when they reach zero. Committing that file is the
 *   ratchet;
 * - in CI (`--ci`, or `CI=true`) the file is never written, and a stale budget
 *   (lower counts, unbudgeted rules) is a notice, not a failure — nobody has to
 *   intervene for the build to stay green.
 *
 * Budget file: `lint-budget.json` in the directory narduk-lint runs from (the
 * package root; override with `--budget <path>`):
 *
 * ```json
 * { "rules": { "@typescript-eslint/no-explicit-any": 12 } }
 * ```
 *
 * Exit codes: 0 pass; 1 lint errors or a rule over budget; 2 usage or
 * configuration error (bad flag, unreadable budget file, ESLint crash).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import { ESLint } from 'eslint'

export const BUDGET_FILENAME = 'lint-budget.json'
export const EXIT_OK = 0
export const EXIT_LINT_FAILURE = 1
export const EXIT_USAGE = 2

/** Key used for warnings ESLint itself reports with no rule id. */
export const UNUSED_DIRECTIVE_KEY = 'eslint/unused-disable-directive'
export const NO_RULE_KEY = 'eslint/no-rule'

const USAGE = `Usage: narduk-lint [paths...] [options]

ESLint with a checked-in warning budget (lint-budget.json).

Options:
  --ci                    CI mode: never write the budget file (default when CI=true)
  --local                 Force local mode even when CI=true
  --no-write              Local mode, but do not rewrite the budget file
  --budget <path>         Budget file (default: ./lint-budget.json)
  --fix                   Apply ESLint autofixes before counting
  --cache                 Use the ESLint cache
  --cache-location <path> ESLint cache location
  --ignore-pattern <glob> Extra ignore pattern (repeatable)
  --verbose               Print every warning, not only errors
  -h, --help              Show this help

Exit codes: 0 pass, 1 lint errors or a rule over budget, 2 usage/config error.`

/**
 * @typedef {object} ParsedArgs
 * @property {string[]} patterns
 * @property {boolean} ci
 * @property {boolean} write
 * @property {string | undefined} budgetPath
 * @property {boolean} fix
 * @property {boolean} cache
 * @property {string | undefined} cacheLocation
 * @property {string[]} ignorePatterns
 * @property {boolean} verbose
 * @property {boolean} help
 */

/** @param {Record<string, string | undefined>} env */
export function isCiEnvironment(env) {
  const value = env.CI
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {ParsedArgs}
 */
export function parseArgs(argv, env = {}) {
  /** @type {ParsedArgs} */
  const parsed = {
    patterns: [],
    ci: isCiEnvironment(env),
    write: true,
    budgetPath: undefined,
    fix: false,
    cache: false,
    cacheLocation: undefined,
    ignorePatterns: [],
    verbose: false,
    help: false,
  }

  /** @param {number} index @param {string} flag */
  const valueAfter = (index, flag) => {
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`${flag} requires a value`)
    }
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case '--ci': {
        parsed.ci = true
        break
      }
      case '--local': {
        parsed.ci = false
        break
      }
      case '--no-write': {
        parsed.write = false
        break
      }
      case '--budget': {
        parsed.budgetPath = valueAfter(index, argument)
        index += 1
        break
      }
      case '--fix': {
        parsed.fix = true
        break
      }
      case '--cache': {
        parsed.cache = true
        break
      }
      case '--cache-location': {
        parsed.cacheLocation = valueAfter(index, argument)
        index += 1
        break
      }
      case '--ignore-pattern': {
        parsed.ignorePatterns.push(valueAfter(index, argument))
        index += 1
        break
      }
      case '--verbose': {
        parsed.verbose = true
        break
      }
      case '-h':
      case '--help': {
        parsed.help = true
        break
      }
      default: {
        if (argument.startsWith('--max-warnings')) {
          throw new UsageError(
            '--max-warnings is not supported: warning limits live in lint-budget.json',
          )
        }
        if (argument.startsWith('-')) {
          throw new UsageError(`Unknown option: ${argument}`)
        }
        parsed.patterns.push(argument)
      }
    }
  }

  if (parsed.patterns.length === 0) parsed.patterns.push('.')
  return parsed
}

export class UsageError extends Error {}

/**
 * Read and validate a budget file. A missing file is an empty budget.
 *
 * @param {string} budgetPath
 * @returns {{ exists: boolean, rules: Record<string, number> }}
 */
export function readBudget(budgetPath) {
  if (!existsSync(budgetPath)) return { exists: false, rules: {} }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(budgetPath, 'utf8'))
  } catch (error) {
    throw new UsageError(
      `${budgetPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError(`${budgetPath} must be an object of the form { "rules": { ... } }`)
  }
  const rules = parsed.rules ?? {}
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    throw new UsageError(`${budgetPath}: "rules" must be an object`)
  }
  for (const [ruleId, value] of Object.entries(rules)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new UsageError(
        `${budgetPath}: budget for "${ruleId}" must be a non-negative integer, got ${JSON.stringify(value)}`,
      )
    }
  }
  return { exists: true, rules: /** @type {Record<string, number>} */ (rules) }
}

/**
 * Serialize a budget with sorted keys, two-space indentation and a trailing
 * newline — byte-identical to what Prettier produces for the same object.
 *
 * @param {Record<string, number>} rules
 */
export function serializeBudget(rules) {
  const sorted = Object.fromEntries(
    Object.keys(rules)
      .sort()
      .map((ruleId) => [ruleId, rules[ruleId]]),
  )
  return `${JSON.stringify({ rules: sorted }, null, 2)}\n`
}

/**
 * @typedef {object} WarningLocation
 * @property {string} file
 * @property {number} line
 */

/**
 * Tally warnings per rule and collect their locations.
 *
 * @param {import('eslint').ESLint.LintResult[]} results
 * @param {string} cwd
 */
export function tallyWarnings(results, cwd) {
  /** @type {Map<string, WarningLocation[]>} */
  const byRule = new Map()
  let errorCount = 0
  for (const result of results) {
    for (const message of result.messages) {
      if (message.severity === 2) {
        errorCount += 1
        continue
      }
      if (message.severity !== 1) continue
      const key =
        message.ruleId ??
        (/eslint-(?:disable|enable)/.test(message.message) ? UNUSED_DIRECTIVE_KEY : NO_RULE_KEY)
      const locations = byRule.get(key) ?? []
      locations.push({
        file: relative(cwd, result.filePath) || result.filePath,
        line: message.line,
      })
      byRule.set(key, locations)
    }
  }
  return { byRule, errorCount }
}

/**
 * The first `limit` locations for a rule, most-affected files first.
 *
 * @param {WarningLocation[]} locations
 * @param {number} [limit]
 */
export function topLocations(locations, limit = 5) {
  /** @type {Map<string, number>} */
  const perFile = new Map()
  for (const { file } of locations) perFile.set(file, (perFile.get(file) ?? 0) + 1)
  return [...locations]
    .sort(
      (a, b) =>
        (perFile.get(b.file) ?? 0) - (perFile.get(a.file) ?? 0) ||
        a.file.localeCompare(b.file) ||
        a.line - b.line,
    )
    .slice(0, limit)
    .map(({ file, line }) => `${file}:${line}`)
}

/**
 * Compare observed warning counts to the budget. Pure: decides, never writes.
 *
 * @param {Record<string, number>} counts  observed warnings per rule
 * @param {Record<string, number>} budget  recorded budget per rule
 */
export function evaluateBudget(counts, budget) {
  /** @type {Array<{ ruleId: string, count: number, budget: number }>} */
  const overBudget = []
  /** @type {Array<{ ruleId: string, count: number, budget: number }>} */
  const lowered = []
  /** @type {Array<{ ruleId: string, count: number }>} */
  const unbudgeted = []
  /** @type {Array<{ ruleId: string, budget: number }>} */
  const cleared = []

  /** @type {Record<string, number>} */
  const nextBudget = { ...budget }

  for (const ruleId of Object.keys(counts).sort()) {
    const count = counts[ruleId]
    if (count <= 0) continue
    if (!Object.hasOwn(budget, ruleId)) {
      unbudgeted.push({ ruleId, count })
      nextBudget[ruleId] = count
      continue
    }
    const allowed = budget[ruleId]
    if (count > allowed) {
      // Never raised: the recorded budget stays where it is.
      overBudget.push({ ruleId, count, budget: allowed })
    } else if (count < allowed) {
      lowered.push({ ruleId, count, budget: allowed })
      nextBudget[ruleId] = count
    }
  }

  for (const ruleId of Object.keys(budget).sort()) {
    if ((counts[ruleId] ?? 0) === 0) {
      cleared.push({ ruleId, budget: budget[ruleId] })
      delete nextBudget[ruleId]
    }
  }

  const stale = lowered.length > 0 || unbudgeted.length > 0 || cleared.length > 0
  return { overBudget, lowered, unbudgeted, cleared, nextBudget, stale }
}

/**
 * @typedef {object} RunOptions
 * @property {string} [cwd]
 * @property {Record<string, string | undefined>} [env]
 * @property {(line: string) => void} [log]
 * @property {(line: string) => void} [logError]
 */

/**
 * Run narduk-lint. Returns the process exit code; never calls `process.exit`.
 *
 * @param {string[]} argv
 * @param {RunOptions} [options]
 * @returns {Promise<number>}
 */
export async function runNardukLint(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const log = options.log ?? ((line) => process.stdout.write(`${line}\n`))
  const logError = options.logError ?? ((line) => process.stderr.write(`${line}\n`))

  let args
  let budgetPath
  let budget
  try {
    args = parseArgs(argv, env)
    if (args.help) {
      log(USAGE)
      return EXIT_OK
    }
    budgetPath = resolve(cwd, args.budgetPath ?? BUDGET_FILENAME)
    budget = readBudget(budgetPath)
  } catch (error) {
    if (error instanceof UsageError) {
      logError(`narduk-lint: ${error.message}`)
      return EXIT_USAGE
    }
    throw error
  }

  let results
  let eslint
  try {
    eslint = new ESLint({
      cwd,
      fix: args.fix,
      cache: args.cache,
      ...(args.cacheLocation ? { cacheLocation: args.cacheLocation } : {}),
      ...(args.ignorePatterns.length > 0 ? { ignorePatterns: args.ignorePatterns } : {}),
    })
    results = await eslint.lintFiles(args.patterns)
    if (args.fix) await ESLint.outputFixes(results)
  } catch (error) {
    logError(
      `narduk-lint: ESLint failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return EXIT_USAGE
  }

  // Print errors (always) and warnings (only with --verbose) in ESLint's own format.
  const printable = args.verbose
    ? results
    : ESLint.getErrorResults(results).map((result) => ({ ...result, warningCount: 0 }))
  if (printable.some((result) => result.messages.length > 0)) {
    const formatter = await eslint.loadFormatter('stylish')
    const text = await formatter.format(printable)
    if (text.trim()) log(text.trimEnd())
  }

  const { byRule, errorCount } = tallyWarnings(results, cwd)
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries([...byRule].map(([ruleId, list]) => [ruleId, list.length]))
  const verdict = evaluateBudget(counts, budget.rules)
  const budgetLabel = relative(cwd, budgetPath) || budgetPath
  const mode = args.ci ? 'ci' : 'local'

  const totalWarnings = Object.values(counts).reduce((sum, count) => sum + count, 0)
  log(
    `narduk-lint (${mode}): ${results.length} files, ${errorCount} error(s), ${totalWarnings} warning(s) across ${byRule.size} rule(s)`,
  )

  for (const { ruleId, count, budget: allowed } of verdict.overBudget) {
    logError(`✖ over budget: ${ruleId} has ${count} warning(s), budget is ${allowed}`)
    for (const location of topLocations(byRule.get(ruleId) ?? [])) {
      logError(`    ${location}`)
    }
  }
  for (const { ruleId, count } of verdict.unbudgeted) {
    log(`• unbudgeted: ${ruleId} has ${count} warning(s)`)
  }

  if (args.ci) {
    for (const { ruleId, count, budget: allowed } of verdict.lowered) {
      log(`• budget can ratchet: ${ruleId} ${allowed} → ${count}`)
    }
    for (const { ruleId, budget: allowed } of verdict.cleared) {
      log(`• budget can ratchet: ${ruleId} ${allowed} → 0 (entry can be removed)`)
    }
    if (verdict.stale) {
      log(`  ${budgetLabel} is stale; run \`pnpm lint\` locally and commit ${budgetLabel}.`)
    }
  } else if (verdict.stale) {
    for (const { ruleId, count, budget: allowed } of verdict.lowered) {
      log(`• lowered: ${ruleId} ${allowed} → ${count}`)
    }
    for (const { ruleId, budget: allowed } of verdict.cleared) {
      log(`• cleared: ${ruleId} ${allowed} → 0 (entry removed)`)
    }
    for (const { ruleId, count } of verdict.unbudgeted) {
      log(`• recorded: ${ruleId} = ${count}`)
    }
    if (args.write) {
      writeFileSync(budgetPath, serializeBudget(verdict.nextBudget))
      log(`  updated ${budgetLabel}; commit it.`)
    } else {
      log(`  --no-write: ${budgetLabel} left unchanged.`)
    }
  }

  if (errorCount > 0 || verdict.overBudget.length > 0) {
    if (verdict.overBudget.length > 0) {
      logError(
        `narduk-lint: ${verdict.overBudget.length} rule(s) over budget. Fix the new warnings; budgets are never raised automatically.`,
      )
    }
    return EXIT_LINT_FAILURE
  }
  return EXIT_OK
}
