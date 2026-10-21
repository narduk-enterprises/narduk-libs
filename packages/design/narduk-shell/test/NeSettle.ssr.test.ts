import { renderToString } from '@vue/server-renderer'
import { createVueTestEnv } from '@narduk-enterprises/narduk-testkit/vue-test-env'
import { expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeSettle from '../src/runtime/components/NeSettle.vue'

it('ships meaningful first-paint HTML without a browser', async () => {
  expect(typeof window).toBe('undefined')
  const app = createSSRApp({
    render: () => h(NeSettle, { motionKey: 'yard' }, { default: () => h('p', 'At rest') }),
  })
  app.use(createVueTestEnv())
  const html = await renderToString(app)
  expect(html).toContain('At rest')
  expect(html).not.toContain('enter-active')
})
