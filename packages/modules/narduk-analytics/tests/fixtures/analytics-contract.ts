import { z } from 'zod'

import { useAnalytics } from '../../app/composables/useAnalytics'
import { defineAnalyticsEvents } from '../../app/utils/analyticsEvents'

const shared = useAnalytics()
shared.capture('search_completed', {
  search_id: 'stations',
  query_length_bucket: 'empty',
  result_count: 0,
})
// @ts-expect-error An undeclared event must fail consumer typecheck.
shared.capture('search_compleeted', {})
// @ts-expect-error Private query text is not part of the shared contract.
shared.capture('search_completed', { query: 'private' })
shared.capture('search_completed', {
  search_id: 'stations',
  query_length_bucket: 'empty',
  // @ts-expect-error The shared event count is numeric.
  result_count: 'private',
})

const catalog = defineAnalyticsEvents({
  primary_action_completed: z.object({ source: z.enum(['map', 'list']) }).strict(),
})
const product = useAnalytics(catalog)
product.capture('primary_action_completed', { source: 'map' })
product.capture('form_succeeded', { form_id: 'signup' })
// @ts-expect-error Product property enums remain specific after composing the shared catalog.
product.capture('primary_action_completed', { source: 'private' })
// @ts-expect-error Adding a product catalog must not allow undeclared event names.
product.capture('undeclared', {})

// A loader keeps the app's schemas out of the entry chunk and types identically.
const lazy = useAnalytics(() => Promise.resolve(catalog))
lazy.capture('primary_action_completed', { source: 'map' })
lazy.capture('form_succeeded', { form_id: 'signup' })
// @ts-expect-error Loader-form catalogs keep specific property enums.
lazy.capture('primary_action_completed', { source: 'private' })
// @ts-expect-error Loader-form catalogs reject undeclared event names.
lazy.capture('undeclared', {})
