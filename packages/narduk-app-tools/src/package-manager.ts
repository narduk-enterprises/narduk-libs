import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import { existsSync } from 'node:fs'
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
