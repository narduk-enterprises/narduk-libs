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
 *   unbudgeted — so shipping a new warn rule never turns a consumer red —
 *   unless the budget file is **strict** (`"strict": true`). Then it fails,
 *   locally and in CI alike, and is recorded only when a person asks for it
 *   with `--accept-new-rules` (#673). Without strict, a rule that has never had
 *   an entry is a rule the gate cannot see, and a package with no budget file
 *   has no warning gate at all;
 * - locally (the default) the budget file is rewritten whenever a count went
 *   **down** or a rule is unbudgeted: entries are lowered or recorded, never
 *   raised, and deleted when they reach zero. A strict budget records an
 *   unbudgeted rule only under `--accept-new-rules`. Committing that file is
 *   the ratchet;
 * - only a **whole-package** run writes: its working directory is the budget
 *   file's directory (compared on real paths), it has no path other than that
 *   directory and no `--ignore-pattern`. Every other run is narrowed: it never
 *   writes the file and refuses `--accept-new-rules`, because it has not seen
 *   the rest of the package and would clear entries whose warnings it skipped
 *   (see `narrowedBy`). It still fails errors, over-budget, unbudgeted
 *   (strict), unstamped (strict) and expired entries among the files it saw;
 * - a run with any lint **error** never writes either: a file that fails to
 *   parse hides its warnings, which would clear their entries. Other failures
 *   come from complete counts and still ratchet down;
 * - in CI (`--ci`, or `CI=true`) the file is never written, and a stale budget
 *   (lower counts, unbudgeted rules) is a notice, not a failure — nobody has to
 *   intervene for the build to stay green;
 * - an optional total ceiling, `"maxWarnings": <n>`, fails the run whenever
 *   the total warning count is above n, locally and in CI alike, whatever the
 *   per-rule entries allow. No run records entries that would put the
 *   recorded total past it, `--accept-new-rules` included. Without the field
 *   there is no ceiling and nothing else changes;
 * - every entry that allows warnings carries an expiry in `"expires"`: the
 *   last UTC day its warnings pass, 7 days after the day the entry was
 *   recorded (recorded 2026-09-28 → `"2026-10-05"`, failing from 2026-10-06).
 *   After that day, an entry that still has warnings fails, locally and in CI
 *   alike. narduk-lint never moves an existing expiry: lowering, re-running
 *   `--accept-new-rules` or a hand-raised count all keep it. The entry leaves
 *   the file, date and all, only when a whole-package run sees its rule at
 *   zero; if the rule comes back, it is new debt with a new date. What this
 *   cannot stop: a hand edit, an older narduk-lint (2.6.0 and earlier ignores
 *   and drops `expires` when it rewrites the file), or a renamed rule, which
 *   is a different key. An entry with no expiry (recorded before expiries
 *   existed) is treated like a rule with no entry: a strict budget fails it
 *   until `--accept-new-rules` stamps it, and a non-strict budget stamps it on
 *   a local run.
 *
 * Budget file: `lint-budget.json` in the directory narduk-lint runs from (the
 * package root; override with `--budget <path>`):
 *
 * ```json
 * {
 *   "strict": true,
 *   "maxWarnings": 10,
 *   "rules": { "@typescript-eslint/no-explicit-any": 3 },
 *   "expires": { "@typescript-eslint/no-explicit-any": "2026-10-05" }
 * }
 * ```
 *
 * Exit codes: 0 pass; 1 lint errors, a rule over budget, (strict) a rule with
 * warnings and no entry or an entry with warnings and no expiry, an entry past
 * its expiry that still has warnings, or a total above maxWarnings; 2 usage or
 * configuration error (bad flag, unreadable budget file, ESLint crash).
 */

import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { ESLint } from 'eslint'

export const BUDGET_FILENAME = 'lint-budget.json'
export const EXIT_OK = 0
export const EXIT_LINT_FAILURE = 1
export const EXIT_USAGE = 2

/** Key used for warnings ESLint itself reports with no rule id. */
export const UNUSED_DIRECTIVE_KEY = 'eslint/unused-disable-directive'
export const NO_RULE_KEY = 'eslint/no-rule'

/** Days between recording a budget entry and its expiry (Logan, 2026-09-28). */
export const EXPIRY_DAYS = 7

const USAGE = `Usage: narduk-lint [paths...] [options]

ESLint with a checked-in warning budget (lint-budget.json).

Options:
  --ci                    CI mode: never write the budget file (default when CI=true)
  --local                 Force local mode even when CI=true
  --no-write              Local mode, but do not rewrite the budget file
  --accept-new-rules      Local mode: record rules that have no budget entry,
                          even in a strict budget, and stamp an expiry on
                          entries that have none (review the diff, then commit).
                          Needs the whole package: no paths, no --ignore-pattern
  --budget <path>         Budget file (default: ./lint-budget.json)
  --fix                   Apply ESLint autofixes before counting
  --cache                 Use the ESLint cache
  --cache-location <path> ESLint cache location
  --ignore-pattern <glob> Extra ignore pattern (repeatable)
  --verbose               Print every warning, not only errors
  -h, --help              Show this help

Only a whole-package run writes the budget: run from the budget file's
directory, with no path but that directory and no --ignore-pattern. Any other
run is narrowed and never writes (it has not seen the rest of the package's
warnings), and neither does a run with lint errors (a file that fails to parse
hides its warnings). Both still fail what they saw.

Budget file keys: "strict" (a rule with no entry fails), "maxWarnings" (a total
ceiling: more warnings than this fail, whatever the rules allow), "rules", and
"expires" (per entry, the last UTC day its warnings pass: ${EXPIRY_DAYS} days after the
day the entry was recorded. They fail from the next day, and narduk-lint never
moves the date).

Exit codes: 0 pass, 1 lint errors, a rule over budget, (strict budget) a rule
with warnings and no entry or an entry with no expiry, an entry past its expiry
that still has warnings, or more warnings than maxWarnings, 2 usage/config
error.`

/**
 * @typedef {object} ParsedArgs
 * @property {string[]} patterns
 * @property {boolean} ci
 * @property {boolean} write
 * @property {boolean} acceptNewRules
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
    acceptNewRules: false,
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
      case '--accept-new-rules': {
        parsed.acceptNewRules = true
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
            '--max-warnings is not supported: warning limits live in lint-budget.json (a total ceiling is its "maxWarnings" field)',
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
  if (parsed.acceptNewRules && (parsed.ci || !parsed.write)) {
    // Recording is a deliberate local act; a CI job must never absorb debt.
    throw new UsageError(
      '--accept-new-rules writes the budget, so it needs local mode and no --no-write',
    )
  }
  return parsed
}

export class UsageError extends Error {}

/** @param {string} path */
function realPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return undefined
  }
}

