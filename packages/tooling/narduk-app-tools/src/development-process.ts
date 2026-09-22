import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type {
  DevelopmentCommand,
  DevelopmentComponent,
  DevelopmentVaultSelector,
} from './development-config.js'
import { reservedDevelopmentVariable } from './development-config.js'
import {
  assertCapturedInputs,
  dependencyFingerprint,
  type SourceSnapshot,
} from './development-source.js'
import { declarationDigest, readPrivateJson, writePrivateJson } from './development-state.js'
import { assertProductionBuildSecret } from './hotfix-plan.js'

/** Only these workstation values cross a phase boundary implicitly. */
export function developmentSystemEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'PNPM_HOME',
    'LANG',
    'LC_ALL',
  ]
  return Object.fromEntries(
    allowed.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
  )
}

export type DevelopmentSecretReader = (selector: DevelopmentVaultSelector) => string

/** Resolve exactly one declared value in memory. The vault config is never printed or persisted. */
export function readDevelopmentSecret(selector: DevelopmentVaultSelector): string {
  let result: string
  try {
    result = execFileSync(
      'nvault',
      [
        'run',
        '-p',
        selector.project,
        '-e',
        selector.environment,
        '-c',
        selector.config,
        '--',
        process.execPath,
        '-e',
        'const value = process.env[process.argv[1]]; if (!value) process.exit(2); process.stdout.write(JSON.stringify({value}));',
        selector.key,
      ],
      {
        env: developmentSystemEnv(),
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
  } catch {
    throw new Error(`Could not resolve declared vault input ${selector.key}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(result)
  } catch {
    throw new Error(`Vault input ${selector.key} was not a structured response`)
  }
  const value = (parsed as { value?: unknown })?.value
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim() === 'null' ||
    value.includes('::add-mask::')
  )
    throw new Error(`Vault input ${selector.key} is missing or invalid`)
  return value
}

export function developmentBuildEnvironment(
  component: DevelopmentComponent,
  buildId: string,
  readSecret: DevelopmentSecretReader = readDevelopmentSecret,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...developmentSystemEnv(inherited),
    ...component.buildVariables,
    CI: 'true',
    NUXT_TELEMETRY_DISABLED: '1',
    BUILD_VERSION: buildId,
    NUXT_PUBLIC_BUILD_VERSION: buildId,
    NARDUK_ALLOW_LOCAL_WRANGLER_DEPLOY: '1',
  }
  for (const [name, selector] of Object.entries(component.buildSecrets)) {
    if (reservedDevelopmentVariable(name))
      throw new Error(`${name} is not an app-owned build secret`)
    const value = readSecret(selector)
    if (!value.trim() || value.trim() === 'null' || value.startsWith('narduk-test-only-'))
      throw new Error(`Required build input ${name} is missing or a test placeholder`)
    assertProductionBuildSecret(name, value)
    result[name] = value
  }
  return result
}

export interface DevelopmentProcessContext {
  log?: (message: string) => void
  /** Secret values for output redaction only; never retained. */
  redact?: string[]
}
export function runDevelopmentCommand(
  command: DevelopmentCommand,
  workspace: string,
  env: NodeJS.ProcessEnv,
  context: DevelopmentProcessContext = {},
): void {
  const cwd = resolve(workspace, command.cwd)
  const path = relative(resolve(workspace), cwd)
  if (path === '..' || path.startsWith('../') || isAbsolute(path))
    throw new Error('Command cwd escapes the build workspace')
  const result = spawnSync(command.executable, command.args, {
    cwd,
    env,
    shell: false,
    encoding: 'utf8',
    timeout: command.timeoutSeconds * 1000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  for (const value of context.redact ?? [])
    if (value) output = output.replaceAll(value, '[REDACTED]')
  if (output) context.log?.(output)
  if (result.error || result.signal || result.status !== 0)
    throw new Error(
      `Command ${command.executable} failed${result.signal ? ` (${result.signal})` : ` (exit ${String(result.status)})`}`,
    )
}

/** Authentication is requested only on a cache miss; ordinary warm builds need no GitHub access. */
export function prepareDevelopmentDependencies(
  snapshot: SourceSnapshot,
  workspace: string,
  cacheDirectory: string,
  install: DevelopmentCommand,
  packageManagerVersion: string,
  context: {
    run?: typeof runDevelopmentCommand
    env?: NodeJS.ProcessEnv
    /** Called only on a cache miss, so warm deploys read no registry credential. */
    secrets?: () => Record<string, string>
  } = {},
): { reused: boolean; fingerprint: string } {
  const fingerprint = declarationDigest({
    inputs: dependencyFingerprint(snapshot, packageManagerVersion),
    install,
  })
  const path = join(cacheDirectory, 'dependencies.json')
  if (
    existsSync(path) &&
    existsSync(join(workspace, 'node_modules')) &&
    (readPrivateJson(path) as { fingerprint?: string }).fingerprint === fingerprint
  )
    return { reused: true, fingerprint }
  const run = context.run ?? runDevelopmentCommand
  const secrets = context.secrets?.() ?? {}
  run(
    install,
    workspace,
    { ...developmentSystemEnv(context.env), ...secrets, CI: 'true', NODE_ENV: 'development' },
    { redact: Object.values(secrets) },
  )
  assertCapturedInputs(snapshot, workspace)
  if (!existsSync(join(workspace, 'node_modules')))
    throw new Error('Dependency preparation did not create node_modules')
  writePrivateJson(path, { schemaVersion: 1, fingerprint })
  return { reused: false, fingerprint }
}
