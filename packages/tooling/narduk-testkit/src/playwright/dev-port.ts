import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Where a resolved local dev port came from.
 *
 * - `env` -- an explicit override such as `PLAYWRIGHT_PORT`. Always wins.
 * - `declared` -- the app's own `narduk.localDevNuxtPort`. The primary checkout
 *   and every CI run keep this, so muscle memory, bookmarks and any
 *   localhost allowlist (OAuth callbacks, map-token origins) keep working.
 * - `derived` -- `declared` plus a stable offset hashed from the checkout path.
 *   Only a linked git worktree derives, which is the case the fixed port
 *   breaks: N worktrees of one app on one machine all wanted one port.
 */
export type LocalDevPortSource = 'env' | 'declared' | 'derived'

export interface LocalDevPortResolution {
  /** The port the e2e run should use. */
  port: number
  source: LocalDevPortSource
  /** The env var that supplied the port, when {@link source} is `env`. */
  envVar?: string
  /** The app's declared port, before any derivation. */
  declaredPort: number
  /** True when the checkout root is a linked git worktree rather than the primary clone. */
  linkedWorktree: boolean
  /** One line, safe to print from a Playwright config at load time. */
  description: string
}

export interface ResolveLocalDevPortOptions {
  /**
   * Any directory inside the checkout. The checkout root -- the nearest
   * ancestor holding `.git` -- is found from here and is what the port derives
   * from, so `process.cwd()` is a fine value. A Playwright config cannot always
   * use `import.meta.url`: Playwright transpiles a TypeScript config to CJS
   * unless something (`--import tsx`, `"type": "module"`) says otherwise, and
   * `import.meta` is a syntax error there.
   */
  rootDir: string
  /** The app's declared local dev port (`narduk.localDevNuxtPort`). */
  declaredPort: number
  /** Environment to read. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /**
   * Override variables, consulted in order before anything is derived.
   * Defaults to `PLAYWRIGHT_PORT` then `NUXT_PORT`.
   */
  overrideEnvVars?: readonly string[]
  /**
   * Width of the derived window, in ports. Default 1000, so a derived port is
   * always `declaredPort .. declaredPort + 999` and stays recognisably the
   * app's own range in `lsof` output.
   */
  span?: number
}

const DEFAULT_OVERRIDE_ENV_VARS = ['PLAYWRIGHT_PORT', 'NUXT_PORT'] as const
const DEFAULT_SPAN = 1000
const MIN_PORT = 1024
const MAX_PORT = 65_535

/**
 * Parse anything that claims to be a port into a usable one, or `null`.
 * Exported because a Playwright config typically has to normalise the app's
 * own manifest value with exactly the same rules.
 */
export function normalizePort(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PORT ? parsed : null
}

/**
 * The nearest ancestor of `startDir` (inclusive) that holds a `.git` entry, or
 * `null` when there is none. That directory is the checkout root, and it is
 * what a derived port keys on -- so passing any directory inside the checkout,
 * `process.cwd()` included, yields the same port.
 */
