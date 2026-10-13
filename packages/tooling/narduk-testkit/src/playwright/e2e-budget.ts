/**
 * The local E2E budget, for a Playwright CONFIG (narduk-libs, from
 * operator-portal#2392).
 *
 * A budget written as prose in an agent guide does not hold: one QA lane built
 * and ran a whole suite 21 times in a day, most of it route sweeps the
 * scheduled run owns, because a lane that calls `pnpm exec playwright test`
 * directly never meets a wrapper script. The one place every run passes is the
 * config, so {@link assertLocalE2eScope} is called as the config loads, and
 * {@link e2eBudgetDefaults} states every time bound instead of inheriting it.
 *
 * Outside CI (and without the override env) a `playwright test` must name at
 * most {@link E2E_MAX_LOCAL_SPECS} spec files, none of them tagged
 * `// @sweep` in its first lines. `--last-failed`, `--list` and
 * `--only-changed` always pass; so does a Playwright worker, another
 * subcommand and a run under another `--config`.
 *
 * Loaded from a Playwright CONFIG, before the runner exists: this file must
 * not import `@playwright/test`, `e2e/fixtures`, or use top-level await (the
 * `require` export condition can load it through require(esm)). Same CJS-config
 * constraint as `playwright/dev-port` (#417) and the tier preset.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

/** A spec whose job is to walk every route: the scheduled run's, never a lane's. */
export const E2E_SWEEP_TAG = '@sweep'
/** The most spec files a local run may name: the page's own spec, and a neighbour or two. */
export const E2E_MAX_LOCAL_SPECS = 3
/** The override, for a person who means to run the broad set locally. */
export const E2E_ALLOW_BROAD_ENV = 'E2E_ALLOW_BROAD'
/** Where the specs live, relative to the directory the run starts in. */
export const E2E_SPEC_DIR = 'tests/e2e'
/** The config file whose runs the guard judges; a run under another `--config` passes. */
export const E2E_GUARDED_CONFIG = 'playwright.config.ts'

/** Lines at the top of a spec in which the sweep tag counts. */
export const E2E_SWEEP_TAG_WINDOW_LINES = 10

/**
 * Options that take their value as the next argument, so that value is not a
 * spec filter. `-p` is `--project`'s short form.
 */
export const E2E_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--workers',
  '-j',
  '--project',
  '-p',
  '--reporter',
  '--output',
  '--retries',
  '--timeout',
  '--config',
  '-c',
  '--grep',
  '-g',
  '--grep-invert',
  '--global-timeout',
  '--max-failures',
  '--repeat-each',
  '--tsconfig',
  '--trace',
  '--ui-host',
  '--ui-port',
  '--shard',
  '--test-list',
  '--test-list-invert',
  '--browser',
])

export interface E2eLocalScopeOptions {
  /** Directory holding the spec files (default {@link E2E_SPEC_DIR}, resolved against `cwd`). */
  specDir?: string
  /** Most spec files a local run may name (default {@link E2E_MAX_LOCAL_SPECS}). */
  maxSpecs?: number
  /** The comment tag that marks a route sweep (default {@link E2E_SWEEP_TAG}). */
  sweepTag?: string
  /** The environment variable that lifts the budget when it is `1` (default {@link E2E_ALLOW_BROAD_ENV}). */
  allowBroadEnv?: string
  /** Directory `specDir` is resolved against (default `process.cwd()`). */
  cwd?: string
  /** Spec file names under `specDir`, posix and relative. Default: every `*.spec.*` file found there. */
  specs?: readonly string[]
  /** The subset of `specs` carrying the sweep tag. Default: read from the files. */
  sweeps?: readonly string[]
  /** Extra lines appended to the refusal, e.g. where the project documents its budget. */
  guidance?: readonly string[]
}

export type E2eLocalScopeVerdict = { ok: true } | { ok: false; problems: string[] }

interface VerdictEnv {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
}

const SPEC_FILE = /\.spec\.[cm]?[jt]sx?$/

/** True when the tag is a `// <tag>` comment line in the first lines of the source. */
export function hasSweepTag(
  source: string,
  tag: string = E2E_SWEEP_TAG,
  windowLines: number = E2E_SWEEP_TAG_WINDOW_LINES,
): boolean {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^\\s*//\\s*${escaped}(?![\\w-])`)
  return source
    .split('\n')
    .slice(0, windowLines)
    .some((line) => pattern.test(line))
}

/** The spec files under a directory, as posix paths relative to it. */
export function listSpecFiles(specDir: string): string[] {
  const found: string[] = []
  const walk = (dir: string, prefix: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), relative)
      else if (SPEC_FILE.test(entry.name)) found.push(relative)
    }
  }
  walk(specDir, '')
  return found.sort()
}

/** The spec names (relative to `specDir`) that carry the sweep tag. */
export function listSweepSpecs(
  specDir: string,
  specs: readonly string[] = listSpecFiles(specDir),
  tag: string = E2E_SWEEP_TAG,
): string[] {
  return specs.filter((name) => hasSweepTag(readFileSync(join(specDir, name), 'utf8'), tag))
}

