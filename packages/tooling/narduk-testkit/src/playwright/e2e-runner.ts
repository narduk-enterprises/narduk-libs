/**
 * `narduk-testkit e2e check|setup|run` (narduk-libs#997).
 *
 * Replaces the per-app `scripts/setup-playwright-browsers.mjs` and
 * `scripts/run-web-e2e.mjs` copies the retired narduk-template left in 13
 * apps. The behaviour is buoys' (the reference copy):
 *
 * - ONE machine-wide browser cache. A non-empty ambient
 *   `PLAYWRIGHT_BROWSERS_PATH` (isolated CI guests export one) is never
 *   overridden; otherwise Playwright's own shared default is used. A
 *   per-checkout `.cache/ms-playwright` downloaded ~500 MB per worktree.
 * - The readiness check LAUNCHES Chromium. An `executablePath()` that exists
 *   does not mean the browser can start (missing shared libraries, a
 *   quarantined binary).
 * - `--project=web` is added only when the caller chose no project:
 *   Playwright accumulates repeated `--project` flags, so an unconditional
 *   default turns `--project=pr` into `pr` + the whole `web` tier.
 *
 * Like `playwright/config`, this module must not import `@playwright/test` at
 * runtime: it runs before (and around) the runner, and the app's own
 * Playwright is the one resolved and spawned.
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'

/** Same value as `WEB_PROJECT_NAME` in `playwright/config` (a test pins it). */
export const DEFAULT_E2E_PROJECT = 'web'

/** Checked in order when the caller names no config. */
export const DEFAULT_PLAYWRIGHT_CONFIG_CANDIDATES = [
  'playwright.config.ts',
  'apps/web/playwright.config.ts',
] as const

const CHECK_TIMEOUT_MS = 120_000

// Prints only the error message (no stack) so the hint can quote it.
const LAUNCH_CHROMIUM_SCRIPT =
  'try { ' +
  "const { chromium } = await import('@playwright/test'); " +
  'const browser = await chromium.launch({ headless: true }); ' +
  'await browser.close() ' +
  '} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1) }'

// Playwright's "please install" banner is box-drawn; the path line above it is the useful part.
const BANNER_LINE = /^[\s║╔╚═]*$|^\s*[║╔╚]/

export const E2E_USAGE = [
  'Usage:',
  '  narduk-testkit e2e check              launch Chromium headless; exit 1 with the setup hint',
  '  narduk-testkit e2e setup [-- <args>]  playwright install chromium into the ambient/shared cache',
  '  narduk-testkit e2e run [--config <path>] [--default-project <name> | --no-default-project]',
  '                         [--] [<playwright test args>]',
  '                                        check, then playwright test; adds --project=web only',
  '                                        when the caller chose no project',
].join('\n')

/**
 * The browser cache Playwright should use: a non-empty ambient
 * `PLAYWRIGHT_BROWSERS_PATH`, kept exactly, or `undefined` for Playwright's
 * own shared machine cache (`~/Library/Caches/ms-playwright`,
 * `~/.cache/ms-playwright`). Never a per-checkout path.
 */
export function resolveBrowserCachePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const ambient = env.PLAYWRIGHT_BROWSERS_PATH
  return typeof ambient === 'string' && ambient.trim() !== '' ? ambient : undefined
}

/** True when `args` already select a Playwright project (`--project`, `--project=`, `-p`). */
export function selectsPlaywrightProject(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--project' || arg === '-p' || arg.startsWith('--project='))
}

/** True when `args` already name a Playwright config (`--config`, `--config=`, `-c`). */
export function selectsPlaywrightConfig(args: readonly string[]): boolean {
  return args.some((arg) => arg === '--config' || arg === '-c' || arg.startsWith('--config='))
}

/**
 * `args` with `--project=<project>` prepended, unless the caller already
 * chose a project. Returns a new array.
 */
export function withDefaultProject(
  args: readonly string[],
  project: string = DEFAULT_E2E_PROJECT,
): string[] {
  return selectsPlaywrightProject(args) ? [...args] : [`--project=${project}`, ...args]
}

