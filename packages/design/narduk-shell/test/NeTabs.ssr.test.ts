/*
 * Server-render proof for NeTabs: the strip, the selection and the panel are in
 * the first paint with no DOM, in both modes, and the ids are SSR-stable (the
 * same string twice), so hydration agrees.
 */
import { renderToString } from '@vue/server-renderer'
import { createVueTestEnv } from '@narduk-enterprises/narduk-testkit/vue-test-env'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeTabs from '../src/runtime/components/NeTabs.vue'

import type { NeTabItem, NeTabsProps } from '../src/runtime/components/ne-tabs-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
})

const items: NeTabItem[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'trades', label: 'Trades', badge: 3 },
  { value: 'rules', label: 'Rules', disabled: true },
]

function render(props: Partial<NeTabsProps> = {}, panel = false): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(
          NeTabs,
          { items, ...props },
          panel ? { default: ({ value }: { value: string }) => h('p', `panel ${value}`) } : {},
        ),
    }).use(createVueTestEnv()),
  )
}

describe('NeTabs server rendering', () => {
  it('renders the named tablist with the selected tab and a roving tabindex', async () => {
    const html = await render({ label: 'Game sections', defaultValue: 'trades' })
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Game sections"')
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html).toMatch(
      /aria-selected="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-selected="true"/,
    )
    expect(html).toContain('>3</span>')
    expect(html).toContain('aria-disabled="true"')
  })

  it('renders the panel only when there is a default slot, wired to the selected tab', async () => {
    expect(await render()).not.toContain('role="tabpanel"')
    const html = await render({ modelValue: 'trades' }, true)
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('panel trades')
    const labelledby = /aria-labelledby="([^"]+)"/.exec(html)![1]!
    expect(html).toContain(`id="${labelledby}"`)
  })

  it('renders the same string twice, ids included', async () => {
    expect(await render({}, true)).toBe(await render({}, true))
  })

  it('selects from the URL in route mode', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: { render: () => h('div') } }],
    })
    await router.push('/g/42?tab=trades')
    await router.isReady()
    const html = await renderToString(
      createSSRApp({ render: () => h(NeTabs, { items, routeParam: 'tab' }) }).use(router),
    )
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-selected="true"[\s\S]*?Trades/)
  })
})
