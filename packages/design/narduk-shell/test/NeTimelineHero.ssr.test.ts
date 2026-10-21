import { renderToString } from '@vue/server-renderer'
import { createVueTestEnv } from '@narduk-enterprises/narduk-testkit/vue-test-env'
import { expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeTimelineHero from '../src/runtime/components/NeTimelineHero.vue'

it('ships meaningful first-paint HTML without a browser', async () => {
  expect(typeof window).toBe('undefined')
  const app = createSSRApp({
    render: () =>
      h(
        NeTimelineHero,
        {
          subject: 'Texas',
          verb: 'paid',
          value: '$100B',
          periods: [
            { id: '2025', label: 'FY25', value: 100, partial: true },
            { id: '2026', label: 'FY26', value: null },
          ],
        },
        { default: () => h('p', 'At rest') },
      ),
  })
  app.use(createVueTestEnv())
  const html = await renderToString(app)
  expect(html).toContain('Texas paid')
  expect(html).toContain('$100B')
  expect(html).toContain('aria-label="FY26, Not reported"')
  expect(html).toContain('Partial')
  expect(html).toContain('<h1')
})
