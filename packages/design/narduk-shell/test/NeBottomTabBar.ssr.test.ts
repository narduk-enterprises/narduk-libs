/*
 * Server-render proof for NeBottomTabBar: the navigation, its lit tab and its
 * spacer are in the first paint with no DOM, from the router's path.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import NeBottomTabBar from '../src/runtime/components/NeBottomTabBar.vue'

import type { NeBottomTabBarProps } from '../src/runtime/components/ne-bottom-tab-bar-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
})

const items = [
  { label: 'Home', to: '/' },
  { label: 'Browse', to: '/browse' },
]

async function render(path: string, props: Partial<NeBottomTabBarProps> = {}): Promise<string> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:rest(.*)*', component: { render: () => null } }],
  })
  await router.push(path)
  const app = createSSRApp({ render: () => h(NeBottomTabBar, { items, ...props }) })
  app.use(router)
  return renderToString(app)
}

describe('NeBottomTabBar server rendering', () => {
  it('renders the named navigation with the current tab marked', async () => {
    const html = await render('/browse/new')
    expect(html).toContain('aria-label="Primary"')
    expect(html).toContain('class="ne-bottom-tab-bar__spacer"')
    expect(html).toMatch(
      /data-state="section"[^>]*aria-current="true"|aria-current="true"[^>]*data-state="section"/,
    )
    expect(html).not.toContain('--ne-bottom-tab-bar-h')
  })

  it('marks itself phone-only by default and not when told otherwise', async () => {
    expect(await render('/')).toContain('data-phone-only')
    expect(await render('/', { phoneOnly: false })).not.toContain('data-phone-only')
  })

  it('renders the same string twice', async () => {
    expect(await render('/')).toBe(await render('/'))
  })
})