/** The bare (filter) arguments of a `playwright test` argument list. */
export function specFilters(args: readonly string[]): string[] {
  return args.filter(
    (arg, index) =>
      !arg.startsWith('-') && !(index > 0 && E2E_VALUE_FLAGS.has(args[index - 1] as string)),
  )
}

/** Characters that make a filter a pattern rather than a path fragment. */
const PATTERN_CHARACTERS = /[\\^$*+?()[\]{}|]/

/**
 * The spec files (names) a filter list selects. Playwright treats each filter
 * as a regular expression over the file's absolute path, with an optional
 * `:line[:column]` suffix. A regular expression is never built from the
 * command line here (that is a regex-injection sink, and a pattern could hang
 * the config load); a filter is read as the path fragment it nearly always is:
 * a substring of the absolute path, `\.` read as `.`, a trailing `$` as "ends
 * with". A filter that is still a pattern after that (`.*`, `a|b`, `[ab]`, an
 * unclosed group) cannot be judged exactly, so it fails closed: it selects every
 * spec, and a run that names one is refused. Name the files instead.
 */
export function selectedSpecs(
  filters: readonly string[],
  specs: readonly string[],
  specDir: string,
): string[] {
  const root = resolve(specDir)
  const tests = filters.map((filter): ((file: string) => boolean) => {
    let fragment = filter.replace(/:\d+(?::\d+)?$/, '')
    const endsWith = fragment.endsWith('$') && !fragment.endsWith('\\$')
    if (endsWith) fragment = fragment.slice(0, -1)
    fragment = fragment.replaceAll('\\.', '.')
    if (PATTERN_CHARACTERS.test(fragment)) return () => true
    return endsWith ? (file) => file.endsWith(fragment) : (file) => file.includes(fragment)
  })
  return specs.filter((name) => {
    const file = join(root, name).replaceAll('\\', '/')
    return tests.some((test) => test(file))
  })
}

/** Whether the environment lifts the budget: CI, or the override env set to `1`. */
export function e2eBudgetLifted(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  allowBroadEnv: string = E2E_ALLOW_BROAD_ENV,
): boolean {
  return Boolean(env.CI) || env[allowBroadEnv] === '1'
}

/**
 * Whether a local `playwright test` with these arguments is in budget:
 * `{ ok: true }` or `{ ok: false, problems }`. Pure: nothing is read from the
 * disk when `specs` and `sweeps` are given.
 */
export function localScopeVerdict(
  args: readonly string[],
  options: E2eLocalScopeOptions & VerdictEnv = {},
): E2eLocalScopeVerdict {
  const env = options.env ?? process.env
  const allowBroadEnv = options.allowBroadEnv ?? E2E_ALLOW_BROAD_ENV
  if (e2eBudgetLifted(env, allowBroadEnv)) return { ok: true }
  if (
    args.includes('--last-failed') ||
    args.includes('--list') ||
    args.includes('--only-changed')
  ) {
    return { ok: true }
  }

  const specDir = resolve(options.cwd ?? process.cwd(), options.specDir ?? E2E_SPEC_DIR)
  const maxSpecs = options.maxSpecs ?? E2E_MAX_LOCAL_SPECS
  const sweepTag = options.sweepTag ?? E2E_SWEEP_TAG
  const specs = options.specs ?? listSpecFiles(specDir)

  const filters = specFilters(args)
  if (filters.length === 0) {
    return {
      ok: false,
      problems: [
        `no spec file named: the whole suite (${specs.length} files) is the scheduled run's job.`,
        'Name the spec file(s) written for the page you changed; a --grep alone still loads and walks every file.',
      ],
    }
  }

  const sweeps = options.sweeps ?? listSweepSpecs(specDir, specs, sweepTag)
  const selected = selectedSpecs(filters, specs, specDir)
  const problems: string[] = []
  const sweeping = selected.filter((name) => sweeps.includes(name))
  if (sweeping.length > 0) {
    problems.push(
      `route sweeps selected (${sweeping.join(', ')}): they walk every page and are the scheduled run's job; a red one is a red-main finding.`,
    )
  }
  if (selected.length > maxSpecs) {
    problems.push(
      `${selected.length} spec files selected (${selected.join(', ')}); a local run names at most ${maxSpecs}: the spec(s) for the page you changed.`,
    )
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true }
}

/** The refusal as one message: what was refused, why, and the one way past it. */
export function localScopeRefusal(
  problems: readonly string[],
  options: Pick<E2eLocalScopeOptions, 'allowBroadEnv' | 'guidance'> = {},
): string {
  const allowBroadEnv = options.allowBroadEnv ?? E2E_ALLOW_BROAD_ENV
  return [
    'E2E is budgeted; this local run is refused:',
    ...problems.map((problem) => `  - ${problem}`),
    'Run once: `playwright test <the page spec> --workers=1`, then `--last-failed` once. Still red? Open the PR and list the failures.',
    ...(options.guidance ?? []),
    `Reproducing a red scheduled run on purpose? Set ${allowBroadEnv}=1.`,
  ].join('\n')
}

