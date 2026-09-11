/*
 * Server-render proof for NeSettingsPage — components backlog item 19
 * (narduk-libs#266). Runs in vitest's `node` environment with no DOM.
 */
import { describe, expect, it } from 'vitest'
import { renderToString } from '@vue/server-renderer'
import { createSSRApp, reactive } from 'vue'

import NeSettingsPage from '../src/runtime/components/NeSettingsPage.vue'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

describe('server rendering without a DOM', () => {
  it('renders the title, description and sticky save bar without throwing', async () => {
    const html = await renderToString(
      createSSRApp(NeSettingsPage, {
        title: 'Settings',
        description: 'Manage your account.',
        state: reactive({ name: '' }),
      }),
    )

    expect(typeof html).toBe('string')
    expect(html).toContain('Settings')
    expect(html).toContain('Manage your account.')
    expect(html).toContain('sticky')
  })
})
