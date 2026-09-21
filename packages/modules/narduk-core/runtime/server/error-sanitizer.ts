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
  statusCode?: number | string
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
  const raw = error.statusCode
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  // A string status only counts when it names a real HTTP status. `Number()`
  // alone would read `"-1"` or `"0"` as sub-500 and skip the sanitizer on an
  // error that carries no usable status at all.
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (/^\d{3}$/u.test(trimmed)) {
      const parsed = Number(trimmed)
      if (parsed >= 100 && parsed <= 599) return parsed
    }
  }
  return 500
}

export function shouldSanitizeProductionError(
  error: SanitizableServerError,
  previewSafeMode: boolean,
  isDev: boolean = Boolean(import.meta.dev),
): boolean {
  if (isDev) return false
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

/**
 * Overwrite one field, whatever shape the error is. A plain assignment throws
 * in strict mode (all ESM) when the property resolves to a getter with no
 * setter, or to a non-writable own value -- and the throw escapes into Nitro's
 * error handling, which turns the response into a 500 and discards the real
 * error (narduk-libs#640).
 *
 * `Reflect.set` reports that failure as `false` instead of throwing, so this
 * cannot throw by construction rather than by catching. Reporting it is not
 * enough on its own: the field would still hold its original, leaky value,
 * which is the whole point of sanitizing. `Reflect.defineProperty` then
 * defines an own data property that shadows an inherited accessor, so the
 * scrub actually happens.
 *
 * Both fail on an own property that is neither writable nor configurable, and
 * on a frozen error. Nothing can be done to those in place; returning `false`
 * is still better than throwing, which would lose the status as well.
 */
function scrubField(
  error: SanitizableServerError,
  key: keyof SanitizableServerError,
  value: unknown,
): boolean {
  // A setter that silently ignores its argument reports success, so read back.
  if (Reflect.set(error, key, value) && error[key] === value) return true
  return Reflect.defineProperty(error, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

/**
 * Remove one field. `delete` throws on a non-configurable own property -- the
 * same failure class as the assignment above, with the worse outcome of a 500
 * *and* the payload still attached. `Reflect.deleteProperty` reports it
 * instead, and setting the field to `undefined` is the degraded form: the key
 * survives, the value does not.
 */
function dropField(error: SanitizableServerError, key: keyof SanitizableServerError): boolean {
  if (Reflect.deleteProperty(error, key)) return true
  return scrubField(error, key, undefined)
}

/**
 * Mutates the error in place, and cannot throw. That is the contract, not a
 * side effect: this runs inside Nitro's error handler, so a throw here replaces
 * a correct status with a 500 and loses the original error entirely.
 */
export function sanitizeProductionError(error: SanitizableServerError, requestId?: string): void {
  scrubField(error, 'message', GENERIC_SERVER_ERROR_MESSAGE)
  scrubField(error, 'statusMessage', GENERIC_SERVER_ERROR_MESSAGE)
  // Only when the error actually carries one -- defining `statusText` on an
  // error shape that never had it would add a field to the serialized payload.
  if ('statusText' in error) {
    scrubField(error, 'statusText', GENERIC_SERVER_ERROR_MESSAGE)
  }
  dropField(error, 'data')
  dropField(error, 'cause')
  // Empty rather than removed: `stack` is an own accessor on an Error in V8 and
  // some engines refuse both paths, which is survivable -- message and data are
  // the leak.
  scrubField(error, 'stack', '')
  if (requestId) {
    scrubField(error, 'requestId', requestId)
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
 * returns without sending so Nuxt still renders `error.vue`. `nuxt dev` keeps
 * the original payload so operators can still see the leak locally.
 */
export function applyProductionErrorSanitizer(
  error: SanitizableServerError,
  event: ProductionErrorSanitizerEvent,
  isDev: boolean = Boolean(import.meta.dev),
): void {
  if (!error || typeof error !== 'object') return
  if (!shouldSanitizeProductionError(error, readPreviewSafeModeFromRuntime(event), isDev)) {
    return
  }

  sanitizeProductionError(error, readErrorRequestId(error, event))
}

export default function nardukProductionErrorSanitizer(
  error: SanitizableServerError,
  event: ProductionErrorSanitizerEvent,
): void {
  applyProductionErrorSanitizer(error, event, Boolean(import.meta.dev))
}
