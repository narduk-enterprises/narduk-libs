/*
 * Server-render proof for NeCommandPaletteTrigger and NeCommandPalette.
 *
 * Runs in vitest's `node` environment with no `document`. The trigger is in
 * the first paint of every page, so it must render with no browser API, must
 * not guess the platform shortcut on the server (that would hydrate wrong), and
 * with a `fallbackAction` must be a working GET form before any script runs.
 */
import { renderToString } from '@vue/server-renderer'
import { createVueTestEnv } from '@narduk-enterprises/narduk-testkit/vue-test-env'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeCommandPalette from '../src/runtime/components/NeCommandPalette.vue'
import NeCommandPaletteTrigger from '../src/runtime/components/NeCommandPaletteTrigger.vue'

import type {
  NeCommandPaletteProps,
  NeCommandPaletteTriggerProps,
} from '../src/runtime/components/ne-command-palette-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function renderTrigger(props: NeCommandPaletteTriggerProps = {}): Promise<string> {
  return renderToString(
    createSSRApp({ render: () => h(NeCommandPaletteTrigger, props) }).use(createVueTestEnv()),
  )
}

function renderPalette(props: NeCommandPaletteProps): Promise<string> {
  return renderToString(
    createSSRApp({ render: () => h(NeCommandPalette, props) }).use(createVueTestEnv()),
  )
}

describe('NeCommandPaletteTrigger server rendering', () => {
  it('renders a button with its label and no shortcut hint', async () => {
    const html = await renderTrigger({ placeholder: 'Find a river' })
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="Find a river"')
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('Find a river')
    expect(html).not.toContain('<kbd')
  })

  it('wraps in a GET search form when given a fallback action', async () => {
    const html = await renderTrigger({ fallbackAction: '/search' })
    expect(html).toMatch(/^<form [^>]*action="\/search"[^>]*method="get"/)
    expect(html).toContain('type="submit"')
  })
})

describe('NeCommandPalette server rendering', () => {
  it('renders a closed, named dialog with the combobox and an empty listbox', async () => {
    const html = await renderPalette({
      groups: [{ id: 'states', items: [{ id: 'MO', label: 'Missouri' }], label: 'States' }],
      title: 'Search River Status',
    })
    expect(html).toContain('<dialog')
    expect(html).not.toMatch(/<dialog[^>]* open/)
    expect(html).toContain('aria-label="Search River Status"')
    expect(html).toContain('role="combobox"')
    expect(html).toContain('role="listbox"')
    // Nothing is searched or listed until it is opened.
    expect(html).not.toContain('role="option"')
  })
})
