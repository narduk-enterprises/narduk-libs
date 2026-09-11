/*
 * Server-render proof — components backlog item 16, narduk-libs#263.
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts. Consumers run on
 * Nuxt/Nitro, and for the Cloudflare Workers preset the first render happens
 * in a runtime with no `window` and no `document` at all. A component that
 * reaches for either at setup time throws there while every happy-dom mount
 * test stays green, so this file deliberately runs in vitest's `node`
 * environment (this package's default; the mount suites opt INTO happy-dom
 * with a file directive) and renders through `@vue/server-renderer`.
 *
 * What the assertions say, precisely: importing and server-rendering
 * NeConfirmDialog and useConfirm does not touch a DOM global, open or closed.
 * The dialog itself produces no server markup — Reka portals it and mounts it
 * on the client — so "renders markup" is NOT the claim here; "renders the
 * empty document it should, instead of throwing" is. The `open: true` case is
 * the one that matters: it proves the open path is DOM-free too, which a
 * closed-only test would not.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp } from 'vue'

import NeConfirmDialog from '../src/runtime/components/NeConfirmDialog.vue'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('server rendering without a DOM', () => {
  it('renders an open dialog without throwing', async () => {
    const html = await renderToString(
      createSSRApp(NeConfirmDialog, {
        open: true,
        title: 'Close all positions?',
        message: 'This cannot be undone.',
        tone: 'danger',
      }),
    )

    expect(typeof html).toBe('string')
    // Reka renders the dialog into a client-side portal, so the server response
    // carries no dialog and no stray confirm button to flash before hydration.
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('data-ne-confirm-confirm')
  })

  it('renders a closed dialog without throwing', async () => {
    const html = await renderToString(
      createSSRApp(NeConfirmDialog, { open: false, title: 'Close all positions?' }),
    )

    expect(typeof html).toBe('string')
    expect(html).not.toContain('role="dialog"')
  })

  it('renders an open dialog carrying a body component without throwing', async () => {
    const { defineComponent, h } = await import('vue')
    const TradeSummary = defineComponent({
      props: { symbol: { type: String, required: true } },
      setup: (props) => () => h('p', props.symbol),
    })

    await expect(
      renderToString(
        createSSRApp(NeConfirmDialog, {
          open: true,
          title: 'Execute order?',
          body: TradeSummary,
          props: { symbol: 'AAPL' },
        }),
      ),
    ).resolves.toBeTypeOf('string')
  })

  it('imports the composable module without reaching for a DOM global', async () => {
    const module_ = await import('../src/runtime/composables/use-confirm')

    expect(typeof module_.useConfirm).toBe('function')
    expect(typeof document).toBe('undefined')
  })
})
