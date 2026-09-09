import { resolveLogLevel as resolveSharedLevel } from '@narduk-enterprises/narduk-logging'
import { useLogger as useSharedLogger } from '@narduk-enterprises/narduk-logging/h3'
import { useRuntimeConfig } from 'nitropack/runtime'

import { readRuntimeString } from './runtime-env'
import { readWorkerRuntimeEnv } from './worker-env'

import type { Logger as SharedLogger } from '@narduk-enterprises/narduk-logging'
import type { RequestLoggingOptions } from '@narduk-enterprises/narduk-logging/h3'
import type { H3Event } from 'h3'

export { ensureRequestId } from '@narduk-enterprises/narduk-logging/h3'

/** Retained for source compatibility with existing apps and shared modules. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

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
