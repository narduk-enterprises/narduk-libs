/*
 * Server-render proof for NeFormActions: the row and its buttons are in the
 * first paint with no DOM, in source order, and the lead group exists only
 * when the slot is given.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeFormActions from '../src/runtime/components/NeFormActions.vue'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
})

function render(withLead = false): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(NeFormActions, null, {
          default: () => [
            h('button', { type: 'button' }, 'Cancel'),
            h('button', { type: 'submit' }, 'Save'),
          ],
          ...(withLead ? { lead: () => h('button', { type: 'button' }, 'Delete') } : {}),
        }),
    }),
  )
}

describe('NeFormActions server rendering', () => {
  it('renders the row with Cancel before the primary', async () => {
    const html = await render()
    expect(html).toContain('data-ne-form-actions')
    expect(html.indexOf('>Cancel</button>')).toBeGreaterThan(-1)
    expect(html.indexOf('>Cancel</button>')).toBeLessThan(html.indexOf('>Save</button>'))
    expect(html).not.toContain('ne-form-actions__lead')
  })

  it('renders the lead group first when the slot is given', async () => {
    const html = await render(true)
    expect(html).toContain('ne-form-actions__lead')
    expect(html.indexOf('>Delete</button>')).toBeLessThan(html.indexOf('>Cancel</button>'))
  })

  it('renders the same string twice', async () => {
    expect(await render()).toBe(await render())
  })
})
