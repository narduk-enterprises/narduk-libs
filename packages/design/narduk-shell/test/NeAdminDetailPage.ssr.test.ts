/*
 * Server-render proof for NeAdminDetailPage — components backlog item 20
 * (narduk-libs#267). Runs in vitest's `node` environment with no DOM.
 *
 * `onDelete` is bound here on purpose: the delete button has to be in the
 * first paint, while the `useConfirm()` handle behind it is only created on
 * the first click, so nothing overlay-related runs on the server.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeAdminDetailPage from '../src/runtime/components/NeAdminDetailPage.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

async function render(props: Record<string, unknown>) {
  const app = createSSRApp({
    render: () =>
      h(NeAdminDetailPage, {
        items: [
          { label: 'Name', value: 'runner-01' },
          { label: 'Last seen', value: null },
        ],
        title: 'runner-01',
        ...props,
      } as never),
  })
  for (const [name, component] of Object.entries(nuxtUiStubs)) app.component(name, component)
  return renderToString(app)
}

describe('server rendering without a DOM', () => {
  it('renders the header, the record and the delete action', async () => {
    const html = await render({
      description: 'Self-hosted runner',
      onDelete: () => {},
      unavailableMessage: 'Never',
    })

    expect(html).toContain('data-ne-admin-detail-page')
    expect(html).toContain('<h1')
    expect(html).toContain('Self-hosted runner')
    expect(html).toContain('data-ne-detail-view')
    expect(html).toContain('Never')
    expect(html).toContain('data-ne-admin-delete')
  })

  it('renders the loading panel instead of the record while pending', async () => {
    const html = await render({ loadingTitle: 'Loading runner', status: 'pending' })

    expect(html).not.toContain('data-ne-detail-view')
    expect(html).toContain('Loading runner')
  })
})