/** `NODE_OPTIONS` with `--import tsx` added once. */
export function withTsxImport(nodeOptions: string | undefined): string {
  const current = (nodeOptions ?? '').trim()
  const tokens = current === '' ? [] : current.split(/\s+/)
  const hasTsx = tokens.some(
    (token, index) =>
      token === '--import=tsx' || (token === '--import' && tokens[index + 1] === 'tsx'),
  )
  if (hasTsx) return nodeOptions ?? ''
  return current === '' ? '--import tsx' : `--import tsx ${current}`
}

/**
 * The Playwright config to pass: `explicit` resolved against `cwd` (it must
 * exist), else the first of {@link DEFAULT_PLAYWRIGHT_CONFIG_CANDIDATES} that
 * exists, else `undefined` so Playwright does its own discovery.
 */
export function resolvePlaywrightConfigPath(
  cwd: string,
  explicit?: string,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (explicit !== undefined) {
    const path = isAbsolute(explicit) ? explicit : resolve(cwd, explicit)
    if (!exists(path))
      throw new Error(`Playwright config not found: ${explicit} (resolved ${path})`)
    return path
  }
  for (const candidate of DEFAULT_PLAYWRIGHT_CONFIG_CANDIDATES) {
    const path = join(cwd, candidate)
    if (exists(path)) return path
  }
  return undefined
}

export interface E2eRunArgs {
  config?: string
  /** `false` when `--no-default-project` was passed. */
  defaultProject: string | false
  playwrightArgs: string[]
}

/**
 * Split `e2e run` arguments into the runner's own options and the arguments
 * for `playwright test`. Everything after `--`, or from the first argument the
 * runner does not own, goes to Playwright.
 */
export function parseE2eRunArgs(args: readonly string[]): E2eRunArgs {
  const parsed: E2eRunArgs = { defaultProject: DEFAULT_E2E_PROJECT, playwrightArgs: [] }
  let index = 0
  const valueOf = (flag: string): string => {
    const value = args[index + 1]
    if (value === undefined || value === '--') throw new Error(`${flag} needs a value`)
    index += 1
    return value
  }

  for (; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') {
      index += 1
      break
    }
    if (arg === '--config') parsed.config = valueOf(arg)
    else if (arg.startsWith('--config=')) parsed.config = arg.slice('--config='.length)
    else if (arg === '--default-project') parsed.defaultProject = valueOf(arg)
    else if (arg.startsWith('--default-project=')) {
      parsed.defaultProject = arg.slice('--default-project='.length)
    } else if (arg === '--no-default-project') parsed.defaultProject = false
    else break
  }

  parsed.playwrightArgs = args.slice(index)
  return parsed
}

export interface E2eSpawnOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  /** Capture stderr (the launch check) instead of inheriting stdio. */
  capture: boolean
  timeoutMs?: number
}

export interface E2eSpawnResult {
  error?: Error
  status: number | null
  stderr: string
}

export interface E2eRunnerDeps {
  cwd: string
  env: NodeJS.ProcessEnv
  error: (message: string) => void
  exists: (path: string) => boolean
  log: (message: string) => void
  /** The Node binary that runs Playwright (`process.execPath`). */
  nodePath: string
  /** Resolve `specifier` from the app checkout; `undefined` when it is not installed. */
  resolveFrom: (specifier: string, cwd: string) => string | undefined
  spawn: (command: string, args: readonly string[], options: E2eSpawnOptions) => E2eSpawnResult
}

/** Resolve a module from the app checkout (not from this package). */
export function resolveFromCheckout(specifier: string, cwd: string): string | undefined {
  try {
    return createRequire(join(cwd, 'package.json')).resolve(specifier)
  } catch {
    return undefined
  }
}

