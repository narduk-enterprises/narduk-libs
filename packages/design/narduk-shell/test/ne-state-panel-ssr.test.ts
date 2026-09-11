/*
 * Server-render proof for NeStatePanel — the plan's standard done-when 2.
 *
 * The mount suite next door runs under happy-dom, so it gives the component a
 * DOM. Consumers do not: the first render of every panel happens on a server,
 * and for the Cloudflare Workers preset that is a runtime with no `window` and
 * no `document` at all. A component that reaches for either at setup time
 * throws there while every mount test stays green.
 *
 * This file therefore runs in the config's default `node` environment (it
 * deliberately carries no `@vitest-environment` directive) and renders through
 * `@vue/server-renderer`. Resolving without throwing is not enough — a
 * component can render an empty string — so every case asserts real markup,
 * and the accessibility attributes are asserted in the SERVER output, because
 * a `role="alert"` that only appears after hydration is not there when it
 * matters.
 *
 * Pattern: packages/design/narduk-charts/src/ssr.test.ts.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeStatePanel from '../src/runtime/components/NeStatePanel.vue'
import { nuxtUiStubs } from './nuxt-ui-stubs'

import type { NeStateValue } from '../src/runtime/types'

/** The globals a Workers-style server runtime does not have. */
it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function renderState(props: Record<string, unknown>, defaultSlot?: () => unknown): Promise<string> {
  const app = createSSRApp({
    render: () => h(NeStatePanel, props, defaultSlot ? { default: defaultSlot } : {}),
  })
  // Registered globally, exactly as @nuxt/ui registers the real primitives.
  for (const [name, component] of Object.entries(nuxtUiStubs)) app.component(name, component)
  return renderToString(app)
}

describe('NeStatePanel server-rendered without a DOM', () => {
  it.each<NeStateValue>(['empty', 'loading', 'error', 'blocked', 'absent'])(
    'renders markup for %s instead of throwing',
    async (state) => {
      const html = await renderState({ message: 'A sentence.', state, title: 'A title' })

      expect(html).toContain(`data-ne-state="${state}"`)
      expect(html).toContain('A sentence.')
    },
  )

  it.each<[NeStateValue, string]>([
    ['empty', 'Empty'],
    ['loading', 'Loading'],
    ['error', 'Error'],
    ['blocked', 'Blocked'],
    ['absent', 'Not reported'],
  ])('carries %s’s own wording into the server output', async (state, eyebrow) => {
    expect(await renderState({ state })).toContain(eyebrow)
  })

  it('carries role="alert" for a failure into the first paint, not only after hydration', async () => {
    const html = await renderState({ state: 'error', title: 'Could not load runners' })

    expect(html).toContain('role="alert"')
    expect(html).toContain('Could not load runners')
  })

  it('carries the polite busy region for a pending read into the first paint', async () => {
    const html = await renderState({ state: 'loading' })

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-busy="true"')
  })

  it.each<NeStateValue>(['empty', 'absent', 'blocked'])(
    'server-renders %s as a status region that is not busy',
    async (state) => {
      const html = await renderState({ state })

      expect(html).toContain('role="status"')
      expect(html).not.toContain('aria-busy')
    },
  )

  it('server-renders the default slot, and no panel, on a successful read', async () => {
    const html = await renderState({ status: 'success' }, () => '4 runners')

    expect(html).toContain('4 runners')
    expect(html).not.toContain('data-ne-state')
  })

  it('server-renders the status mapping, so the first paint is already right', async () => {
    expect(await renderState({ status: 'pending' })).toContain('data-ne-state="loading"')
    expect(await renderState({ status: 'idle' })).toContain('data-ne-state="loading"')
    expect(await renderState({ status: 'error' })).toContain('data-ne-state="error"')
  })

  it('server-renders gaps and the unblocking condition', async () => {
    const html = await renderState({
      gaps: [{ id: 'runners.heartbeat', need: 'no producer publishes a heartbeat' }],
      state: 'absent',
      unblocksOn: 'a runner reports in',
      unblocksRef: 'operator-portal#152',
    })

    expect(html).toContain('runners.heartbeat')
    expect(html).toContain('no producer publishes a heartbeat')
    expect(html).toContain('Unblocks on')
    expect(html).toContain('operator-portal#152')
  })

  it('does not touch a DOM global merely by rendering twice', async () => {
    await expect(renderState({ state: 'empty' })).resolves.toContain('data-ne-state="empty"')
    await expect(renderState({ state: 'absent' })).resolves.toContain('data-ne-state="absent"')
  })
})