/**
 * Why this run sees less than the whole package, or `undefined` when it sees
 * all of it. The whole package is what `narduk-lint` lints with no paths from
 * the budget file's directory: ESLint's own config decides the file set, so a
 * package that must skip files says so there, not on the command line.
 *
 * Only one shape counts as whole, compared on real paths (symlinks resolved,
 * so `/tmp` and `/private/tmp` are one directory): the working directory IS
 * the budget file's directory, every path argument resolves to that same
 * directory, and there is no `--ignore-pattern`. Anything else — a sibling or
 * parent directory, a subdirectory, a path that does not exist, a glob, or
 * `.` mixed with another path — is narrowed. So is a run whose budget file
 * does not exist while a directory above it holds one: that run is inside
 * another budget's package, and writing would leave a stray, non-strict
 * budget in a subdirectory.
 *
 * A narrowed run must never write the budget. Its counts are a lower bound:
 * an entry whose warnings live in files it skipped would read as zero and be
 * cleared, and the next full run would record it again with a fresh expiry,
 * renewing a date no run is allowed to move (narduk-libs#1237). The lower bound
 * is still safe to fail on, so a narrowed run fails what it saw.
 *
 * @param {Pick<ParsedArgs, 'patterns' | 'ignorePatterns'>} args
 * @param {string} cwd
 * @param {string} budgetPath  absolute
 * @returns {string | undefined}
 */
