/*
 * Server-render proof for NeAdminEditPage — components backlog item 20
 * (narduk-libs#267). Runs in vitest's `node` environment with no DOM.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h, reactive } from 'vue'

import NeAdminEditPage from '../src/runtime/components/NeAdminEditPage.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

async function render(props: Record<string, unknown>) {
  const app = createSSRApp({
    render: () =>
      h(NeAdminEditPage, {
        state: reactive({ name: 'runner-01' }),
        title: 'Edit runner',
        ...props,
      } as never),
  })
  for (const [name, component] of Object.entries(nuxtUiStubs)) app.component(name, component)
  return renderToString(app)
}

describe('server rendering without a DOM', () => {
  it('renders the header, the form, the sticky save bar and the cancel action', async () => {
    const html = await render({ description: 'Rename or retire it.', onCancel: () => {} })

    expect(html).toContain('data-ne-admin-edit-page')
    expect(html).toContain('<h1')
    expect(html).toContain('Edit runner')
    expect(html).toContain('Rename or retire it.')
    expect(html).toContain('<form')
    expect(html).toContain('sticky')
    expect(html).toContain('data-ne-admin-cancel')
  })

  it('renders the loading panel instead of the form while the record is pending', async () => {
    const html = await render({ loadingTitle: 'Loading runner', status: 'pending' })

    expect(html).not.toContain('<form')
    expect(html).toContain('Loading runner')
  })
})
