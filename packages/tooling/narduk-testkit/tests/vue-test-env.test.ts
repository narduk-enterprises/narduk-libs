import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'

import type { App } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RouterLink } from 'vue-router'

import { NuxtLinkStub, createVueTestEnv } from '../src/vue-test-env'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Renders a link the way a page does, through the global `NuxtLink` and a router-aware child. */
const Page = defineComponent({
  components: { NuxtLink: NuxtLinkStub },
  render() {
    return h('nav', [
      h(NuxtLinkStub, { to: '/runners', class: 'row' }, () => 'Runners'),
      h(NuxtLinkStub, { to: 'https://example.com/x', target: '_blank' }, () => 'Out'),
      h(NuxtLinkStub, { href: '/plain' }, () => 'Plain'),
      h(RouterLink, { to: '/direct' }, () => 'Direct'),
    ])
  },
})

describe('createVueTestEnv', () => {
  it('renders a NuxtLink as an anchor with its href and slot, with no Vue warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = createVueTestEnv()
    const html = await renderToString(createSSRApp(Page).use(env))

    expect(html).toContain('<a href="/runners" class="row">Runners</a>')
    expect(html).toContain('<a href="https://example.com/x" target="_blank">Out</a>')
    expect(html).toMatch(/<a href="\/plain"[^>]*>Plain<\/a>/)
    // A real router is installed, so RouterLink (and Nuxt UI's ULink) resolve too.
    expect(html).toMatch(/<a href="\/direct"[^>]*>Direct<\/a>/)
    expect(html).not.toMatch(/<nuxtlink/i)
    expect(warn).not.toHaveBeenCalled()
  })

  it('resolves a global NuxtLink by name, which is how an app template writes it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const ByName = defineComponent({ template: '<NuxtLink to="/a">A</NuxtLink>' })
    // `template` needs the runtime compiler, which vue's SSR build has.
    const html = await renderToString(createSSRApp(ByName).use(createVueTestEnv()))
    expect(html).toMatch(/^<a href="\/a"[^>]*>A<\/a>$/)
    expect(warn).not.toHaveBeenCalled()
  })

  it('registers extra components by their Nuxt names', async () => {
    const UThing = defineComponent({ render: () => h('i', 'thing') })
    const App = defineComponent({ template: '<UThing/>' })
    const html = await renderToString(
      createSSRApp(App).use(createVueTestEnv({ components: { UThing } })),
    )
    expect(html).toBe('<i>thing</i>')
  })

  it('exposes the router so a test can navigate and wait for it', async () => {
    const env = createVueTestEnv({ initialPath: '/runners' })
    await env.router.isReady()
    expect(env.router.currentRoute.value.path).toBe('/runners')
  })

  describe('fallback mode (config.global.plugins defaults)', () => {
    /** Just enough of an app to watch what the plugin does at mount time. */
    function fakeApp(globalProperties: Record<string, unknown> = {}, registered: string[] = []) {
      const calls: string[] = []
      const app = {
        config: { globalProperties },
        use: vi.fn((plugin: unknown) => {
          calls.push('use')
          return plugin
        }),
        component: vi.fn((name: string, component?: unknown) => {
          if (component === undefined) return registered.includes(name) ? {} : undefined
          calls.push(`component:${name}`)
          return app
        }),
        mount: vi.fn(() => {
          calls.push('mount')
        }),
      }
      return { app: app as unknown as App, calls }
    }

    it('installs nothing until the app mounts', () => {
      const { app, calls } = fakeApp()
      createVueTestEnv({ fallback: true }).install!(app)
      expect(calls).toEqual([])
      app.mount('#root')
      expect(calls).toEqual(['use', 'component:NuxtLink', 'mount'])
    })

    it('keeps a router and a NuxtLink the test brought', () => {
      const { app, calls } = fakeApp({ $router: {} }, ['NuxtLink'])
      createVueTestEnv({ fallback: true }).install!(app)
      app.mount('#root')
      expect(calls).toEqual(['mount'])
    })
  })
})
