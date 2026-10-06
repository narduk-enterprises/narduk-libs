import { z } from 'zod'

import { withJitlessSchemas } from '../lib/analyticsCatalog'

/**
 * The shared schemas, and with them all of Zod. Nothing on the client's critical
 * path imports this module statically: `useAnalytics` and the `v-track`
 * directive load it with `import()` on the first `capture()` (narduk-libs#1527).
 * The registry helpers that do not need Zod live in `analyticsCatalog.ts` and are
 * re-exported here so existing deep imports keep working.
 */
export {
  defineAnalyticsEvents,
  searchQueryLengthBucket,
  STANDARD_ANALYTICS_EVENT_NAMES,
  withJitlessSchemas,
} from '../lib/analyticsCatalog'
export type { AnalyticsCatalog, AnalyticsEventProperties } from '../lib/analyticsCatalog'

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

export type StandardAnalyticsEvent = keyof typeof standardAnalyticsEvents
