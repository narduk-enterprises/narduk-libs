import { resolveLogLevel as resolveSharedLevel } from '@narduk-enterprises/narduk-logging'
import { useLogger as useSharedLogger } from '@narduk-enterprises/narduk-logging/h3'

import { readRuntimeString } from './runtime-env'
import { readWorkerRuntimeEnv } from './worker-env'

import type { Logger as SharedLogger } from '@narduk-enterprises/narduk-logging'
import type { RequestLoggingOptions } from '@narduk-enterprises/narduk-logging/h3'
import type { H3Event } from 'h3'

export { ensureRequestId } from '@narduk-enterprises/narduk-logging/h3'

/** Retained for source compatibility with existing apps and shared modules. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

type NitroRuntimeConfigAccessor = (event?: H3Event) => Record<string, unknown>

/**
 * `nitropack/runtime`'s entry point is a barrel file that statically
 * re-exports every internal submodule regardless of which export an
 * importer actually asked for — including `internal/storage.mjs`, which
 * references a build-time-only virtual specifier
 * (`#nitro-internal-virtual/storage`) that only resolves inside a booted
 * Nitro server. A *static* `import { useRuntimeConfig } from
 * 'nitropack/runtime'` therefore made this module — and anything that
 * imports it, such as `listQuery.ts` — unloadable in a plain unit test or
 * any other context that never boots Nitro. Surfaced when narduk-ai's and
 * narduk-auth's list-route unit tests started failing after `listQuery.ts`
 * picked up a transitive import of this module (see
 * `.changeset/list-query-tolerate-unknown-keys.md`).
 *
 * Resolve it lazily instead: kick off a dynamic import once at module load
 * and cache the outcome (module or failure) for later synchronous reads. In
 * a real Nitro server the module is already resolvable — Nitro's own
 * bootstrap depends on it — so in practice this settles well before request
 * handling begins; outside Nitro it settles to `null`, and every caller
 * below already treats "runtime config unavailable" as an expected, handled
 * case via its existing try/catch.
 */
let cachedUseRuntimeConfig: NitroRuntimeConfigAccessor | null | undefined

void import('nitropack/runtime')
  .then(
    (nitroRuntime) =>
      (cachedUseRuntimeConfig = nitroRuntime.useRuntimeConfig as NitroRuntimeConfigAccessor),
  )
  .catch(() => {
    cachedUseRuntimeConfig = null
  })

function useRuntimeConfig(event?: H3Event): Record<string, unknown> {
  if (!cachedUseRuntimeConfig) {
    throw new Error('Nitro runtime config is unavailable outside a booted Nitro server.')
  }
  return cachedUseRuntimeConfig(event)
}

export interface Logger {
  child: (scope: string) => Logger
  debug: (message: string, data?: Record<string, unknown>) => void
  error: (message: string, data?: Record<string, unknown>) => void
  info: (message: string, data?: Record<string, unknown>) => void
  warn: (message: string, data?: Record<string, unknown>) => void
}

const VALID_LEVELS = new Set<string>(['debug', 'info', 'warn', 'error', 'silent'])

/** Preserve the existing LOG_LEVEL / runtimeConfig.logLevel contract and fallback. */
export function resolveLogLevel(event: H3Event): LogLevel {
  try {
    const config = useRuntimeConfig(event)
    const level = readRuntimeString(event, 'LOG_LEVEL', {
      config,
      fallback: (config as Record<string, unknown>).logLevel,
    })
    if (level && VALID_LEVELS.has(level)) return level as LogLevel
  } catch {
    // Runtime configuration is unavailable in some isolated consumer fixtures.
  }
  return import.meta.dev ? 'debug' : 'warn'
}

/** Shared by this bridge and the one Nitro instrumentation plugin. */
export function resolveLoggingOptions(event?: H3Event): RequestLoggingOptions {
  let config: Record<string, unknown> = {}
  try {
    config = useRuntimeConfig(event)
  } catch {
    /* Isolated consumer without Nitro config. */
  }
  const settings = (config.nardukLogging ?? {}) as Partial<RequestLoggingOptions>
  const publicConfig = (config.public ?? {}) as Record<string, unknown>
  const legacy = event ? resolveLogLevel(event) : resolveSharedLevel(config.logLevel, 'warn')
  const configured = resolveSharedLevel(settings.level, legacy)
  const override = readWorkerRuntimeEnv(event).LOG_LEVEL
  return {
    ...settings,
    service:
      settings.service ||
      (typeof publicConfig.appName === 'string' ? publicConfig.appName : 'narduk-app'),
    environment: settings.environment || (import.meta.dev ? 'development' : 'production'),
    runtime: event?.context.cloudflare ? 'worker' : (settings.runtime ?? 'node'),
    level: resolveSharedLevel(override, configured),
    format: settings.format ?? 'json',
    requestLogging: settings.requestLogging ?? true,
  }
}

function compatibilityLogger(logger: SharedLogger, prefix = ''): Logger {
  const message = (value: string) => (prefix ? `${prefix} ${value}` : value)
  return {
    debug: (value, data) => logger.debug(message(value), data),
    info: (value, data) => logger.info(message(value), data),
    warn: (value, data) => logger.warn(message(value), data),
    error: (value, data) => logger.error(message(value), data),
    child: (scope) => compatibilityLogger(logger.child(scope), `${prefix}[${scope}]`),
  }
}

/** Request-local cache preserves old imports and scoped message formatting. */
export function useLogger(event: H3Event): Logger {
  const context = event.context as H3Event['context'] & { _logger?: Logger }
  context._logger ??= compatibilityLogger(useSharedLogger(event, resolveLoggingOptions(event)))
  return context._logger
}
