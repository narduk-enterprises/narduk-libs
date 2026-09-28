import { useLogger } from '../server/utils/logger'

import type { H3Event } from 'h3'

/**
 * One warning through the request logger (narduk-logging), never a thrown
 * error.
 *
 * The callers warn from places where the warning is a side note to the real
 * work: a KV cache falling back to its producer, a Nitro render hook making a
 * page `no-store`. Building the request logger reads runtime config and the
 * request context, and a consumer fixture without a booted Nitro server has
 * neither, so a failure there is swallowed rather than turning a fallback into
 * a 500. `console.warn` never threw, and this keeps that property.
 *
 * `scope` becomes the `[scope]` prefix on the message through the core
 * logger's `child()`, so the text matches what these call sites printed before
 * they moved off `console`.
 *
 * Lives outside `runtime/server/`, so Nitro's scan never auto-imports it
 * into apps.
 */
export function warnBestEffort(
  event: H3Event | { context?: Record<string, unknown>; path?: string },
  scope: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  try {
    useLogger(event as H3Event)
      .child(scope)
      .warn(message, data)
  } catch {
    // No request logger to reach; the warning is advisory and the caller's
    // own work must go on.
  }
}
