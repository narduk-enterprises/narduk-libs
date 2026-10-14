/*
 * Server-render proof for NeAbsent: the name and the unreported marks are in
 * the first paint, not added on hydration. Runs in vitest's `node`
 * environment: no DOM.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeAbsent from '../src/runtime/components/NeAbsent.vue'

import type { NeAbsentProps } from '../src/runtime/components/ne-absent-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeAbsentProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeAbsent, props) }))
}

describe('NeAbsent server rendering', () => {
  it('carries the name, state and phone-card mark of a cell into the first paint', async () => {
    const html = await render({ label: 'Uptime' })

    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Uptime: not reported"')
    expect(html).toContain('data-state="unreported"')
    expect(html).toContain('data-ne-empty')
  })

  it('renders the words of a block', async () => {
    const html = await render({ variant: 'block', label: 'Uptime' })

    expect(html).toContain('Uptime · Not reported')
    expect(html).not.toContain('role="img"')
  })

  it('renders the same string twice', async () => {
    expect(await render({ label: 'Uptime' })).toBe(await render({ label: 'Uptime' }))
  })
})
