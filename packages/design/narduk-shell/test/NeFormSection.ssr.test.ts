/*
 * Server-render proof for NeFormSection — components backlog item 19
 * (narduk-libs#266). Runs in vitest's `node` environment with no DOM, the
 * same pattern as NeForm.ssr.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, h } from 'vue'

import NeFormSection from '../src/runtime/components/NeFormSection.vue'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('server rendering without a DOM', () => {
  it('renders the title and default slot without throwing', async () => {
    const app = createSSRApp({
      render: () => h(NeFormSection, { title: 'Profile' }, () => h('p', 'A field')),
    })

    const html = await renderToString(app)
    expect(html).toContain('Profile')
    expect(html).toContain('A field')
  })

  it('renders a description when given', async () => {
    const html = await renderToString(
      createSSRApp(NeFormSection, { title: 'Profile', description: 'Your public details.' }),
    )

    expect(html).toContain('Your public details.')
  })
})
