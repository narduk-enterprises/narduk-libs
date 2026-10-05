import { z } from 'zod'

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
 */
export function withJitlessSchemas<T>(build: () => T): T {
  const previous = z.config().jitless
  z.config({ jitless: true })
  try {
    return build()
  } finally {
    z.config({ jitless: previous })
  }
}

/** Explicit properties prevent DOM text, form values and URLs entering the shared suite. */
export const standardAnalyticsEvents = withJitlessSchemas(() => {
  /** IDs are declared UI/catalog identifiers, never record IDs or user input. */
  const id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/u)
  const count = z.number().int().nonnegative().max(1_000_000_000)
  const action = z.object({ action_id: id }).strict()
  const form = z.object({ form_id: id }).strict()
  const state = z.object({ state_id: id, reason: id }).strict()

  return {
    page_engagement: z.object({ active_ms: count, page_visit_id: z.string().uuid() }).strict(),
    scroll_depth_reached: z
      .object({
        depth: z.union([z.literal(25), z.literal(50), z.literal(75), z.literal(100)]),
        page_visit_id: z.string().uuid(),
      })
      .strict(),
    search_completed: z
      .object({
        search_id: id,
        query_length_bucket: z.enum(['empty', '1-3', '4-10', '11-30', '31+']),
        result_count: count,
      })
      .strict(),
    filter_changed: z.object({ filter_id: id, value: id }).strict(),
    sort_changed: z.object({ sort_id: id, value: id }).strict(),
    form_submitted: form,
    form_succeeded: form,
    form_failed: form.extend({ error_category: id }).strict(),
    share_clicked: action
      .extend({ channel: z.enum(['native', 'copy', 'email', 'sms', 'social', 'other']) })
      .strict(),
    clipboard_copied: action,
    file_downloaded: action.extend({ file_type: id }).strict(),
    outbound_link_clicked: action
      .extend({
        destination_host: z
          .string()
          .max(253)
          .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/u),
      })
      .strict(),
    empty_state_shown: state,
    error_state_shown: state,
    auth_session_started: z.object({}).strict(),
    auth_session_ended: z.object({ reason: z.enum(['session_ended', 'account_changed']) }).strict(),
    auth_signed_in: z.object({ method: id }).strict(),
    auth_signed_out: z.object({ reason: z.enum(['session_ended', 'account_changed']) }).strict(),
    auth_signed_up: z.object({ method: id }).strict(),
  } as const
})

export type AnalyticsCatalog = Record<string, z.ZodType<Record<string, unknown>>>
export type StandardAnalyticsEvent = keyof typeof standardAnalyticsEvents
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
    if (!/^[a-z][a-z0-9_]{0,79}$/u.test(name) || name in standardAnalyticsEvents) {
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