function setupHint(env: NodeJS.ProcessEnv, launchError: string): string {
  const cache = resolveBrowserCachePath(env) ?? "Playwright's shared machine cache"
  const detail = launchError
    .split('\n')
    .filter((line) => !BANNER_LINE.test(line))
    .slice(0, 6)
    .map((line) => `  ${line.trim()}`)
    .join('\n')
  return [
    'Playwright Chromium cannot be launched in this checkout.',
    `Browser cache: ${cache}`,
    ...(detail === '' ? [] : ['Launch error:', detail]),
    'Run: narduk-testkit e2e setup   (add `-- --with-deps` on a fresh Linux host)',
    '',
    'Set PLAYWRIGHT_BROWSERS_PATH only when CI or an isolated runner needs its own cache.',
  ].join('\n')
}

function playwrightCli(deps: E2eRunnerDeps): string | undefined {
  const cli = deps.resolveFrom('@playwright/test/cli', deps.cwd)
  if (cli === undefined) {
    deps.error(
      `@playwright/test is not installed in ${deps.cwd}. Add it as a devDependency of the app, then retry.`,
    )
  }
  return cli
}

function finish(deps: E2eRunnerDeps, result: E2eSpawnResult): number {
  if (result.error) {
    deps.error(result.error.message)
    return 1
  }
  return result.status ?? 1
}

function check(deps: E2eRunnerDeps): number {
  const result = deps.spawn(
    deps.nodePath,
    ['--input-type=module', '--eval', LAUNCH_CHROMIUM_SCRIPT],
    { capture: true, cwd: deps.cwd, env: deps.env, timeoutMs: CHECK_TIMEOUT_MS },
  )
  if (!result.error && result.status === 0) return 0
  deps.error(setupHint(deps.env, result.error?.message ?? result.stderr))
  return 1
}

function setup(deps: E2eRunnerDeps, args: readonly string[]): number {
  const cli = playwrightCli(deps)
  if (cli === undefined) return 1
  const extra = args[0] === '--' ? args.slice(1) : [...args]
  return finish(
    deps,
    deps.spawn(deps.nodePath, [cli, 'install', 'chromium', ...extra], {
      capture: false,
      cwd: deps.cwd,
      env: deps.env,
    }),
  )
}

function run(deps: E2eRunnerDeps, args: readonly string[]): number {
  let parsed: E2eRunArgs
  let config: string | undefined
  try {
    parsed = parseE2eRunArgs(args)
    config = selectsPlaywrightConfig(parsed.playwrightArgs)
      ? undefined
      : resolvePlaywrightConfigPath(deps.cwd, parsed.config, deps.exists)
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error))
    return 1
  }

  const cli = playwrightCli(deps)
  if (cli === undefined) return 1
  const checked = check(deps)
  if (checked !== 0) return checked

  const testArgs =
    parsed.defaultProject === false
      ? parsed.playwrightArgs
      : withDefaultProject(parsed.playwrightArgs, parsed.defaultProject)
  const env = { ...deps.env }
  // Only when the app has tsx: an unconditional `--import tsx` makes every run
  // die with ERR_MODULE_NOT_FOUND in an app that does not install it.
  if (deps.resolveFrom('tsx', deps.cwd) !== undefined) {
    env.NODE_OPTIONS = withTsxImport(deps.env.NODE_OPTIONS)
  }

  return finish(
    deps,
    deps.spawn(
      deps.nodePath,
      [cli, 'test', ...(config === undefined ? [] : [`--config=${config}`]), ...testArgs],
      { capture: false, cwd: deps.cwd, env },
    ),
  )
}

/** Run `narduk-testkit e2e <argv>`; returns the process exit code. */
export function runE2eCommand(argv: readonly string[], deps: E2eRunnerDeps): number {
  const [command, ...rest] = argv
  if (command === undefined || command === '--help' || command === '-h') {
    deps.log(E2E_USAGE)
    return 0
  }
  if (command === 'check') return check(deps)
  if (command === 'setup') return setup(deps, rest)
  if (command === 'run') return run(deps, rest)
  deps.error(`Unknown e2e command: ${command}\n${E2E_USAGE}`)
  return 1
}