export function narrowedBy(args, cwd, budgetPath) {
  const root = realPath(resolve(cwd))
  if (root === undefined || realPath(dirname(resolve(cwd, budgetPath))) !== root) {
    return "not run from the budget file's directory"
  }
  if (!args.patterns.every((pattern) => realPath(resolve(cwd, pattern)) === root)) {
    return `paths ${args.patterns.join(' ')}`
  }
  if (args.ignorePatterns.length > 0) {
    return `--ignore-pattern ${args.ignorePatterns.join(' ')}`
  }
  if (!existsSync(resolve(cwd, budgetPath))) {
    for (let dir = dirname(root); ; dir = dirname(dir)) {
      if (existsSync(resolve(dir, BUDGET_FILENAME))) {
        return `inside the package of ${resolve(dir, BUDGET_FILENAME)}`
      }
      if (dirname(dir) === dir) break
    }
  }
  return undefined
}

/**
 * @typedef {object} Budget
 * @property {boolean} exists
 * @property {boolean} strict
 * @property {number | undefined} maxWarnings  total ceiling; undefined = none
 * @property {Record<string, number>} rules
 * @property {Record<string, string>} expires  per-entry expiry, `YYYY-MM-DD` (UTC)
 */

/**
 * The UTC calendar date of `date`, as `YYYY-MM-DD`.
 *
 * @param {Date} date
 */
export function utcDate(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * `isoDate` plus `days` calendar days.
 *
 * @param {string} isoDate  `YYYY-MM-DD`
 * @param {number} days
 */
export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return utcDate(date)
}

/** @param {unknown} value */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && utcDate(date) === value
}

/**
 * Read and validate a budget file. A missing file is an empty, non-strict
 * budget with no ceiling.
 *
 * @param {string} budgetPath
 * @returns {Budget}
 */
