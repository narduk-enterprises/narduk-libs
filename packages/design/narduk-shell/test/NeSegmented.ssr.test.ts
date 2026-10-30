/*
 * Server-render proof for NeSegmented: the radiogroup, its checked segment and
 * its single Tab stop are in the first paint with no DOM.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeSegmented from '../src/runtime/components/NeSegmented.vue'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
})

const options = [
  { value: 'map', label: 'Map' },
  { value: 'list', label: 'List' },
]

function render(modelValue: string | null): Promise<string> {
  return renderToString(
    createSSRApp({ render: () => h(NeSegmented, { modelValue, options, label: 'View' }) }),
  )
}

describe('NeSegmented server rendering', () => {
  it('renders the named radiogroup with the chosen segment checked', async () => {
    const html = await render('list')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="View"')
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(html.match(/tabindex="0"/g)).toHaveLength(1)
  })

  it('renders the same string twice', async () => {
    expect(await render('map')).toBe(await render('map'))
  })
})
