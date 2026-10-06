import type { GeneratedFile } from './types.js'

/** One-shot app-owned catalog and funnel notes; no PostHog provisioning or reconciliation. */
export function analyticsScaffoldFiles(): GeneratedFile[] {
  return [
    {
      path: 'apps/web/app/analytics/events.ts',
      contents: [
        "import { defineAnalyticsEvents } from '@narduk-enterprises/narduk-analytics/app/lib/analyticsCatalog'",
        '',
        '// Add product-specific events with strict Zod schemas here.',
        '// Shared search, form, share and engagement events are already available.',
        '// Keep this module out of the entry chunk: useProductAnalytics() loads it with',
        '// import() on the first capture, so import `z` here and nowhere on the critical path.',
        'export const productAnalyticsEvents = defineAnalyticsEvents({})',
        '',
      ].join('\n'),
    },
    {
      path: 'apps/web/app/composables/useProductAnalytics.ts',
      contents: [
        "import { useAnalytics } from '@narduk-enterprises/narduk-analytics/app/composables/useAnalytics'",
        '',
        '// Loaded on the first capture so Zod stays off the critical path (narduk-libs#1527).',
        'const loadProductAnalyticsEvents = () =>',
        "  import('../analytics/events').then((module) => module.productAnalyticsEvents)",
        '',
        'export function useProductAnalytics() {',
        '  return useAnalytics(loadProductAnalyticsEvents)',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'docs/analytics.md',
      contents: [
        '# Product analytics',
        '',
        'The shared kit captures pageviews, active foreground time and scroll milestones.',
        'The app owns its semantic events in `apps/web/app/analytics/events.ts`.',
        'Use `useProductAnalytics().capture()` with strict schemas and declared IDs;',
        'never send search text, form values, emails, record paths or tokens.',
        '',
        '## Primary-action funnel (complete before launch)',
        '',
        'Declare the primary action and its attempted, succeeded and failed events.',
        'A click is not a success: capture completion after the operation succeeds.',
        'Define activation and return usage using the successful primary action.',
        '',
        '## Consumer proof',
        '',
        'Use `assertAnalyticsJourney` from `@narduk-enterprises/narduk-testkit/analytics`',
        'on events collected by a unit SDK spy or decoded browser requests.',
        'Assert ordering, route/build context, expected counts and absence of private values.',
        'Unit/browser fixture success is not production intake proof: verify the deployed',
        'app emits the same sequence in PostHog before declaring analytics live.',
        '',
        'Keep owner activity separate from customer analytics. Filter customer insights to',
        '`environment = production`, `is_owner = false`, `is_internal_user = false`.',
        'Compare engagement and conversion by `build_version` and `analytics_schema_version`.',
        '',
      ].join('\n'),
    },
  ]
}
