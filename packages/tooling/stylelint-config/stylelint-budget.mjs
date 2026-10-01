// @ts-check
/**
 * `narduk-stylelint` — Stylelint, strict: 0 errors, 0 warnings.
 *
 * Same contract as `narduk-lint` (see @narduk-enterprises/eslint-config
 * DESIGN.md, "Strict, no budgets"; Logan, 2026-10-01). Any warning fails, like
 * `stylelint --max-warnings 0`, whether or not a `stylelint-budget.json`
 * exists. A `stylelint-budget.json` that still lists an entry allowing warnings
 * (a rule or file count above 0) fails with a message telling the app to fix
 * those warnings and delete the entries; an empty one passes with a notice to
 * delete it. This tool never writes a file.
 */

import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import stylelint from 'stylelint'

export const BUDGET_FILENAME = 'stylelint-budget.json'
/** CSS and SCSS only. Vue SFCs need `customSyntax` and are not in the default glob. */
export const DEFAULT_LINT_GLOBS = ['**/*.{css,scss}']
export const EXIT_OK = 0
export const EXIT_LINT_FAILURE = 1
export const EXIT_USAGE = 2

const USAGE = `Usage: narduk-stylelint [paths...] [options]

Stylelint, strict: any error or warning fails (exit 1). There is no warning budget.

Options:
  --budget <path>         Where to look for an obsolete budget file
                          (default: ./stylelint-budget.json). One that still allows
                          warnings fails the run: fix the warnings, delete the entries
  --verbose               Accepted and ignored: every warning is always printed
  --ci, --local, --no-write
                          Accepted and ignored: narduk-stylelint never writes a file
  -h, --help              Show this help

Exit codes: 0 pass, 1 a lint error, any warning, or a stylelint-budget.json that
still allows warnings, 2 usage/config error.`

class UsageError extends Error {}

/** Flags older narduk-stylelint versions took that no longer change anything. */
const IGNORED_FLAGS = new Set(['--ci', '--local', '--no-write', '--verbose'])

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ patterns: string[], budgetPath: string, help: boolean }} */
  const args = { patterns: [], budgetPath: BUDGET_FILENAME, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (IGNORED_FLAGS.has(arg)) continue
    if (arg === '-h' || arg === '--help') args.help = true
    else if (arg === '--accept-new-rules') {
      throw new UsageError(
        '--accept-new-rules is removed: narduk-stylelint no longer records warnings. Fix them; every warning fails.',
      )
    } else if (arg === '--budget') {
      const value = argv[++index]
      if (!value) throw new UsageError('--budget requires a path')
      args.budgetPath = value
    } else if (arg.startsWith('--')) throw new UsageError(`Unknown option: ${arg}`)
    else args.patterns.push(arg)
  }
  return args
}

/**
 * Read a budget file only to find what it still allows. A missing file is
 * normal and allows nothing.
 *
 * @param {string} path
 * @returns {{ exists: boolean, entries: string[] }}  `entries` describes each
 *   rule or file entry that allows a warning, e.g. `narduk/no-raw-z-index (2)`
 */
function readBudget(path) {
  if (!existsSync(path)) return { exists: false, entries: [] }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new UsageError(`unreadable budget file: ${path}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UsageError(`${path} must be an object`)
  }
  /** @type {string[]} */
  const entries = []
  for (const key of ['rules', 'files']) {
    const table = parsed[key] ?? {}
    if (typeof table !== 'object' || table === null || Array.isArray(table)) {
      throw new UsageError(`${path} "${key}" must be an object`)
    }
    for (const [id, value] of Object.entries(table)) {
      // Anything but an explicit 0 allows a warning, malformed values included.
      if (value !== 0) entries.push(`${id} (${JSON.stringify(value)})`)
    }
  }
  return { exists: true, entries }
}

/** @param {import('stylelint').LintResult[]} results */
function tally(results) {
  /** @type {Record<string, number>} */
  const rules = {}
  let errorCount = 0
  for (const result of results) {
    for (const warning of result.warnings) {
      if (warning.severity === 'error') {
        errorCount += 1
        continue
      }
      const rule = warning.rule || 'stylelint/no-rule'
      rules[rule] = (rules[rule] ?? 0) + 1
    }
  }
  return { rules, errorCount }
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, log?: (line: string) => void, logError?: (line: string) => void }} [options]
 */
export async function runNardukStylelint(argv, options = {}) {
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
    budgetPath = resolve(cwd, args.budgetPath)
    budget = readBudget(budgetPath)
  } catch (error) {
    if (error instanceof UsageError) {
      logError(`narduk-stylelint: ${error.message}`)
      return EXIT_USAGE
    }
    throw error
  }

  let linted
  try {
    linted = await stylelint.lint({
      cwd,
      files: args.patterns.length > 0 ? args.patterns : DEFAULT_LINT_GLOBS,
      formatter: 'string',
    })
  } catch (error) {
    logError(
      `narduk-stylelint: Stylelint failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return EXIT_USAGE
  }

  const { rules, errorCount } = tally(linted.results)
  const totalWarnings = Object.values(rules).reduce((sum, count) => sum + count, 0)
  const budgetLabel = relative(cwd, budgetPath) || budgetPath
  log(
    `narduk-stylelint: ${linted.results.length} files, ${errorCount} error(s), ${totalWarnings} warning(s)`,
  )

  // Every error and every warning is printed: a warning fails the run, so the
  // person fixing it needs to see it.
  if (errorCount > 0 || totalWarnings > 0) {
    const text = typeof linted.report === 'string' ? linted.report.trim() : ''
    if (text) log(text)
  }
  if (totalWarnings > 0) {
    for (const [rule, count] of Object.entries(rules).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )) {
      logError(`✖ ${rule}: ${count} warning(s)`)
    }
    logError(
      'narduk-stylelint: any warning fails (0 errors, 0 warnings). Fix them; a warning is never recorded or budgeted.',
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

export { parseArgs, readBudget, tally }