export interface AssertLocalE2eScopeOptions extends E2eLocalScopeOptions {
  argv?: readonly string[]
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  /** Called with `1` when the run is refused (default `process.exit`). */
  exit?: (code: number) => void
  /** Called with the refusal message (default `console.error`). */
  report?: (message: string) => void
  /** Basename of the config this guard judges (default {@link E2E_GUARDED_CONFIG}). */
  configFile?: string
}

/**
 * Prints the refusal and exits 1 when this process is a local `playwright
 * test` over the guarded config that is out of budget (a throw would bury the
 * message under Playwright's config-loader stack). A Playwright worker, another
 * subcommand, and a run under another config pass. Call it at the top of
 * `playwright.config.ts`.
 */
export function assertLocalE2eScope(options: AssertLocalE2eScopeOptions = {}): void {
  const argv = options.argv ?? process.argv
  const env = options.env ?? process.env
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const report = options.report ?? ((message: string) => console.error(message))
  if (env.TEST_WORKER_INDEX !== undefined || argv[2] !== 'test') return

  const args = argv.slice(3)
  const configIndex = args.findIndex(
    (arg) => arg === '--config' || arg === '-c' || arg.startsWith('--config='),
  )
  if (configIndex !== -1) {
    const arg = args[configIndex] as string
    const config = arg.startsWith('--config=')
      ? arg.slice('--config='.length)
      : args[configIndex + 1]
    if (basename(config ?? '') !== (options.configFile ?? E2E_GUARDED_CONFIG)) return
  }

  const verdict = localScopeVerdict(args, { ...options, env })
  if (verdict.ok) return
  report(localScopeRefusal(verdict.problems, options))
  exit(1)
}

/** Time bounds for a Playwright config, stated rather than inherited. */
export interface E2eBudgetDefaults {
  timeout: number
  expect: { timeout: number }
  /** `0` (no limit) when the budget is lifted. */
  maxFailures: number
  /** `0` (no limit) when the budget is lifted. */
  globalTimeout: number
  use: { actionTimeout: number; navigationTimeout: number }
}

export interface E2eBudgetDefaultsOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  allowBroadEnv?: string
  /** Per-test budget (default 30 s, Playwright's own). */
  testTimeoutMs?: number
  /** `expect` timeout (default 5 s). */
  expectTimeoutMs?: number
  /** Per-action bound (default 15 s). */
  actionTimeoutMs?: number
  /** Per-navigation bound (default 30 s). */
  navigationTimeoutMs?: number
  /** Failures after which a local run stops (default 5). */
  localMaxFailures?: number
  /** Whole-run bound for a local run (default 15 minutes). */
  localGlobalTimeoutMs?: number
}

export const E2E_TEST_TIMEOUT_MS = 30_000
export const E2E_EXPECT_TIMEOUT_MS = 5_000
export const E2E_ACTION_TIMEOUT_MS = 15_000
export const E2E_NAVIGATION_TIMEOUT_MS = 30_000
export const E2E_LOCAL_MAX_FAILURES = 5
export const E2E_LOCAL_GLOBAL_TIMEOUT_MS = 15 * 60_000

/**
 * Every time bound a config should state. A local run stops after
 * `localMaxFailures` failures (a broken build fails every test the same way)
 * and after `localGlobalTimeoutMs`; CI and the override env run every test and
 * are bounded by their job (`0` means no limit to Playwright).
 *
 * Merge, do not spread over a preset that sets `use`:
 *
 *     const budget = e2eBudgetDefaults()
 *     defineConfig({
 *       ...preset,
 *       ...budget,
 *       use: { ...preset.use, ...budget.use },
 *     })
 */
export function e2eBudgetDefaults(options: E2eBudgetDefaultsOptions = {}): E2eBudgetDefaults {
  const budgeted = !e2eBudgetLifted(options.env ?? process.env, options.allowBroadEnv)
  return {
    timeout: options.testTimeoutMs ?? E2E_TEST_TIMEOUT_MS,
    expect: { timeout: options.expectTimeoutMs ?? E2E_EXPECT_TIMEOUT_MS },
    maxFailures: budgeted ? (options.localMaxFailures ?? E2E_LOCAL_MAX_FAILURES) : 0,
    globalTimeout: budgeted ? (options.localGlobalTimeoutMs ?? E2E_LOCAL_GLOBAL_TIMEOUT_MS) : 0,
    use: {
      actionTimeout: options.actionTimeoutMs ?? E2E_ACTION_TIMEOUT_MS,
      navigationTimeout: options.navigationTimeoutMs ?? E2E_NAVIGATION_TIMEOUT_MS,
    },
  }
}
