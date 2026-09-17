import { useRequestEvent, useState } from '#imports'

import type { Ref } from 'vue'

/** The `useState` key the request id is transferred on, shared with the error page. */
export const REQUEST_ID_STATE_KEY = 'narduk:request-id'

/**
 * The correlation id for the request this page was rendered from — the same
 * value `x-request-id` carries and the same one narduk-logging stamps on every
 * server record, so a user reading it off the error page hands support the key
 * that finds the log line.
 *
 * Resolved once during SSR and transferred through the Nuxt payload, because
 * the browser cannot read a response header of the document it is running in.
 * Empty on a client-only render (a failed SPA navigation, `ssr: false`).
 */
export function useRequestId(): Ref<string> {
  return useState<string>(REQUEST_ID_STATE_KEY, () => {
    if (!import.meta.server) return ''

    const value = useRequestEvent()?.context._requestId
    return typeof value === 'string' ? value : ''
  })
}
