// @ts-check
/**
 * `narduk-lint` — ESLint, strict: 0 errors, 0 warnings.
 *
 * Any warning fails the run, exactly like `eslint . --max-warnings 0`, whether
 * or not a `lint-budget.json` exists. Warning budgets are retired (Logan,
 * 2026-10-01; see DESIGN.md "Strict, no budgets"):
 *
 * - an **error** fails;
 * - a **warning** fails, whatever rule it comes from and however new that rule
 *   is. Shipping a new warn-level rule in this package therefore turns every
 *   consumer that has a violation red on upgrade; that is the intended
 *   trade-off, and there is no opt-in pack to hide behind;
 * - a `lint-budget.json` that still lists an entry allowing warnings (a rule
 *   count above 0, or a `maxWarnings` above 0) fails with a message telling the
 *   app to fix those warnings and delete the entries. The file is otherwise
 *   obsolete: an empty one (`"rules": {}`, any `strict`) passes with a notice to
 *   delete it, and a missing one is the normal state;
 * - narduk-lint never writes a file. There is no ratchet, no recording and no
 *   expiry to keep, so nothing can widen a budget.
 *
 * Exit codes: 0 pass; 1 a lint error, any warning, or a budget file that still
 * allows warnings; 2 usage or configuration error (bad flag, unreadable budget
 * file, ESLint crash).
 */

import { existsSync, readFileSync } from 'node:fs'
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

ESLint, strict: any error or warning fails (exit 1). There is no warning budget.

Options:
  --budget <path>         Where to look for an obsolete budget file
                          (default: ./lint-budget.json). One that still allows
                          warnings fails the run: fix the warnings, delete the entries
  --fix                   Apply ESLint autofixes before counting
  --cache                 Use the ESLint cache
  --cache-location <path> ESLint cache location
  --ignore-pattern <glob> Extra ignore pattern (repeatable)
  --verbose               Accepted and ignored: every warning is always printed
  --ci, --local, --no-write
                          Accepted and ignored: narduk-lint never writes a file
  -h, --help              Show this help

Exit codes: 0 pass, 1 a lint error, any warning, or a lint-budget.json that still
allows warnings, 2 usage/config error.`

/**
 * @typedef {object} ParsedArgs
 * @property {string[]} patterns
 * @property {string | undefined} budgetPath
 * @property {boolean} fix
 * @property {boolean} cache
 * @property {string | undefined} cacheLocation
 * @property {string[]} ignorePatterns
 * @property {boolean} help
 */

export class UsageError extends Error {}

/** Flags older narduk-lint versions took that no longer change anything. */
const IGNORED_FLAGS = new Set(['--ci', '--local', '--no-write', '--verbose'])

/**
 * @param {string[]} argv
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  /** @type {ParsedArgs} */
  const parsed = {
    patterns: [],
    budgetPath: undefined,
    fix: false,
    cache: false,
    cacheLocation: undefined,
    ignorePatterns: [],
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
    if (IGNORED_FLAGS.has(argument)) continue
    switch (argument) {
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
      case '-h':
      case '--help': {
        parsed.help = true
        break
      }
      default: {
        if (argument === '--accept-new-rules') {
          throw new UsageError(
            '--accept-new-rules is removed: narduk-lint no longer records warnings. Fix them; every warning fails.',
          )
        }
        if (argument.startsWith('--max-warnings')) {
          throw new UsageError(
            '--max-warnings is not supported: narduk-lint already fails every warning (0 errors, 0 warnings)',
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

/**
 * Read a budget file only to find what it still allows. A missing file is
 * normal and allows nothing.
 *
 * @param {string} budgetPath
 * @returns {{ exists: boolean, entries: string[] }}  `entries` describes each
 *   thing in the file that allows a warning, e.g. `rule-id (3)`, `maxWarnings 10`
 */
export function readBudget(budgetPath) {
  if (!existsSync(budgetPath)) return { exists: false, entries: [] }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(budgetPath, 'utf8'))
  } catch (error) {
    throw new UsageError(
      `${budgetPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError(`${budgetPath} must be a JSON object`)
  }
  /** @type {string[]} */
  const entries = []
  const rules = parsed.rules ?? {}
  if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
    for (const [ruleId, value] of Object.entries(rules)) {
      // Anything but an explicit 0 allows a warning, malformed values included.
      if (value !== 0) entries.push(`${ruleId} (${JSON.stringify(value)})`)
    }
  } else {
    throw new UsageError(`${budgetPath}: "rules" must be an object`)
  }
  if (Object.hasOwn(parsed, 'maxWarnings') && parsed.maxWarnings !== 0) {
    entries.push(`maxWarnings ${JSON.stringify(parsed.maxWarnings)}`)
  }
  return { exists: true, entries }
}

/** @param {Record<string, number>} counts */
export function sumCounts(counts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
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
 * @typedef {object} RunOptions
 * @property {string} [cwd]
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
  const log = options.log ?? ((line) => process.stdout.write(`${line}\n`))
  const logError = options.logError ?? ((line) => process.stderr.write(`${line}\n`))

  let args
  let budgetPath
  let budget
  try {
    args = parseArgs(argv)
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

  // Every error and every warning is printed, in ESLint's own format: a
  // warning fails the run, so the person fixing it needs to see it.
  if (results.some((result) => result.messages.length > 0)) {
    const formatter = await eslint.loadFormatter('stylish')
    const text = await formatter.format(results)
    if (text.trim()) log(text.trimEnd())
  }

  const { byRule, errorCount } = tallyWarnings(results, cwd)
  const totalWarnings = [...byRule.values()].reduce((sum, list) => sum + list.length, 0)
  const budgetLabel = relative(cwd, budgetPath) || budgetPath

  log(
    `narduk-lint: ${results.length} files, ${errorCount} error(s), ${totalWarnings} warning(s) across ${byRule.size} rule(s)`,
  )

  if (totalWarnings > 0) {
    for (const [ruleId, list] of [...byRule].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    )) {
      logError(`✖ ${ruleId}: ${list.length} warning(s)`)
    }
    logError(
      'narduk-lint: any warning fails (0 errors, 0 warnings). Fix them; a warning is never recorded or budgeted.',
    )
  }

  if (budget.entries.length > 0) {
    logError(
      `✖ ${budgetLabel} still allows warnings: ${budget.entries.join(', ')}. Warning budgets are retired and no longer permit anything: fix those warnings, delete the entries (or the whole file) and commit.`,
    )
  } else if (budget.exists) {
    log(`• ${budgetLabel} is obsolete (it allows nothing); delete it.`)
  }

  return errorCount > 0 || totalWarnings > 0 || budget.entries.length > 0
    ? EXIT_LINT_FAILURE
    : EXIT_OK
}
