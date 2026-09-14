import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'

export interface PackageManagerInvocation {
  argsPrefix: string[]
  command: string
}

function invocationForEntrypoint(
  packageManagerEntrypoint: string,
  nodeExecutable: string,
): PackageManagerInvocation {
  const extension = extname(packageManagerEntrypoint).toLowerCase()
  if (!['.cjs', '.js', '.mjs'].includes(extension)) {
    return {
      argsPrefix: [],
      command: packageManagerEntrypoint,
    }
  }
  return {
    argsPrefix: [packageManagerEntrypoint],
    command: nodeExecutable,
  }
}

/** Resolve pnpm without PATH when running from a package script. */
export function resolvePnpmInvocation(
  env: NodeJS.ProcessEnv = process.env,
  nodeExecutable = process.execPath,
): PackageManagerInvocation {
  const packageManagerEntrypoint = env.npm_execpath?.trim()
  if (packageManagerEntrypoint && existsSync(packageManagerEntrypoint)) {
    return invocationForEntrypoint(packageManagerEntrypoint, nodeExecutable)
  }

  const pnpmHome = env.PNPM_HOME?.trim()
  if (pnpmHome) {
    const names =
      process.platform === 'win32' ? ['pnpm.exe', 'pnpm.cmd', 'pnpm.cjs'] : ['pnpm', 'pnpm.cjs']
    for (const name of names) {
      const candidate = join(pnpmHome, name)
      if (existsSync(candidate)) {
        return invocationForEntrypoint(candidate, nodeExecutable)
      }
    }
  }

  return {
    argsPrefix: [],
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  }
}

export function spawnPnpmSync(
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) {
  const invocation = resolvePnpmInvocation(options.env)
  return spawnSync(invocation.command, [...invocation.argsPrefix, ...args], options)
}

/**
 * Resolve wrangler directly instead of shelling it through the active
 * package manager's `exec` subcommand. `npm exec wrangler d1 execute ...
 * --command "<sql>"` silently drops `--command`'s value under npm's argument
 * parsing, and `pnpm exec` refuses to run at all inside an npm-configured
 * consumer — so routing through a package-manager `exec` makes the estate's
 * D1 migration path pnpm-only. Resolve the wrangler binary the consumer
 * already installed (its own `node_modules/.bin/wrangler`, falling back to
 * Node module resolution from the consumer root) and spawn it directly.
 */
export function resolveWranglerInvocation(
  cwd: string,
  nodeExecutable = process.execPath,
): PackageManagerInvocation {
  const binName = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler'
  const localBin = join(cwd, 'node_modules', '.bin', binName)
  if (existsSync(localBin)) {
    return invocationForEntrypoint(localBin, nodeExecutable)
  }

  try {
    const requireFromConsumer = createRequire(join(cwd, 'package.json'))
    const entrypoint = requireFromConsumer.resolve('wrangler/bin/wrangler.js')
    return invocationForEntrypoint(entrypoint, nodeExecutable)
  } catch {
    // Fall through to a bare PATH lookup below.
  }

  return {
    argsPrefix: [],
    command: process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
  }
}

export function spawnWranglerSync(
  cwd: string,
  args: readonly string[],
  options: SpawnSyncOptionsWithStringEncoding,
) {
  const invocation = resolveWranglerInvocation(cwd)
  return spawnSync(invocation.command, [...invocation.argsPrefix, ...args], options)
}
