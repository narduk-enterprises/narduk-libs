import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

export interface DevFlags {
  command: string[]
  config?: string
  dryRun: boolean
  project?: string
}

export function parseDevArgs(args: string[]): DevFlags {
  let afterSeparator = false
  let dryRun = false
  let config: string | undefined
  let project: string | undefined
  const command: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (afterSeparator) {
      command.push(arg)
      continue
    }
    if (arg === '--') {
      afterSeparator = true
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--project') {
      project = args[++index]
      if (!project) throw new Error('--project requires a value')
    } else if (arg === '--config') {
      config = args[++index]
      if (!config) throw new Error('--config requires a value')
    } else if (arg === '--help' || arg === '-h') {
      throw new Error(
        'Usage: narduk-app dev [--project <name>] [--config <name>] [--dry-run] -- <command...>',
      )
    } else {
      throw new Error(`Unknown dev option: ${arg}`)
    }
  }

  return { command: command.length > 0 ? command : ['nuxt', 'dev'], config, dryRun, project }
}

export function buildDopplerRunArgs(
  flags: Pick<DevFlags, 'command' | 'config' | 'project'>,
): string[] {
  const args = ['run']
  if (flags.project) args.push('--project', flags.project)
  if (flags.config) args.push('--config', flags.config)
  return [...args, '--', ...flags.command]
}

export function resolveChildExitCode(
  result: Pick<SpawnSyncReturns<Buffer>, 'signal' | 'status'>,
): number {
  if (typeof result.status === 'number') return result.status
  if (result.signal === 'SIGINT') return 130
  if (result.signal === 'SIGTERM') return 143
  return 1
}

export function runDev(flags: DevFlags, env: NodeJS.ProcessEnv = process.env): number {
  const args = buildDopplerRunArgs(flags)
  if (flags.dryRun) {
    console.log(`doppler ${args.join(' ')}`)
    return 0
  }
  const result = spawnSync('doppler', args, { env, stdio: 'inherit' })
  if (result.error) {
    console.error(`Could not run Doppler: ${result.error.message}`)
    return 1
  }
  return resolveChildExitCode(result)
}