export function readBudget(budgetPath) {
  if (!existsSync(budgetPath)) {
    return { exists: false, strict: false, maxWarnings: undefined, rules: {}, expires: {} }
  }
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
  const strict = parsed.strict ?? false
  if (typeof strict !== 'boolean') {
    throw new UsageError(`${budgetPath}: "strict" must be true or false`)
  }
  /** @type {number | undefined} */
  let maxWarnings
  if (Object.hasOwn(parsed, 'maxWarnings')) {
    maxWarnings = parsed.maxWarnings
    if (!Number.isInteger(maxWarnings) || /** @type {number} */ (maxWarnings) < 0) {
      throw new UsageError(
        `${budgetPath}: "maxWarnings" must be a non-negative integer, got ${JSON.stringify(parsed.maxWarnings)}`,
      )
    }
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
  const expires = parsed.expires ?? {}
  if (!expires || typeof expires !== 'object' || Array.isArray(expires)) {
    throw new UsageError(`${budgetPath}: "expires" must be an object`)
  }
  for (const [ruleId, value] of Object.entries(expires)) {
    if (!isIsoDate(value)) {
      throw new UsageError(
        `${budgetPath}: expiry for "${ruleId}" must be a YYYY-MM-DD date, got ${JSON.stringify(value)}`,
      )
    }
    if (!Object.hasOwn(rules, ruleId)) {
      throw new UsageError(
        `${budgetPath}: "expires" names "${ruleId}", which has no entry in "rules"; remove it`,
      )
    }
  }
  return {
    exists: true,
    strict,
    maxWarnings,
    rules: /** @type {Record<string, number>} */ (rules),
    expires: /** @type {Record<string, string>} */ (expires),
  }
}

/**
 * Serialize a budget with sorted keys, two-space indentation and a trailing
 * newline — byte-identical to what Prettier produces for the same object.
 *
 * Key order is fixed: `strict`, `maxWarnings`, `rules`, `expires`. `expires`
 * sits after `rules` so the counts read first, keeps only keys that still have
 * an entry, and is left out when empty, so a budget with no entries serializes
 * exactly as it did before expiries existed.
 *
 * @param {Record<string, number>} rules
 * @param {{ strict?: boolean, maxWarnings?: number, expires?: Record<string, string> }} [options]
 *   a strict budget keeps its flag, a ceiling keeps its value, and entries keep
 *   their expiries
 */
export function serializeBudget(rules, options = {}) {
  const ruleIds = Object.keys(rules).sort()
  const sorted = Object.fromEntries(ruleIds.map((ruleId) => [ruleId, rules[ruleId]]))
  const expires = options.expires ?? {}
  const sortedExpires = Object.fromEntries(
    ruleIds
      .filter((ruleId) => Object.hasOwn(expires, ruleId))
      .map((ruleId) => [ruleId, expires[ruleId]]),
  )
  const body = {
    ...(options.strict ? { strict: true } : {}),
    ...(options.maxWarnings === undefined ? {} : { maxWarnings: options.maxWarnings }),
    rules: sorted,
    ...(Object.keys(sortedExpires).length > 0 ? { expires: sortedExpires } : {}),
  }
  return `${JSON.stringify(body, null, 2)}\n`
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
 * An unbudgeted rule is `recorded` into `nextBudget` unless the budget is
 * strict, in which case it is `blocked` and fails the run (#673).
 *
 * @param {Record<string, number>} counts  observed warnings per rule
 * @param {Record<string, number>} budget  recorded budget per rule
 * @param {{ strict?: boolean }} [options]
 */
export function evaluateBudget(counts, budget, options = {}) {
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
      if (!options.strict) nextBudget[ruleId] = count
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

  const blocked = options.strict ? unbudgeted : []
  const recorded = options.strict ? [] : unbudgeted
  const stale = lowered.length > 0 || recorded.length > 0 || cleared.length > 0
  return { overBudget, lowered, unbudgeted, blocked, recorded, cleared, nextBudget, stale }
}

/**
 * Decide each entry's expiry. Pure: decides, never writes.
 *
 * - An entry that already has an expiry keeps it, whatever happened to its
 *   count. Lowering, a hand-raised count and a repeated `--accept-new-rules`
 *   never move it; only clearing the entry (its count reached zero) removes it.
 * - An entry recorded by this run (in `nextRules`, not in `rules`) is stamped
 *   `today` + EXPIRY_DAYS.
 * - An existing entry that allows warnings but has no expiry is `unstamped`.
 *   With `stampUnstamped` (a non-strict budget, or `--accept-new-rules`) it is
 *   stamped like a new entry; otherwise it is left alone and the caller fails
 *   it, the way a strict budget fails a rule with no entry.
 * - An entry whose expiry is before `today` and that still has warnings is
 *   `expired`. An expired entry is never re-stamped.
 *
 * @param {Record<string, number>} counts  observed warnings per rule
 * @param {Record<string, number>} rules  recorded entries before this run
 * @param {Record<string, string>} expires  recorded expiries before this run
 * @param {Record<string, number>} nextRules  entries after this run's ratchet and recording
 * @param {{ today: string, stampUnstamped: boolean }} options
 */
export function evaluateExpiry(counts, rules, expires, nextRules, options) {
  const { today, stampUnstamped } = options
  const stampDate = addDays(today, EXPIRY_DAYS)
  /** @type {Array<{ ruleId: string, count: number, expires: string }>} */
  const expired = []
  /** @type {Array<{ ruleId: string, count: number, expires: string }>} */
  const owed = []
  /** @type {Array<{ ruleId: string, count: number }>} */
  const unstamped = []
  /** @type {Array<{ ruleId: string, expires: string }>} */
  const stamped = []

  for (const ruleId of Object.keys(rules).sort()) {
    const count = counts[ruleId] ?? 0
    if (count <= 0) continue
    const expiry = expires[ruleId]
    if (expiry === undefined) {
      if (rules[ruleId] > 0) unstamped.push({ ruleId, count })
    } else if (today > expiry) {
      expired.push({ ruleId, count, expires: expiry })
    } else {
      owed.push({ ruleId, count, expires: expiry })
    }
  }

  /** @type {Record<string, string>} */
  const nextExpires = {}
  for (const ruleId of Object.keys(nextRules).sort()) {
    if (nextRules[ruleId] <= 0) continue
    if (Object.hasOwn(expires, ruleId)) {
      nextExpires[ruleId] = expires[ruleId]
    } else if (!Object.hasOwn(rules, ruleId) || stampUnstamped) {
      nextExpires[ruleId] = stampDate
      stamped.push({ ruleId, expires: stampDate })
    }
  }

  const blocked = stampUnstamped ? [] : unstamped
  return { expired, owed, unstamped, blocked, stamped, nextExpires }
}

/**
 * @typedef {object} RunOptions
 * @property {string} [cwd]
 * @property {Record<string, string | undefined>} [env]
 * @property {(line: string) => void} [log]
 * @property {(line: string) => void} [logError]
 * @property {() => Date} [now]  the clock that dates expiries (tests inject it)
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
  const today = utcDate((options.now ?? (() => new Date()))())

  let args
  let budgetPath
  let budget
  /** @type {string | undefined} */
  let narrowed
  try {
    args = parseArgs(argv, env)
    if (args.help) {
      log(USAGE)
      return EXIT_OK
    }
    budgetPath = resolve(cwd, args.budgetPath ?? BUDGET_FILENAME)
    narrowed = narrowedBy(args, cwd, budgetPath)
    if (narrowed !== undefined && args.acceptNewRules) {
      throw new UsageError(
        `--accept-new-rules writes the budget, so it needs the whole package; this run is narrowed (${narrowed}). Drop the paths and --ignore-pattern and run it from the budget file's directory.`,
      )
    }
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
  // `--accept-new-rules` is the one way a strict budget takes a new entry.
  const strictGate = budget.strict && !args.acceptNewRules
  const verdict = evaluateBudget(counts, budget.rules, { strict: strictGate })
  const budgetLabel = relative(cwd, budgetPath) || budgetPath
  const mode = args.ci ? 'ci' : 'local'

  const totalWarnings = sumCounts(counts)
  const ceiling = budget.maxWarnings
  const overCeiling = ceiling !== undefined && totalWarnings > ceiling
  // No run records entries that would put the recorded total past the ceiling,
  // `--accept-new-rules` included: past it, the file only ratchets down.
  let nextBudget = verdict.nextBudget
  /** @type {Array<{ ruleId: string, count: number }>} */
  let refused = []
  if (ceiling !== undefined && verdict.recorded.length > 0 && sumCounts(nextBudget) > ceiling) {
    refused = verdict.recorded
    nextBudget = { ...nextBudget }
    for (const { ruleId } of refused) delete nextBudget[ruleId]
  }
  const recorded = refused.length > 0 ? [] : verdict.recorded
  // Expiry is decided on the entries that will actually be written, so an
  // entry the ceiling refused is never stamped.
  const expiry = evaluateExpiry(counts, budget.rules, budget.expires, nextBudget, {
    today,
    stampUnstamped: !strictGate,
  })
  const stampedAt = new Map(expiry.stamped.map(({ ruleId, expires }) => [ruleId, expires]))
  const restamped = expiry.stamped.filter(({ ruleId }) => Object.hasOwn(budget.rules, ruleId))
  // A narrowed run's lowered and cleared entries are artefacts of the files it
  // skipped, so it neither reports nor writes them (see narrowedBy).
  const stale =
    narrowed === undefined &&
    (verdict.lowered.length > 0 ||
      verdict.cleared.length > 0 ||
      recorded.length > 0 ||
      restamped.length > 0)

  log(
    `narduk-lint (${mode}): ${results.length} files, ${errorCount} error(s), ${totalWarnings} warning(s) across ${byRule.size} rule(s)${ceiling === undefined ? '' : `, maxWarnings ${ceiling}`}`,
  )

  if (overCeiling) {
    logError(
      `✖ over ceiling: ${totalWarnings} warning(s) in total, maxWarnings is ${ceiling} (${budgetLabel})`,
    )
    const byCount = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    for (const [ruleId, count] of byCount) logError(`    ${ruleId}: ${count}`)
  }

  for (const { ruleId, count, budget: allowed } of verdict.overBudget) {
    logError(`✖ over budget: ${ruleId} has ${count} warning(s), budget is ${allowed}`)
    for (const location of topLocations(byRule.get(ruleId) ?? [])) {
      logError(`    ${location}`)
    }
  }
  for (const { ruleId, count } of verdict.blocked) {
    logError(`✖ unbudgeted: ${ruleId} has ${count} warning(s) and no budget entry`)
    for (const location of topLocations(byRule.get(ruleId) ?? [])) {
      logError(`    ${location}`)
    }
  }
  for (const { ruleId, count, expires } of expiry.expired) {
    logError(
      `✖ expired: ${ruleId} has ${count} warning(s); its budget entry expired after ${expires} (today is ${today}, UTC)`,
    )
    for (const location of topLocations(byRule.get(ruleId) ?? [])) {
      logError(`    ${location}`)
    }
  }
  for (const { ruleId, count } of expiry.blocked) {
    logError(
      `✖ no expiry: ${ruleId} has ${count} warning(s) under a budget entry with no "expires" date`,
    )
    for (const location of topLocations(byRule.get(ruleId) ?? [])) {
      logError(`    ${location}`)
    }
  }
  for (const { ruleId, count, expires } of expiry.owed) {
    log(`• owed: ${ruleId} has ${count} warning(s); fix by ${expires} (UTC), after which they fail`)
  }
  for (const { ruleId, count } of verdict.recorded) {
    log(`• unbudgeted: ${ruleId} has ${count} warning(s)`)
  }
  if (recorded.length > 0 && !budget.strict) {
    log(
      budget.exists
        ? `  ${budgetLabel} is not strict, so a rule with no entry is recorded, never failed. Add "strict": true to gate it.`
        : `  no ${budgetLabel}: warnings are not gated at all. Commit one with "strict": true.`,
    )
  }

  if (refused.length > 0) {
    logError(
      `✖ not recorded: ${refused.map(({ ruleId, count }) => `${ruleId} (${count})`).join(', ')} would bring the recorded total to ${sumCounts(verdict.nextBudget)}, past maxWarnings ${ceiling}`,
    )
  }

  // Decided before anything is written. A run with any lint error never
  // writes: a file that fails to parse reports no warnings, so its entries
  // would read as zero and be cleared, and the next passing run would record
  // them again with a fresh expiry. Other failures (over budget, expired, the
  // ceiling) come from complete counts, so they still ratchet down, as the
  // ceiling has always promised ("past it, the file only ratchets down").
  const failed =
    errorCount > 0 ||
    verdict.overBudget.length > 0 ||
    verdict.blocked.length > 0 ||
    expiry.expired.length > 0 ||
    expiry.blocked.length > 0 ||
    overCeiling ||
    refused.length > 0

  if (narrowed !== undefined) {
    log(
      `  narrowed run (${narrowed}): ${budgetLabel} not written, and lowered or cleared entries are not reported; run \`narduk-lint\` with no paths from ${budgetLabel}'s directory to update it.`,
    )
  } else if (errorCount > 0 && stale) {
    log(
      `  this run has lint errors, so ${budgetLabel} is not ratcheted or written (a file that fails to parse hides its warnings); fix the errors and run \`narduk-lint\` again.`,
    )
  } else if (args.ci) {
    for (const { ruleId, count, budget: allowed } of verdict.lowered) {
      log(`• budget can ratchet: ${ruleId} ${allowed} → ${count}`)
    }
    for (const { ruleId, budget: allowed } of verdict.cleared) {
      log(`• budget can ratchet: ${ruleId} ${allowed} → 0 (entry can be removed)`)
    }
    for (const { ruleId, expires } of restamped) {
      log(
        `• no expiry: ${ruleId} has warnings and no "expires" date; a local run stamps ${expires}`,
      )
    }
    if (stale) {
      log(`  ${budgetLabel} is stale; run \`pnpm lint\` locally and commit ${budgetLabel}.`)
    }
  } else if (stale) {
    for (const { ruleId, count, budget: allowed } of verdict.lowered) {
      log(`• lowered: ${ruleId} ${allowed} → ${count}`)
    }
    for (const { ruleId, budget: allowed } of verdict.cleared) {
      log(`• cleared: ${ruleId} ${allowed} → 0 (entry removed)`)
    }
    for (const { ruleId, count } of recorded) {
      const expires = stampedAt.get(ruleId)
      log(`• recorded: ${ruleId} = ${count}${expires ? `, expires ${expires}` : ''}`)
    }
    for (const { ruleId, expires } of restamped) {
      log(`• stamped: ${ruleId} expires ${expires} (the entry had no expiry)`)
    }
    if (args.write) {
      writeFileSync(
        budgetPath,
        serializeBudget(nextBudget, {
          strict: budget.strict,
          maxWarnings: ceiling,
          expires: expiry.nextExpires,
        }),
      )
      log(`  updated ${budgetLabel}; commit it.`)
    } else {
      log(`  --no-write: ${budgetLabel} left unchanged.`)
    }
  }

  if (failed) {
    if (verdict.overBudget.length > 0) {
      logError(
        `narduk-lint: ${verdict.overBudget.length} rule(s) over budget. Fix the new warnings; a recorded budget is never raised automatically.`,
      )
    }
    if (verdict.blocked.length > 0) {
      logError(
        `narduk-lint: ${verdict.blocked.length} rule(s) have warnings but no entry in strict ${budgetLabel}. Fix them, or record them on purpose with \`narduk-lint --accept-new-rules\` locally and commit ${budgetLabel}.`,
      )
    }
    if (expiry.expired.length > 0) {
      logError(
        `narduk-lint: ${expiry.expired.length} budget entr${expiry.expired.length === 1 ? 'y is' : 'ies are'} past expiry in ${budgetLabel}. Fix those warnings, run \`narduk-lint\` locally with no paths so the cleared entry leaves ${budgetLabel}, and commit it. narduk-lint never moves an existing expiry (\`--accept-new-rules\` keeps it); a rule gets a new date only if a whole-package run clears its entry and the warnings come back.`,
      )
    }
    if (expiry.blocked.length > 0) {
      logError(
        `narduk-lint: ${expiry.blocked.length} entr${expiry.blocked.length === 1 ? 'y' : 'ies'} in strict ${budgetLabel} allow${expiry.blocked.length === 1 ? 's' : ''} warnings with no expiry (recorded before expiries existed). Fix them, or start the ${EXPIRY_DAYS}-day clock on purpose with \`narduk-lint --accept-new-rules\` locally (it stamps "expires": "${addDays(today, EXPIRY_DAYS)}") and commit ${budgetLabel}.`,
      )
    }
    if (overCeiling) {
      logError(
        `narduk-lint: ${totalWarnings} warning(s) is more than the maxWarnings ceiling of ${ceiling} in ${budgetLabel}. Fix warnings until the total is at most ${ceiling}; the ceiling holds whatever the per-rule entries allow, and nothing past it can be recorded.`,
      )
    }
    return EXIT_LINT_FAILURE
  }
  return EXIT_OK
}
