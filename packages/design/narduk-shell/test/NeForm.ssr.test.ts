/*
 * Server-render proof for NeForm — components backlog item 19
 * (narduk-libs#266). Pattern: packages/design/narduk-charts/src/ssr.test.ts,
 * copied by NeConfirmDialog.ssr.test.ts. Runs in vitest's `node` environment
 * (this package's default) with no `document`/`window` at all, the same
 * runtime shape as a Cloudflare Workers Nitro preset's first render.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, reactive } from 'vue'

import NeForm from '../src/runtime/components/NeForm.vue'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('server rendering without a DOM', () => {
  it('renders an empty form without throwing', async () => {
    const html = await renderToString(createSSRApp(NeForm, { state: reactive({ name: '' }) }))

    expect(typeof html).toBe('string')
    expect(html).toContain('<form')
    expect(html).toContain('Save')
  })

  it('renders a custom save label', async () => {
    const html = await renderToString(
      createSSRApp(NeForm, { state: reactive({ name: '' }), saveLabel: 'Update profile' }),
    )

    expect(html).toContain('Update profile')
  })

  it('renders the sticky save-bar classes when stickySave is set', async () => {
    const html = await renderToString(
      createSSRApp(NeForm, { state: reactive({ name: '' }), stickySave: true }),
    )

    expect(html).toContain('sticky')
  })

  it('omits sticky classes by default', async () => {
    const html = await renderToString(createSSRApp(NeForm, { state: reactive({ name: '' }) }))

    expect(html).not.toContain('sticky')
  })

  it('renders disabled fields and button when disabled', async () => {
    const html = await renderToString(
      createSSRApp(NeForm, { state: reactive({ name: '' }), disabled: true }),
    )

    expect(html).toContain('disabled')
  })

  it('renders default slot content passed through', async () => {
    const { h } = await import('vue')
    const app = createSSRApp({
      render: () =>
        h(NeForm, { state: reactive({ name: '' }) }, () => h('p', 'Custom field markup')),
    })

    const html = await renderToString(app)
    expect(html).toContain('Custom field markup')
  })
})
