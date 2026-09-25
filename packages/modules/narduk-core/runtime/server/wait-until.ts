/**
 * Keep background work alive past the response (narduk-libs#991).
 *
 * On Workers, work the response does not wait on can be cancelled once the
 * response is sent, so a cache write or stale refresh that is not handed to
 * `waitUntil` can silently never finish. Five apps resolved "the runtime's
 * `waitUntil`" from an h3 event by hand and disagreed on lookup order, method
 * binding and what happens when there is none. This is the one resolver.
 *
 * - Lookup order, per host: Nitro's `event.waitUntil`, then the Cloudflare
 *   `ExecutionContext` at `event.context.cloudflare.context`, then
 *   `event.context.waitUntil`.
 * - Each candidate is called as a method on its owner, never pulled into a
 *   local: a detached `ExecutionContext.waitUntil` throws on Workers.
 * - A Nitro internal fetch (`$fetch` to a local route during SSR) gets an event
 *   with no `waitUntil` of its own. The walk then follows
 *   `event.context.nuxt.ssrContext.event` to the SSR parent.
 *
 * Import it explicitly from `@narduk-enterprises/narduk-core/server/wait-until`.
 * It is not under `server/utils`, so it adds no auto-imported names to
 * consuming apps (buoys already declares its own `resolveWaitUntil`).
 */

import { useLogger } from './utils/logger'

import type { H3Event } from 'h3'

/** Hand a promise to the runtime so it outlives the response. */
export type WaitUntil = (task: Promise<unknown>) => void

interface WaitUntilOwner {
  waitUntil?: unknown
}

interface WaitUntilHost extends WaitUntilOwner {
  context?: WaitUntilOwner & {
    cloudflare?: { context?: WaitUntilOwner }
    nuxt?: { ssrContext?: { event?: unknown } }
  }
}

function asHost(value: unknown): WaitUntilHost | null {
  return value !== null && typeof value === 'object' ? (value as WaitUntilHost) : null
}

/** Bind `owner.waitUntil` as a method call, or null when it is not a function. */
function methodOf(owner: WaitUntilOwner | null | undefined): WaitUntil | null {
  if (!owner || typeof owner.waitUntil !== 'function') return null
  return (task) => {
    ;(owner.waitUntil as (this: WaitUntilOwner, task: Promise<unknown>) => void).call(owner, task)
  }
}

function ownWaitUntil(host: WaitUntilHost): WaitUntil | null {
  return methodOf(host) ?? methodOf(host.context?.cloudflare?.context) ?? methodOf(host.context)
}

/**
 * The runtime's `waitUntil` for this request, bound to its owner, or `null`
 * when neither the event nor any SSR parent carries one (dev, node presets,
 * unit tests).
 */
export function resolveWaitUntil(event: H3Event | null | undefined): WaitUntil | null {
  const seen = new Set<object>()
  let host = asHost(event)
  while (host && !seen.has(host)) {
    seen.add(host)
    const found = ownWaitUntil(host)
    if (found) return found
    host = asHost(host.context?.nuxt?.ssrContext?.event)
  }
  return null
}

export interface RunInBackgroundOptions {
  /**
   * What to do when no `waitUntil` exists. `'detach'` (the default) lets the
   * task run on with `onError` attached. `'await'` waits for it, which is the
   * safe choice when the work must finish and the platform could otherwise
   * cancel it.
   */
  fallback?: 'await' | 'detach'
  /**
   * Called with the task's rejection. Defaults to an `error` line on the
   * request logger. A throw from it is swallowed: background work never
   * rejects into the request.
   */
  onError?: (error: unknown) => void
}

function reportError(event: H3Event, error: unknown, onError?: (error: unknown) => void): void {
  try {
    if (onError) {
      onError(error)
      return
    }
    useLogger(event)
      .child('Background')
      .error('Background task failed', { error: String(error) })
  } catch {
    // Reporting a background failure must not become a second failure.
  }
}

/**
 * Run `task` past the response: hand it to the runtime's `waitUntil` when
 * there is one, otherwise detach or await it per `fallback`. A rejection is
 * always observed (`onError`, or the request logger), and the returned
 * promise never rejects.
 *
 * @example
 * ```ts
 * import { runInBackground } from '@narduk-enterprises/narduk-core/server/wait-until'
 *
 * await runInBackground(event, cache.put(key, response.clone()))
 * ```
 */
export async function runInBackground(
  event: H3Event,
  task: Promise<unknown>,
  options: RunInBackgroundOptions = {},
): Promise<void> {
  const guarded = (async () => {
    try {
      await task
    } catch (error) {
      reportError(event, error, options.onError)
    }
  })()

  const waitUntil = resolveWaitUntil(event)
  if (waitUntil) {
    try {
      waitUntil(guarded)
      return
    } catch {
      // The context refused the task (for example, it has already finished).
      // Fall through to the fallback so the work is not silently dropped.
    }
  }

  if (options.fallback === 'await') await guarded
}
