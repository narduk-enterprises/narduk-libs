import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const NARDUK_SCOPE = '@narduk-enterprises'
export const NARDUK_REGISTRY = 'https://npm.pkg.github.com'

export interface RegistryAuthConfig {
  authTokenEnvVar: string
  registryUrl: string
}

const READ_TOKEN = 'GH_PACKAGES_READ'
const WRITE_TOKEN = 'NARDUK_PLATFORM_GH_PACKAGES_WRITE'
const LEGACY_TOKEN = 'NARDUK_PLATFORM_GH_PACKAGES_RW'

export function resolveRegistryConfig(env: NodeJS.ProcessEnv = process.env): RegistryAuthConfig {
  const read = env[READ_TOKEN]?.trim() ?? ''
  const write = env[WRITE_TOKEN]?.trim() ?? ''
  const legacy = env[LEGACY_TOKEN]?.trim() ?? ''
  const preferWrite = ['1', 'true', 'yes'].includes(
    env.PACKAGE_REGISTRY_PREFER_WRITE?.toLowerCase() ?? '',
  )
  const token = preferWrite ? write || legacy || read : read || legacy || write
  const authTokenEnvVar = preferWrite
    ? write
      ? WRITE_TOKEN
      : legacy
        ? LEGACY_TOKEN
        : READ_TOKEN
    : read
      ? READ_TOKEN
      : legacy
        ? LEGACY_TOKEN
        : WRITE_TOKEN
  if (!token) throw new Error(`Missing ${READ_TOKEN}, ${WRITE_TOKEN}, or ${LEGACY_TOKEN}`)
  return {
    authTokenEnvVar,
    registryUrl: NARDUK_REGISTRY,
  }
}

// Scopes whose packages no longer exist; a stale route for either is dropped.
const RETIRED_SCOPES = ['@narduk-geo', '@loganrenz']

function stripManagedAuthLines(content: string): string[] {
  return content
    .split('\n')
    .filter(
      (line) =>
        !line.includes('//npm.pkg.github.com/:_authToken=') &&
        !line.includes('/api/packages/') &&
        !/\/\/[^/]+\/api\/packages\/.+\/npm\/:_authToken=/u.test(line),
    )
}

export function renderRegistryAuth(
  baseContent: string,
  existingContent: string,
  config: RegistryAuthConfig,
): string {
  const registryLine = `${NARDUK_SCOPE}:registry=${config.registryUrl}`
  const authLine = `//npm.pkg.github.com/:_authToken=\${${config.authTokenEnvVar}}`
  const lines: string[] = []
  const seen = new Set<string>()
  for (const content of [baseContent, existingContent]) {
    for (const rawLine of stripManagedAuthLines(content)) {
      const line = rawLine.trimEnd()
      if (!line) continue
      if (
        [NARDUK_SCOPE, ...RETIRED_SCOPES].some((scope) => line.startsWith(`${scope}:registry=`))
      ) {
        continue
      }
      if (seen.has(line)) continue
      seen.add(line)
      lines.push(line)
    }
  }
  return `${[registryLine, ...lines, authLine].join('\n').trimEnd()}\n`
}

export function configureRegistryAuth(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const targetPath = resolve(cwd, env.PACKAGE_REGISTRY_NPMRC_PATH || '.npmrc.auth')
  const basePath = resolve(cwd, '.npmrc')
  const baseContent =
    targetPath === basePath || !existsSync(basePath) ? '' : readFileSync(basePath, 'utf8')
  const existingContent = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : ''
  const content = renderRegistryAuth(baseContent, existingContent, resolveRegistryConfig(env))
  writeFileSync(targetPath, content, 'utf8')
  return targetPath
}
