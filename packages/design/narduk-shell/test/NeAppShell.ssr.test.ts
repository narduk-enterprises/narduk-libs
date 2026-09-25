/*
 * Server-render proof for NeAppShell — components backlog item 18
 * (narduk-libs#265), the plan's standard done-when 2.
 *
 * Runs in the config's default `node` environment (no `@vitest-environment`
 * directive), so `window` and `document` do not exist: anything in the shell
 * or the Nuxt UI primitives it wraps that touched them during render would
 * throw here. The keyboard handler is the only DOM code the shell has, and it
 * runs on a keydown, never during render.
 *
 * The rail has to be in the server's first paint — labelled groups, real
 * `<a href>`s and the active mark — so the navigation works before hydration.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createSSRApp, defineComponent, h, type Component } from 'vue'

import NeAppShell from '../src/runtime/components/NeAppShell.vue'

import type { NeAppShellSection } from '../src/runtime/components/ne-app-shell-types'

const Blank: Component = defineComponent({ setup: () => () => h('div') })

const SECTIONS: NeAppShellSection[] = [
  {
    id: 'operate',
    label: 'Operate',
    items: [
      { label: 'Overview', to: '/' },
      { label: 'Runners', to: '/runners' },
    ],
  },
  { id: 'infrastructure', label: 'Infrastructure', items: [{ label: 'Hosts', to: '/hosts' }] },
]

async function renderAt(path: string, slots: Record<string, () => unknown> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/runners', '/hosts'].map((route) => ({ path: route, component: Blank })),
  })
  await router.push(path)
  await router.isReady()
  const app = createSSRApp({
    render: () =>
      h(NeAppShell, { sections: SECTIONS }, { default: () => h('p', 'page body'), ...slots }),
  })
  app.use(router)
  return renderToString(app)
}

describe('NeAppShell (SSR)', () => {
  it('renders without a DOM', async () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    await expect(renderAt('/runners')).resolves.toContain('ne-app-shell')
  })

  it('server-renders the labelled sections and every link', async () => {
    const html = await renderAt('/runners')
    expect(html).toMatch(/<nav[^>]*aria-label="Main"/)
    expect(html).toMatch(/role="group"[^>]*aria-label="Operate"/)
    expect(html).toMatch(/role="group"[^>]*aria-label="Infrastructure"/)
    for (const href of ['/', '/runners', '/hosts']) {
      expect(html).toContain(`href="${href}"`)
    }
  })

  it('server-renders the active mark on the routed item only', async () => {
    const html = await renderAt('/hosts')
    const current = [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>/g)].map((m) => m[0])
    expect(current).toHaveLength(1)
    expect(current[0]).toContain('href="/hosts"')
  })

  it('server-renders the rail slots, the page in <main>, and no navbar <h1>', async () => {
    const html = await renderAt('/', {
      'rail-bottom': () => h('span', 'account'),
      'rail-top': () => h('span', 'wordmark'),
    })
    expect(html).toContain('wordmark')
    expect(html).toContain('account')
    expect(html).toMatch(/<main[^>]*>[\s\S]*page body[\s\S]*<\/main>/)
    expect(html).not.toContain('<h1')
  })
})
