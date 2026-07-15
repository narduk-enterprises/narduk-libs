import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import { extname } from 'node:path'

export interface PackageManagerInvocation {
  argsPrefix: string[]
  command: string
}

/** Resolve pnpm without PATH when running from a package script. */
export function resolvePnpmInvocation(
  env: NodeJS.ProcessEnv = process.env,
  nodeExecutable = process.execPath,
): PackageManagerInvocation {
  const packageManagerEntrypoint = env.npm_execpath?.trim()
  if (packageManagerEntrypoint) {
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
