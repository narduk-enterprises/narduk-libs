/**
 * Preserve Cloudflare bindings across Nitro's in-process SSR fetch
 * (narduk-libs#49).
 *
 * The cloudflare-module preset stamps `event.context.cloudflare.env` on the
 * outer Worker request. A relative `useFetch` / `$fetch` during SSR creates a
 * new H3 event that does not inherit that object, so `useDatabase` 500s
 * ("D1 database binding not available") even though Wrangler still has `DB`.
 *
 * The outer request enters an AsyncLocalStorage store. Nested request hooks
 * copy that store back onto the event. A request that never saw a binding
 * still fails closed — this is propagation, not a global fallback.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import type { H3Event } from 'h3'

export interface CloudflareRequestContext {
  context?: unknown
  env?: unknown
  request?: unknown
  scheduled?: unknown
}

interface CloudflareEventContext {
  _platform?: { cloudflare?: CloudflareRequestContext }
  cloudflare?: CloudflareRequestContext
}

const requestContext = new AsyncLocalStorage<CloudflareRequestContext | null>()

function hasEnv(
  value: CloudflareRequestContext | null | undefined,
): value is CloudflareRequestContext {
  return value != null && value.env != null
}

export function readStoredCloudflareContext(): CloudflareRequestContext | undefined {
  const stored = requestContext.getStore()
  return hasEnv(stored) ? stored : undefined
}

export function captureCloudflareContext(event: H3Event): CloudflareRequestContext | undefined {
  const context = event.context as CloudflareEventContext
  const present = context.cloudflare ?? context._platform?.cloudflare
  return hasEnv(present) ? present : undefined
}

export function applyCloudflareContext(event: H3Event, cloudflare: CloudflareRequestContext): void {
  const context = event.context as CloudflareEventContext
  if (hasEnv(context.cloudflare)) return
  context.cloudflare = cloudflare
}

export function clearCloudflareRequestContext(): void {
  requestContext.enterWith(null)
}

export function isolateCloudflareRequestContext<T>(fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(requestContext.run(null, fn))
}

export function preserveCloudflareRequestContext(event: H3Event): void {
  const present = captureCloudflareContext(event)
  if (present) {
    requestContext.enterWith(present)
    return
  }

  const stored = readStoredCloudflareContext()
  if (stored) {
    applyCloudflareContext(event, stored)
  }
}
