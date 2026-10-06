import { describe, expect, it } from 'vitest'
import { buildGeneratedFiles } from '../src/generate.js'

describe('analytics capability scaffold', () => {
  it('generates the recommended profile and app-owned catalog', () => {
    const files = buildGeneratedFiles({
      targetDir: '/tmp/analytics-app',
      name: 'analytics-app',
      capabilities: ['analytics', 'auth'],
      exposure: 'authenticated',
    })
    const read = (path: string) => files.find((file) => file.path === path)?.contents
    expect(read('apps/web/nuxt.config.ts')).toContain("appId: 'analytics-app'")
    expect(read('apps/web/nuxt.config.ts')).toContain("privacy: 'strict'")
    expect(read('apps/web/nuxt.config.ts')).toContain('engagement: true')
    expect(read('apps/web/nuxt.config.ts')).toContain('identity: true')
    expect(read('apps/web/app/analytics/events.ts')).toContain('defineAnalyticsEvents({})')
    expect(read('apps/web/app/analytics/events.ts')).toContain('app/lib/analyticsCatalog')
    // Lazy: Zod must not reach the entry chunk through a static import of the catalog.
    const composable = read('apps/web/app/composables/useProductAnalytics.ts')
    expect(composable).toContain("import('../analytics/events')")
    expect(composable).toContain('useAnalytics(loadProductAnalyticsEvents)')
    expect(composable).not.toMatch(/^import .* from '\.\.\/analytics\/events'/mu)
    expect(read('docs/analytics.md')).toContain('assertAnalyticsJourney')
  })

  it('does not add analytics or identity to apps without the corresponding capability', () => {
    const files = buildGeneratedFiles({
      targetDir: '/tmp/no-analytics',
      name: 'no-analytics',
      capabilities: [],
    })
    expect(files.some((file) => file.path === 'docs/analytics.md')).toBe(false)
    expect(files.find((file) => file.path === 'apps/web/nuxt.config.ts')?.contents).not.toContain(
      'nardukAnalytics:',
    )
  })
})
