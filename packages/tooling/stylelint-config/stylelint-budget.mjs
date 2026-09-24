// @ts-check
/**
 * `narduk-stylelint` — Stylelint with a checked-in, ratcheting warning budget.
 *
 * Same model as `narduk-lint` (#531): rules are warn-level, errors always fail,
 * and warnings are held to `stylelint-budget.json` (per rule and per file).
 * Local runs ratchet counts down, never up. CI (`CI=true` or `--ci`) never
 * writes the file.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import stylelint from 'stylelint'

export const BUDGET_FILENAME = 'stylelint-budget.json'
/** CSS and SCSS only. Vue SFCs need `customSyntax` and are not in the default glob. */
export const DEFAULT_LINT_GLOBS = ['**/*.{css,scss}']
export const EXIT_OK = 0
export const EXIT_LINT_FAILURE = 1
export const EXIT_USAGE = 2

const USAGE = `Usage: narduk-stylelint [paths...] [options]

Stylelint with a checked-in warning budget (stylelint-budget.json).

Options:
  --ci                    CI mode: never write the budget file (default when CI=true)
  --local                 Force local mode even when CI=true
  --no-write              Local mode, but do not rewrite the budget file
  --accept-new-rules      Local mode: record rules/files that have no budget entry
  --budget <path>         Budget file (default: ./stylelint-budget.json)
  --verbose               Print every warning, not only errors
  -h, --help              Show this help

Exit codes: 0 pass, 1 lint errors or over budget, 2 usage/config error.`

class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 */
function parseArgs(argv, env) {
  /** @type {{ patterns: string[], ci: boolean, write: boolean, acceptNewRules: boolean, budgetPath: string, verbose: boolean, help: boolean }} */
  const args = {
    patterns: [],
    ci: env.CI === 'true',
    write: true,
    acceptNewRules: false,
    budgetPath: BUDGET_FILENAME,
    verbose: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '-h' || arg === '--help') args.help = true
    else if (arg === '--ci') args.ci = true
    else if (arg === '--local') args.ci = false
    else if (arg === '--no-write') args.write = false
    else if (arg === '--accept-new-rules') args.acceptNewRules = true
    else if (arg === '--verbose') args.verbose = true
    else if (arg === '--budget') {
      const value = argv[++index]
      if (!value) throw new UsageError('--budget requires a path')
      args.budgetPath = value
    } else if (arg.startsWith('--')) throw new UsageError(`Unknown option: ${arg}`)
    else args.patterns.push(arg)
  }
  if (args.ci) args.write = false
  return args
}

/**
 * @param {string} path
 * @returns {{ exists: boolean, strict: boolean, rules: Record<string, number>, files: Record<string, number> }}
 */
function readBudget(path) {
  if (!existsSync(path)) return { exists: false, strict: false, rules: {}, files: {} }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new UsageError(`unreadable budget file: ${path}`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new UsageError(`${path} must be an object`)
  }
  const rules = parsed.rules ?? {}
  const files = parsed.files ?? {}
  if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
    throw new UsageError(`${path} "rules" must be an object`)
  }
  if (typeof files !== 'object' || files === null || Array.isArray(files)) {
    throw new UsageError(`${path} "files" must be an object`)
  }
  for (const [key, value] of Object.entries({ ...rules, ...files })) {
    if (!Number.isInteger(value) || value < 0) {
      throw new UsageError(`${path} budget for ${key} must be a non-negative integer`)
    }
  }
  return {
    exists: true,
    strict: parsed.strict === true,
    rules,
    files,
  }
}

/**
 * @param {Record<string, number>} counts
 * @param {Record<string, number>} budget
 * @param {{ strict: boolean }} options
 */
