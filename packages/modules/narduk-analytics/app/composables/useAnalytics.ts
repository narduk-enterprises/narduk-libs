import { useNuxtApp } from '#imports'

import { standardAnalyticsEvents } from '../utils/analyticsEvents'

import type { AnalyticsCatalog, AnalyticsEventProperties } from '../utils/analyticsEvents'
import type { AnalyticsTransport } from '../utils/analyticsTransport'

export function useAnalytics<const T extends AnalyticsCatalog = Record<never, never>>(catalog?: T) {
  const app = useNuxtApp() as unknown as { $analytics?: AnalyticsTransport }
  const events: AnalyticsCatalog = { ...catalog, ...standardAnalyticsEvents }
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
      const schema = events[event]
      if (!schema) return false
      const parsed = schema.safeParse(properties)
      return parsed.success ? (app.$analytics?.capture(event, parsed.data) ?? false) : false
    },
  }
}
