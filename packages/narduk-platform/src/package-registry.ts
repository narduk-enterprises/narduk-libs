export interface PackageRegistryConfig {
  scope: string
  registryUrl: string
  authHostPath: string
  authTokenEnvVar: string
}

export const DEFAULT_PACKAGE_REGISTRY_SCOPE = '@narduk-enterprises'
export const MAPKIT_PACKAGE_REGISTRY_SCOPE = '@narduk-geo'
export const GITHUB_PACKAGE_REGISTRY_URL = 'https://npm.pkg.github.com'
export const GITHUB_PACKAGE_REGISTRY_READ_ENV_VAR = 'NARDUK_PLATFORM_GH_PACKAGES_READ'
export const GITHUB_PACKAGE_REGISTRY_WRITE_ENV_VAR = 'NARDUK_PLATFORM_GH_PACKAGES_WRITE'
export const GITHUB_PACKAGE_REGISTRY_LEGACY_RW_ENV_VAR = 'NARDUK_PLATFORM_GH_PACKAGES_RW'
export const GENERATED_PACKAGE_REGISTRY_AUTH_CONFIG_PATH = '.npmrc.auth'

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function normalizeToken(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function resolvePackageRegistryAuthEnvVar(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    preferWrite?: boolean
  } = {},
) {
  if (options.preferWrite) {
    return normalizeToken(env[GITHUB_PACKAGE_REGISTRY_WRITE_ENV_VAR])
      ? GITHUB_PACKAGE_REGISTRY_WRITE_ENV_VAR
      : normalizeToken(env[GITHUB_PACKAGE_REGISTRY_LEGACY_RW_ENV_VAR])
        ? GITHUB_PACKAGE_REGISTRY_LEGACY_RW_ENV_VAR
        : GITHUB_PACKAGE_REGISTRY_WRITE_ENV_VAR
  }

  return normalizeToken(env[GITHUB_PACKAGE_REGISTRY_READ_ENV_VAR])
    ? GITHUB_PACKAGE_REGISTRY_READ_ENV_VAR
    : normalizeToken(env[GITHUB_PACKAGE_REGISTRY_LEGACY_RW_ENV_VAR])
      ? GITHUB_PACKAGE_REGISTRY_LEGACY_RW_ENV_VAR
      : GITHUB_PACKAGE_REGISTRY_READ_ENV_VAR
}

export function resolvePackageRegistryToken(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    preferWrite?: boolean
  } = {},
) {
  if (options.preferWrite) {
    return (
      normalizeToken(env[GITHUB_PACKAGE_REGISTRY_WRITE_ENV_VAR]) ??
      normalizeToken(env[GITHUB_PACKAGE_REGISTRY_LEGACY_RW_ENV_VAR]) ??
      ''
    )
  }

  return (
    normalizeToken(env[GITHUB_PACKAGE_REGISTRY_READ_ENV_VAR]) ??
    normalizeToken(env[GITHUB_PACKAGE_REGISTRY_LEGACY_RW_ENV_VAR]) ??
    ''
  )
}

export function hasPackageRegistryReadToken(env: NodeJS.ProcessEnv = process.env) {
  return resolvePackageRegistryToken(env).length > 0
}

export function getPackageRegistryConfig(
  env: NodeJS.ProcessEnv = process.env,
): PackageRegistryConfig {
  const url = new URL(GITHUB_PACKAGE_REGISTRY_URL)

  return {
    scope: DEFAULT_PACKAGE_REGISTRY_SCOPE,
    registryUrl: GITHUB_PACKAGE_REGISTRY_URL,
    authHostPath: `${url.host}${ensureTrailingSlash(url.pathname)}`,
    authTokenEnvVar: resolvePackageRegistryAuthEnvVar(env),
  }
}

export function buildPackageRegistryLine(config: PackageRegistryConfig): string {
  return `${config.scope}:registry=${config.registryUrl}`
}

export function buildPackageRegistryAuthLine(config: PackageRegistryConfig): string {
  return `//${config.authHostPath}:_authToken=\${${config.authTokenEnvVar}}`
}

function isManagedRegistryAuthLine(line: string): boolean {
  return (
    line.includes('//npm.pkg.github.com/:_authToken=') ||
    /\/\/[^/]+\/api\/packages\/.+\/npm\/:_authToken=/.test(line)
  )
}

function isLegacyPackageRegistryLine(line: string): boolean {
  return line.includes('/api/packages/')
}

function normalizeBlankLines(lines: string[]): string[] {
  return lines.reduce<string[]>((accumulator, line) => {
    if (line === '' && accumulator[accumulator.length - 1] === '') {
      return accumulator
    }

    accumulator.push(line)
    return accumulator
  }, [])
}

export function patchPackageRegistryNpmrcContent(
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const config = getPackageRegistryConfig(env)
  const registryScopes = [config.scope, MAPKIT_PACKAGE_REGISTRY_SCOPE]
  const registryLines = registryScopes.map((scope) => `${scope}:registry=${config.registryUrl}`)

  const retainedLines = content
    .split('\n')
    .filter((line) => !isManagedRegistryAuthLine(line))
    .filter((line) => !isLegacyPackageRegistryLine(line))
    .filter((line) => !line.includes('Auth token injected via CI env'))
    .filter(
      (line) =>
        !registryScopes.some((scope) => line.startsWith(`${scope}:registry=`)) &&
        !line.startsWith('@loganrenz:registry='),
    )

  const finalLines = [...registryLines, ...normalizeBlankLines(retainedLines)]

  return `${finalLines.join('\n').trimEnd()}\n`
}
