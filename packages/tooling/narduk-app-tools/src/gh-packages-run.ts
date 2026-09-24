import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveRegistryConfig } from './registry-auth.js'

export const GH_PACKAGES_RUN_USAGE = 'Usage: narduk-app gh-packages-run -- <command...>'

export function parseGhPackagesRunArgs(args: readonly string[]): string[] {
  const command = args[0] === '--' ? [...args.slice(1)] : [...args]
  if (command.length === 0) throw new Error(GH_PACKAGES_RUN_USAGE)
  return command
}

export function runGhPackagesCommand(
  command: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): number {
  if (command.length === 0) throw new Error(GH_PACKAGES_RUN_USAGE)
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const existingUserconfig = env.NPM_CONFIG_USERCONFIG?.trim()
  if (existingUserconfig) {
    return spawnCommand(command, { cwd, env: { ...env } })
  }

  const config = resolveRegistryConfig(env)
  const token = env[config.authTokenEnvVar]?.trim() ?? ''
  if (!token || /[\r\n]/u.test(token)) {
    throw new Error(`Missing or invalid ${config.authTokenEnvVar}`)
  }

  const previousUmask = process.umask(0o077)
  const tempRoot = env.RUNNER_TEMP?.trim() || tmpdir()
  const directory = mkdtempSync(join(tempRoot, 'npmrc-auth.'))
  const authFile = join(directory, 'userconfig')
  try {
    writeFileSync(authFile, `//npm.pkg.github.com/:_authToken=\${${config.authTokenEnvVar}}\n`, {
      mode: 0o600,
      flag: 'wx',
    })
    return spawnCommand(command, {
      cwd,
      env: {
        ...env,
        NPM_CONFIG_USERCONFIG: authFile,
        NPM_CONFIG_GLOBALCONFIG: '/dev/null',
      },
    })
  } finally {
    process.umask(previousUmask)
    rmSync(directory, { recursive: true, force: true })
  }
}

function spawnCommand(
  command: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): number {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}
