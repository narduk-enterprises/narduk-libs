/**
 * Prepended Nitro error handler that strips leaky 5xx fields before Nuxt
 * serializes the error into `__NUXT_DATA__`.
 *
 * Nitro 2.13's generated wrapper (`#nitro-internal-virtual/error-handler`)
 * imports `nitro.options.errorHandler` in array order and stops only when
 * `event.handled`. This module mutates the error in place and returns without
 * sending, so Nuxt's handler still renders the estate `error.vue`.
 *
 * Do not assign `nitro.options.errorHandler` as a string from the Nuxt module
 * — that would drop Nuxt's renderer. Do not use Nitro's `error` hook as a
 * sanitizer: `onError` fires `captureError` un-awaited and then runs handlers.
 *
 * `narduk:exception` still sees the original error. Installed nitropack
 * `runtime/internal/app.mjs` calls `captureError` (which `callHookParallel`s
 * `error`) *before* `errorHandler`. hookable's `parallelTaskCaller` invokes
 * each hook function synchronously inside `hooks.map`, and the server capture
 * site is sync, so the report is published before this file runs.
 */
import { useRuntimeConfig } from 'nitropack/runtime'

import type { H3Event } from 'h3'

/** Same generic copy Nitro's prod `defaultHandler` uses for unhandled 5xx. */
export const GENERIC_SERVER_ERROR_MESSAGE = 'Server Error'

export interface SanitizableServerError {
  cause?: unknown
  data?: unknown
  message?: string
  requestId?: unknown
  stack?: string
  statusCode?: number
  statusMessage?: string
  statusText?: string
}

export interface ProductionErrorSanitizerEvent {
  context?: H3Event['context']
  /** Readonly to match `H3Event.handled` (a getter). */
  readonly handled?: boolean
}

/**
 * Same flag `error.vue` reads: `runtimeConfig.public.previewSafeMode === true`.
 * Staging/preview hosts that only flip the request-time overlay still sanitize,
 * matching the page, which never shows the raw message unless this public flag
 * is on.
 */
export function readPreviewSafeModeFlag(
  config: { public?: { previewSafeMode?: unknown } } | undefined,
): boolean {
  return config?.public?.previewSafeMode === true
}

export function readErrorStatusCode(error: SanitizableServerError): number {
  return typeof error.statusCode === 'number' && Number.isFinite(error.statusCode)
    ? error.statusCode
    : 500
}

export function shouldSanitizeProductionError(
  error: SanitizableServerError,
  previewSafeMode: boolean,
): boolean {
  return !previewSafeMode && readErrorStatusCode(error) >= 500
}

/**
 * Correlation id used by exception capture and the error page (`x-request-id` /
 * `event.context._requestId`). Read before `data` is dropped so a request id
 * that only lived on `error.data` still reaches operators.
 */
export function readErrorRequestId(
  error: SanitizableServerError,
  event?: ProductionErrorSanitizerEvent,
): string | undefined {
  const fromEvent = event?.context?._requestId
  if (typeof fromEvent === 'string' && fromEvent !== '') return fromEvent
  if (typeof error.requestId === 'string' && error.requestId !== '') return error.requestId
  const data = error.data
  if (data && typeof data === 'object') {
    const fromData = (data as { requestId?: unknown }).requestId
    if (typeof fromData === 'string' && fromData !== '') return fromData
  }
  return undefined
}

/**
 * Nitro 2.13's generated wrapper imports these paths in order. Prepend so the
 * sanitizer runs before Nuxt's Vue error handler (already on the array after
 * `createNitro`) without replacing it.
 */
export function prependNitroErrorHandler(
  errorHandler: string | string[] | undefined,
  handlerPath: string,
): string[] {
  const existing = Array.isArray(errorHandler) ? errorHandler : errorHandler ? [errorHandler] : []
  return [handlerPath, ...existing.filter((entry) => entry !== handlerPath)]
}

export function sanitizeProductionError(error: SanitizableServerError, requestId?: string): void {
  error.message = GENERIC_SERVER_ERROR_MESSAGE
  error.statusMessage = GENERIC_SERVER_ERROR_MESSAGE
  if ('statusText' in error) {
    error.statusText = GENERIC_SERVER_ERROR_MESSAGE
  }
  delete error.data
  delete error.cause
  try {
    error.stack = ''
  } catch {
    // Error.stack is not writable in some engines; message/data are the leak.
  }
  if (requestId) {
    error.requestId = requestId
  }
}

function readPreviewSafeModeFromRuntime(event: unknown): boolean {
  try {
    const config = useRuntimeConfig(event as never) as {
      public?: { previewSafeMode?: unknown }
    }
    return readPreviewSafeModeFlag(config)
  } catch {
    // Fail closed: a missing runtime config must not leak a production 500.
    return false
  }
}

/**
 * Nitro error handler. Mutates 5xx in place when preview-safe mode is off, then
 * returns without sending so Nuxt still renders `error.vue`.
 */
export default function nardukProductionErrorSanitizer(
  error: SanitizableServerError,
  event: ProductionErrorSanitizerEvent,
): void {
  if (!error || typeof error !== 'object') return
  if (!shouldSanitizeProductionError(error, readPreviewSafeModeFromRuntime(event))) {
    return
  }

  sanitizeProductionError(error, readErrorRequestId(error, event))
}