export function findCheckoutRoot(startDir: string): string | null {
  let dir = resolve(startDir)

  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * True when `rootDir` is a linked git worktree (`git worktree add`), false for
 * a primary clone or a directory that is not a checkout at all.
 *
 * Read from disk rather than by shelling out to `git`: a linked worktree's
 * `.git` is a *file* containing `gitdir: <path>`, a primary clone's is a
 * directory. No subprocess, and it is honest inside a container where `git`
 * may be absent.
 */
export function isLinkedWorktree(rootDir: string): boolean {
  const dotGit = join(rootDir, '.git')

  let stats
  try {
    stats = lstatSync(dotGit)
  } catch {
    return false
  }

  if (!stats.isFile()) return false

  try {
    return readFileSync(dotGit, 'utf-8').trimStart().startsWith('gitdir:')
  } catch {
    return false
  }
}

function stablePathOffset(rootDir: string, span: number): number {
  let key = rootDir
  try {
    key = realpathSync(rootDir)
  } catch {
    // A path we cannot realpath still hashes; determinism is what matters.
  }

  // First four bytes of SHA-256 over the resolved checkout path. Deterministic
  // across runs and machines, and independent of branch name -- a lane that
  // renames its branch keeps its port.
  return createHash('sha256').update(key).digest().readUInt32BE(0) % span
}

/**
 * Decide which local dev port this checkout's e2e run should use.
 *
 * The fixed-port bug (narduk-libs#417): every worktree of one app shares the
 * app's declared port, so Playwright's `reuseExistingServer` attaches to
 * whichever worktree's `nuxt dev` happened to get there first and the suite
 * silently tests the wrong branch. Deriving the port from the checkout path
 * makes two worktrees practically unable to collide, with no env var set.
 *
 * CI never derives: `CI` short-circuits to the declared port, and a CI
 * checkout is a primary clone anyway, so the two guards agree.
 */
export function resolveLocalDevPort(options: ResolveLocalDevPortOptions): LocalDevPortResolution {
  const {
    rootDir,
    declaredPort,
    env = process.env,
    overrideEnvVars = DEFAULT_OVERRIDE_ENV_VARS,
    span = DEFAULT_SPAN,
  } = options

  const checkoutRoot = findCheckoutRoot(rootDir) ?? resolve(rootDir)

  for (const envVar of overrideEnvVars) {
    const override = normalizePort(env[envVar])
    if (override !== null) {
      return {
        port: override,
        source: 'env',
        envVar,
        declaredPort,
        linkedWorktree: isLinkedWorktree(checkoutRoot),
        description: `port ${override} from ${envVar}`,
      }
    }
  }

  const linkedWorktree = isLinkedWorktree(checkoutRoot)
  const declared: LocalDevPortResolution = {
    port: declaredPort,
    source: 'declared',
    declaredPort,
    linkedWorktree,
    description: `port ${declaredPort} declared by this app`,
  }

  if (env.CI || !linkedWorktree) return declared

  const effectiveSpan = Math.max(1, Math.trunc(span))
  // Slide the window rather than let a high declared port push the derived one
  // past 65535. `windowStart + span - 1` is always a legal port.
  const windowStart = Math.max(MIN_PORT, Math.min(declaredPort, MAX_PORT - (effectiveSpan - 1)))
  const port = windowStart + stablePathOffset(checkoutRoot, effectiveSpan)

  return {
    port,
    source: 'derived',
    declaredPort,
    linkedWorktree: true,
    description: `port ${port} derived from linked worktree ${checkoutRoot} (declared ${declaredPort})`,
  }
}

/**
 * Whether Playwright may attach to a server it did not start.
 *
 * A linked worktree says no by default. That is the half of the fix that turns
 * a residual collision -- a 1-in-`span` hash clash, or any unrelated process
 * sitting on the derived port -- from a silent wrong-branch pass into a loud
 * failure. `PLAYWRIGHT_REUSE_SERVER=1` opts back in for a lane that really is
 * driving its own long-lived `nuxt dev`.
 */
export function shouldReuseExistingServer(options: {
  resolution: LocalDevPortResolution
  env?: NodeJS.ProcessEnv
  reuseEnvVar?: string
}): boolean {
  const { resolution, env = process.env, reuseEnvVar = 'PLAYWRIGHT_REUSE_SERVER' } = options

  const explicit = env[reuseEnvVar]?.trim().toLowerCase()
  if (explicit === '1' || explicit === 'true') return true
  if (explicit === '0' || explicit === 'false') return false

  if (env.CI || env.PW_NO_REUSE_SERVER) return false

  return resolution.source !== 'derived'
}

/**
 * Probe whether something already holds `port` on `host`.
 *
 * Returns `null` when the probe itself could not run, so a caller fails OPEN:
 * an unusable probe must never be the reason a suite refuses to start.
 *
 * Implemented by binding the port in a short-lived child `node`, which is
 * portable (no `lsof`) and synchronous, which a Playwright config needs.
 */
export function isPortInUse(port: number, host = '127.0.0.1'): boolean | null {
  const script = [
    "const net = require('node:net')",
    'const server = net.createServer()',
    "server.once('error', (error) => process.exit(error.code === 'EADDRINUSE' ? 2 : 0))",
    'server.listen(Number(process.argv[1]), process.argv[2], () => server.close(() => process.exit(0)))',
  ].join('\n')

  try {
    execFileSync(process.execPath, ['-e', script, String(port), host], {
      stdio: 'ignore',
      timeout: 5000,
    })
    return false
  } catch (error) {
    const status = (error as { status?: number | null }).status
    if (status === 2) return true
    if (status === 0) return false
    return null
  }
}

export interface AssertLocalDevPortAvailableOptions {
  resolution: LocalDevPortResolution
  env?: NodeJS.ProcessEnv
  host?: string
  /** Named in the failure message as the escape hatch. */
  overrideEnvVar?: string
  /** Injectable for tests. Defaults to {@link isPortInUse}. */
  probe?: (port: number, host: string) => boolean | null
}

/**
 * Throw a one-line, actionable error when the port this checkout is about to
 * claim is already taken and reuse is off -- rather than letting Playwright
 * report a generic "already used" that names neither the override nor why the
 * port was chosen.
 *
 * No-ops inside a Playwright worker (`TEST_WORKER_INDEX` is set there): by then
 * our own server holds the port, and the runner already cleared it.
 */
export function assertLocalDevPortAvailable(options: AssertLocalDevPortAvailableOptions): void {
  const {
    resolution,
    env = process.env,
    host = '127.0.0.1',
    overrideEnvVar = 'PLAYWRIGHT_PORT',
    probe = isPortInUse,
  } = options

  if (env.CI || env.TEST_WORKER_INDEX !== undefined) return
  if (probe(resolution.port, host) !== true) return

  throw new Error(
    `[e2e] ${resolution.description} is already in use by another process; ` +
      `this checkout will not reuse a server it did not start. ` +
      `Free ${host}:${resolution.port}, or set ${overrideEnvVar}=<port> to pick another.`,
  )
}
