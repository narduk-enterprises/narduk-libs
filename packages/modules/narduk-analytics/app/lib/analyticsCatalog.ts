import type { z } from 'zod'

/**
 * The part of the event registry that does not need Zod's schema constructors.
 * Apps and the shared composable import this module on the client's critical
 * path, so it imports nothing from `zod` as a value: any value import, even
 * Zod's tiny `config`, keeps part of its core in the entry chunk. The shared
 * schemas live in `analyticsEvents.ts` and load on the first `capture()`
 * (narduk-libs#1527).
 */

/** Names of the shared events; `analyticsEvents.ts` is tested to declare exactly these. */
export const STANDARD_ANALYTICS_EVENT_NAMES = [
  'page_engagement',
  'scroll_depth_reached',
  'search_completed',
  'filter_changed',
  'sort_changed',
  'form_submitted',
  'form_succeeded',
  'form_failed',
  'share_clicked',
  'clipboard_copied',
  'file_downloaded',
  'outbound_link_clicked',
  'empty_state_shown',
  'error_state_shown',
  'auth_session_started',
  'auth_session_ended',
  'auth_signed_in',
  'auth_signed_out',
  'auth_signed_up',
] as const

const standardNames: ReadonlySet<string> = new Set(STANDARD_ANALYTICS_EVENT_NAMES)

export function isStandardAnalyticsEvent(name: string): boolean {
  return standardNames.has(name)
}

/**
 * Zod 4 probes `new Function('')` the first time it builds an object schema, and
 * reads `globalConfig.jitless` while it does. Under an enforced no-eval CSP the
 * probe throws and is caught, yet the browser still reports a `script-src`
 * violation (narduk-libs#1310). `jitless` is read when a schema is constructed
 * and the probe is skipped entirely when it is set, so building schemas inside
 * this scope never touches `Function`.
 *
 * The flag is restored in `finally`: apps keep their own Zod configuration, and
 * the JIT probe result stays uncached for schemas an app builds outside the
 * scope. Validation results are identical; only the optional JIT fast path is off.
 *
 * `z.config()` returns the object Zod 4.4 keeps on `globalThis.__zod_globalConfig`
 * so duplicate Zod copies share one configuration. This reads and writes that
 * object directly, which needs no Zod import; `tests/analytics-csp-no-eval.test.ts`
 * fails if a Zod upgrade stops sharing it.
 */
export function withJitlessSchemas<T>(build: () => T): T {
  const zodGlobal = globalThis as typeof globalThis & { __zod_globalConfig?: { jitless?: boolean } }
  const zodConfig = (zodGlobal.__zod_globalConfig ??= {})
  const previous = zodConfig.jitless
  zodConfig.jitless = true
  try {
    return build()
  } finally {
    zodConfig.jitless = previous
  }
}

export type AnalyticsCatalog = Record<string, z.ZodType<Record<string, unknown>>>
export type AnalyticsEventProperties<T extends AnalyticsCatalog, K extends keyof T> = z.input<T[K]>

/**
 * Apps own domain events; reserved shared and PostHog event names cannot be redefined.
 *
 * Pass a factory (`defineAnalyticsEvents(() => ({ ... }))`) to build the app's
 * schemas inside {@link withJitlessSchemas}. An app that builds `z.object(...)`
 * schemas itself, at module top level, otherwise triggers the Zod `Function`
 * probe that an enforced no-eval CSP reports (narduk-libs#1310). The factory form
 * needs the app and this package to share one `zod` instance, the normal
 * deduplicated install.
 */
export function defineAnalyticsEvents<const T extends AnalyticsCatalog>(catalog: T | (() => T)): T {
  const events = typeof catalog === 'function' ? withJitlessSchemas(catalog) : catalog
  return validateCatalogNames(events)
}

function validateCatalogNames<const T extends AnalyticsCatalog>(catalog: T): T {
  for (const name of Object.keys(catalog)) {
    if (!/^[a-z][a-z0-9_]{0,79}$/u.test(name) || isStandardAnalyticsEvent(name)) {
      throw new Error('Invalid or reserved analytics event name: ' + name)
    }
  }
  return catalog
}

export function searchQueryLengthBucket(length: number) {
  if (length <= 0) return 'empty'
  if (length <= 3) return '1-3'
  if (length <= 10) return '4-10'
  if (length <= 30) return '11-30'
  return '31+'
}
