import { useNuxtApp } from '#imports'

import { captureValidated } from '../lib/analyticsValidation'

import type { AnalyticsCatalog, AnalyticsEventProperties } from '../lib/analyticsCatalog'
import type { AnalyticsCatalogSource } from '../lib/analyticsValidation'
import type { standardAnalyticsEvents } from '../utils/analyticsEvents'
import type { AnalyticsTransport } from '../utils/analyticsTransport'

/**
 * `catalog` is the app's events, or a function that loads them
 * (`() => import('../analytics/events').then((m) => m.productAnalyticsEvents)`).
 * The loader form keeps the app's own Zod schemas out of the entry chunk too;
 * the shared schemas always load on first use (narduk-libs#1527).
 */
export function useAnalytics<const T extends AnalyticsCatalog = Record<never, never>>(
  catalog?: AnalyticsCatalogSource<T>,
) {
  const app = useNuxtApp() as unknown as { $analytics?: AnalyticsTransport }
  type Events = typeof standardAnalyticsEvents & T

  return {
    get status() {
      return app.$analytics?.status ?? 'disabled'
    },
    get dropped() {
      return app.$analytics?.dropped ?? 0
    },
    capture<K extends keyof Events & string>(
      event: K,
      properties: AnalyticsEventProperties<Events, K>,
    ): boolean {
      return captureValidated(app.$analytics, event, properties, catalog)
    },
  }
}
