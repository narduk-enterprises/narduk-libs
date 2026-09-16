/**
 * Database backend selection, shared by the narduk-core module at build time
 * and by its server runtime.
 *
 * An app declares its backend with the `nardukCore.databaseBackend` module
 * option or `NUXT_DATABASE_BACKEND`. An app that declares nothing keeps the
 * historical D1 default, and the selection records that it was not declared so
 * `/api/health` can tell a missing-but-promised database from a legacy default.
 */
export const DATABASE_BACKENDS = ['d1', 'postgres', 'none'] as const

export type DatabaseBackend = (typeof DATABASE_BACKENDS)[number]

/**
 * Where the selected backend came from. `default` means the app declared no
 * backend and inherited D1.
 */
export type DatabaseBackendSource = 'option' | 'env' | 'runtimeConfig' | 'default'

export interface DatabaseBackendSelection {
  backend: DatabaseBackend
  source: DatabaseBackendSource
}

export interface DatabaseBackendInputs {
  /** The `nardukCore.databaseBackend` module option. */
  option?: unknown
  /** `NUXT_DATABASE_BACKEND` in the build environment. */
  env?: string | undefined
  /**
   * The `runtimeConfig.databaseBackend` / `databaseBackendSource` pair already
   * present on the Nuxt options: authored by the app, or written by an earlier
   * run of this module.
   */
  runtimeConfig?: {
    databaseBackend?: unknown
    databaseBackendSource?: unknown
  }
}

const DATABASE_BACKEND_SOURCES: readonly DatabaseBackendSource[] = [
  'option',
  'env',
  'runtimeConfig',
  'default',
]

export function isDatabaseBackend(value: unknown): value is DatabaseBackend {
  return typeof value === 'string' && (DATABASE_BACKENDS as readonly string[]).includes(value)
}

function isDatabaseBackendSource(value: unknown): value is DatabaseBackendSource {
  return (
    typeof value === 'string' && (DATABASE_BACKEND_SOURCES as readonly string[]).includes(value)
  )
}

function describeBackendChoices(): string {
  return DATABASE_BACKENDS.map((backend) => `'${backend}'`).join(', ')
}

/**
 * Resolve the database backend once: module option, then
 * `NUXT_DATABASE_BACKEND`, then a value already on `runtimeConfig`, then the
 * undeclared D1 default.
 *
 * An invalid module option throws, because the option is new and explicit. An
 * unrecognized environment value is ignored with a warning, which keeps the
 * historical "anything else means D1" build behavior instead of breaking it.
 */
export function resolveDatabaseBackendSelection(
  inputs: DatabaseBackendInputs,
  warn: (message: string) => void = (message) => console.warn(message),
): DatabaseBackendSelection {
  if (inputs.option !== undefined) {
    if (!isDatabaseBackend(inputs.option)) {
      throw new Error(
        `[narduk-core] nardukCore.databaseBackend must be one of ${describeBackendChoices()}; received ${JSON.stringify(inputs.option)}.`,
      )
    }
    return { backend: inputs.option, source: 'option' }
  }

  const env = inputs.env?.trim()
  if (env) {
    if (isDatabaseBackend(env)) {
      return { backend: env, source: 'env' }
    }
    warn(
      `[narduk-core] Ignoring NUXT_DATABASE_BACKEND=${JSON.stringify(env)}; expected one of ${describeBackendChoices()}.`,
    )
  }

  const existingBackend = inputs.runtimeConfig?.databaseBackend
  if (existingBackend !== undefined && existingBackend !== '') {
    if (isDatabaseBackend(existingBackend)) {
      const existingSource = inputs.runtimeConfig?.databaseBackendSource
      // A source is present only when this module wrote the pair on an earlier
      // run; keep it so a repeated setup never turns the default into a declaration.
      return {
        backend: existingBackend,
        source: isDatabaseBackendSource(existingSource) ? existingSource : 'runtimeConfig',
      }
    }
    warn(
      `[narduk-core] Ignoring runtimeConfig.databaseBackend=${JSON.stringify(existingBackend)}; expected one of ${describeBackendChoices()}.`,
    )
  }

  return { backend: 'd1', source: 'default' }
}

/** True when the app explicitly chose its backend rather than inheriting D1. */
export function isDatabaseBackendDeclared(source: unknown): boolean {
  return isDatabaseBackendSource(source) && source !== 'default'
}

export interface DatabaseBackendConflictInputs {
  databaseBackend?: unknown
  authBackend?: unknown
  nardukHealth?: unknown
}

/**
 * True when narduk-auth is installed: current releases set
 * `runtimeConfig.nardukHealth.authTables`, and every release sets
 * `runtimeConfig.authBackend`.
 */
export function usesNardukAuth(runtimeConfig: DatabaseBackendConflictInputs): boolean {
  const health = runtimeConfig.nardukHealth
  if (
    health !== null &&
    typeof health === 'object' &&
    (health as { authTables?: unknown }).authTables === true
  ) {
    return true
  }
  return typeof runtimeConfig.authBackend === 'string' && runtimeConfig.authBackend !== ''
}

/**
 * The build-time message for a configuration that cannot work, or `null`.
 * narduk-auth keeps users, sessions and API keys in the app database, so it
 * cannot run in an app that declares `databaseBackend: 'none'`.
 */
export function findDatabaseBackendConflict(
  runtimeConfig: DatabaseBackendConflictInputs,
): string | null {
  if (runtimeConfig.databaseBackend !== 'none' || !usesNardukAuth(runtimeConfig)) {
    return null
  }
  return (
    "[narduk-core] databaseBackend 'none' conflicts with @narduk-enterprises/narduk-auth: " +
    'sign-in stores users, sessions and API keys in the app database. Remove narduk-auth, ' +
    "or declare databaseBackend 'd1' or 'postgres'."
  )
}
