import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

/**
 * How `narduk-app dev` obtains development credentials.
 *
 * `none` runs the child directly. `nvault` runs it under the registered local
 * credential route, `nvault run -p <project> -e <environment> -c <config> --
 * <command>`, which keeps values process-local (company-hq
 * `docs/SECRETS-MATRIX.md`, plane 4 "Local workstation overlay").
 *
 * There is deliberately no Doppler route. This command used to run every child
 * through `doppler run`, an implicit dependency on the retired app-secret store
 * (narduk-libs#321). Doppler `ne/*` still holds provider-root provisioners by a
 * separately approved exception; that exception is not an application
 * development credential source and is not reachable from this command.
 */
export type DevCredentialRoute = 'none' | 'nvault'

export interface DevFlags {
  command: string[]
  config?: string
  credentials: DevCredentialRoute
  dryRun: boolean
  environment?: string
  project?: string
}

/** A resolved child process: the executable and its exact argument vector. */
export interface DevInvocation {
  args: string[]
  command: string
}

export const DEV_USAGE =
  'Usage: narduk-app dev [--credentials <none|nvault>] [--project <name>] ' +
  '[--environment <name>] [--config <name>] [--dry-run] -- <command...>'

const RETIRED_DOPPLER_MESSAGE = [
  'narduk-app dev no longer runs Doppler (narduk-libs#321).',
  '',
  '--project/--config used to mean `doppler run --project <p> --config <c>`.',
  'Choose the route this app actually needs:',
  '',
  '  no secrets in local development:',
  '    narduk-app dev -- nuxt dev --host 127.0.0.1',
  '',
  '  registered local credential route:',
  '    narduk-app dev --credentials nvault \\',
  '      --project <project> --environment <environment> --config <config> \\',
  '      -- nuxt dev --host 127.0.0.1',
  '',
  'The nvault route runs `nvault run -p <project> -e <environment> -c <config>',
  '-- <command>`, which keeps values process-local (company-hq',
  'docs/SECRETS-MATRIX.md, plane 4). Doppler ne/* root provisioners are not an',
  'application development credential source.',
].join('\n')

const NVAULT_INSTALL_HINT =
  'Install and authenticate the pinned nvault CLI, then retry. ' +
  'Run `narduk-app dev --dry-run ...` to print the exact command without running it.'

export function parseDevArgs(args: string[]): DevFlags {
  let afterSeparator = false
  let dryRun = false
  let config: string | undefined
  let credentials: DevCredentialRoute | undefined
  let environment: string | undefined
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
    } else if (arg === '--credentials') {
      credentials = parseCredentialRoute(args[++index])
    } else if (arg === '--project') {
      project = args[++index]
      if (!project) throw new Error('--project requires a value')
    } else if (arg === '--environment') {
      environment = args[++index]
      if (!environment) throw new Error('--environment requires a value')
    } else if (arg === '--config') {
      config = args[++index]
      if (!config) throw new Error('--config requires a value')
    } else if (arg === '--help' || arg === '-h') {
      throw new Error(DEV_USAGE)
    } else {
      throw new Error(`Unknown dev option: ${arg}`)
    }
  }

  const selectors = { config, environment, project }
  if (credentials === 'nvault') assertCompleteSelector(selectors)
  else assertNoSelector(selectors, credentials)

  return {
    command: command.length > 0 ? command : ['nuxt', 'dev'],
    config,
    credentials: credentials ?? 'none',
    dryRun,
    environment,
    project,
  }
}

function parseCredentialRoute(value: string | undefined): DevCredentialRoute {
  if (!value) throw new Error('--credentials requires a value (none or nvault)')
  if (value === 'none' || value === 'nvault') return value
  if (value === 'doppler') throw new Error(RETIRED_DOPPLER_MESSAGE)
  throw new Error(`Unknown credential route: ${value}. Use none or nvault.`)
}

function assertCompleteSelector(selectors: {
  config?: string
  environment?: string
  project?: string
}): void {
  const missing = (['project', 'environment', 'config'] as const).filter((name) => !selectors[name])
  if (missing.length === 0) return
  throw new Error(
    `--credentials nvault requires ${missing.map((name) => `--${name}`).join(', ')}. ` +
      'The route resolves exactly one nvault config: ' +
      '`nvault run -p <project> -e <environment> -c <config> -- <command>`.',
  )
}

function assertNoSelector(
  selectors: { config?: string; environment?: string; project?: string },
  credentials: DevCredentialRoute | undefined,
): void {
  const present = (['project', 'environment', 'config'] as const).filter((name) => selectors[name])
  if (present.length === 0) return
  // An explicit `--credentials none` plus a selector is a contradiction the
  // caller can see; an omitted route with `--project/--config` is the retired
  // Doppler invocation, which gets the full migration message instead.
  if (credentials === 'none') {
    throw new Error(
      `${present.map((name) => `--${name}`).join(', ')} ${present.length === 1 ? 'is' : 'are'} ` +
        'only valid with --credentials nvault.',
    )
  }
  throw new Error(RETIRED_DOPPLER_MESSAGE)
}

export function buildNvaultRunArgs(
  flags: Pick<DevFlags, 'command' | 'config' | 'environment' | 'project'>,
): string[] {
  const { command, config, environment, project } = flags
  if (!project || !environment || !config) {
    throw new Error('The nvault route requires project, environment and config.')
  }
  return ['run', '-p', project, '-e', environment, '-c', config, '--', ...command]
}

export function buildDevInvocation(flags: DevFlags): DevInvocation {
  if (flags.credentials === 'nvault') {
    return { args: buildNvaultRunArgs(flags), command: 'nvault' }
  }
  const [command, ...args] = flags.command
  if (!command) throw new Error('A dev command is required.')
  return { args, command }
}

export function formatDevInvocation(invocation: DevInvocation): string {
  return [invocation.command, ...invocation.args].join(' ')
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
  const invocation = buildDevInvocation(flags)
  if (flags.dryRun) {
    console.log(formatDevInvocation(invocation))
    return 0
  }
  const result = spawnSync(invocation.command, invocation.args, { env, stdio: 'inherit' })
  if (result.error) {
    console.error(`Could not run ${invocation.command}: ${result.error.message}`)
    if (flags.credentials === 'nvault') console.error(NVAULT_INSTALL_HINT)
    return 1
  }
  return resolveChildExitCode(result)
}
