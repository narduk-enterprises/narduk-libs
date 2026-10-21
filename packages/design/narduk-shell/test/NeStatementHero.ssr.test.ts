import { renderToString } from '@vue/server-renderer'
import { createVueTestEnv } from '@narduk-enterprises/narduk-testkit/vue-test-env'
import { expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeStatementHero from '../src/runtime/components/NeStatementHero.vue'

it('ships meaningful first-paint HTML without a browser', async () => {
  expect(typeof window).toBe('undefined')
  const app = createSSRApp({
    render: () =>
      h(
        NeStatementHero,
        {
          title: 'Community radio',
          marker: { state: 'stale', label: 'Station schedule', detail: 'Saved at 5 PM' },
          links: [{ label: 'Listen', to: '/listen' }],
        },
        { default: () => h('p', 'At rest') },
      ),
  })
  app.use(createVueTestEnv())
  const html = await renderToString(app)
  expect(html).toContain('Last known')
  expect(html).toContain('Saved at 5 PM')
  expect(html).toContain('href="/listen"')
  expect(html).toContain('Community radio')
})