function evaluateBudget(counts, budget, options) {
  /** @type {Array<{ id: string, count: number, budget: number }>} */
  const overBudget = []
  /** @type {Array<{ id: string, count: number, budget: number }>} */
  const lowered = []
  /** @type {Array<{ id: string, count: number }>} */
  const unbudgeted = []
  /** @type {Array<{ id: string, budget: number }>} */
  const cleared = []
  /** @type {Record<string, number>} */
  const nextBudget = { ...budget }

  for (const [id, count] of Object.entries(counts)) {
    if (!(id in budget)) {
      unbudgeted.push({ id, count })
      if (!options.strict) nextBudget[id] = count
      continue
    }
    const allowed = budget[id]
    if (count > allowed) overBudget.push({ id, count, budget: allowed })
    else if (count < allowed) {
      lowered.push({ id, count, budget: allowed })
      nextBudget[id] = count
    }
  }
  for (const id of Object.keys(budget)) {
    if ((counts[id] ?? 0) === 0) {
      cleared.push({ id, budget: budget[id] })
      delete nextBudget[id]
    }
  }
  const blocked = options.strict ? unbudgeted : []
  const recorded = options.strict ? [] : unbudgeted
  const stale = lowered.length > 0 || recorded.length > 0 || cleared.length > 0
  return { overBudget, lowered, unbudgeted, blocked, recorded, cleared, nextBudget, stale }
}

/**
 * @param {string} cwd
 * @param {import('stylelint').LintResult[]} results
 */
function tally(cwd, results) {
  /** @type {Record<string, number>} */
  const rules = {}
  /** @type {Record<string, number>} */
  const files = {}
  let errorCount = 0
  for (const result of results) {
    const file = relative(cwd, result.source ?? '') || result.source || ''
    for (const warning of result.warnings) {
      if (warning.severity === 'error') {
        errorCount += 1
        continue
      }
      const rule = warning.rule || 'stylelint/no-rule'
      rules[rule] = (rules[rule] ?? 0) + 1
      files[file] = (files[file] ?? 0) + 1
    }
  }
  return { rules, files, errorCount }
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, log?: (line: string) => void, logError?: (line: string) => void }} [options]
 */
export async function runNardukStylelint(argv, options = {}) {
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

  const { rules, files, errorCount } = tally(cwd, linted.results)
  const strict = budget.strict && !args.acceptNewRules
  const ruleVerdict = evaluateBudget(rules, budget.rules, { strict })
  const fileVerdict = evaluateBudget(files, budget.files, { strict })
  const budgetLabel = relative(cwd, budgetPath) || budgetPath
  const mode = args.ci ? 'ci' : 'local'
  const totalWarnings = Object.values(rules).reduce((sum, count) => sum + count, 0)
  log(
    `narduk-stylelint (${mode}): ${linted.results.length} files, ${errorCount} error(s), ${totalWarnings} warning(s)`,
  )

  if (args.verbose || errorCount > 0) {
    const text = typeof linted.report === 'string' ? linted.report.trim() : ''
    if (text) log(text)
  }

  /**
   * @param {string} kind
   * @param {ReturnType<typeof evaluateBudget>} verdict
   */
  const report = (kind, verdict) => {
    for (const { id, count, budget: allowed } of verdict.overBudget) {
      logError(`✖ over budget (${kind}): ${id} has ${count} warning(s), budget is ${allowed}`)
    }
    for (const { id, count } of verdict.blocked) {
      logError(`✖ unbudgeted (${kind}): ${id} has ${count} warning(s) and no budget entry`)
    }
  }
  report('rule', ruleVerdict)
  report('file', fileVerdict)

  const stale = ruleVerdict.stale || fileVerdict.stale
  if (args.ci) {
    if (stale)
      log(`  ${budgetLabel} is stale; run \`pnpm lint\` locally and commit ${budgetLabel}.`)
  } else if (stale && args.write) {
    const next = {
      ...(budget.strict ? { strict: true } : {}),
      rules: ruleVerdict.nextBudget,
      files: fileVerdict.nextBudget,
    }
    writeFileSync(budgetPath, `${JSON.stringify(next, null, 2)}\n`)
    log(`  updated ${budgetLabel}; commit it.`)
  }

  if (
    errorCount > 0 ||
    ruleVerdict.overBudget.length > 0 ||
    fileVerdict.overBudget.length > 0 ||
    ruleVerdict.blocked.length > 0 ||
    fileVerdict.blocked.length > 0
  ) {
    return EXIT_LINT_FAILURE
  }
  return EXIT_OK
}

export { evaluateBudget, parseArgs, readBudget, tally }
