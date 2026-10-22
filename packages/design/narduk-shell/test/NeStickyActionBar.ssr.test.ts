/*
 * Server-render proof for NeStickyActionBar: the bar and its spacer are in the
 * first paint with no DOM, and the spacer already has a height (the CSS
 * fallback) because the measured one only exists after mount.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeStickyActionBar from '../src/runtime/components/NeStickyActionBar.vue'

import type { NeStickyActionBarProps } from '../src/runtime/components/ne-sticky-action-bar-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
})

function render(props: NeStickyActionBarProps = {}): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(NeStickyActionBar, props, { default: () => h('button', { type: 'button' }, 'Buy') }),
    }),
  )
}

describe('NeStickyActionBar server rendering', () => {
  it('renders the spacer and the named bar, with no measured height yet', async () => {
    const html = await render({ label: 'Trade actions' })
    expect(html).toContain('class="ne-sticky-action-bar__spacer"')
    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Trade actions"')
    expect(html).toContain('>Buy</button>')
    expect(html).not.toContain('--ne-sticky-action-bar-h')
  })

  it('marks itself phone-only by default and not when told otherwise', async () => {
    expect(await render()).toContain('data-phone-only')
    expect(await render({ phoneOnly: false })).not.toContain('data-phone-only')
  })

  it('renders the same string twice', async () => {
    expect(await render()).toBe(await render())
  })
})
