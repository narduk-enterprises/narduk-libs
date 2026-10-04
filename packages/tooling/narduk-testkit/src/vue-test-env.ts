/**
 * The pieces a Nuxt app supplies and a plain Vitest mount does not
 * (narduk-libs#1403).
 *
 * `mount(Component)` and `createSSRApp(Component)` run with no router and no
 * globally registered components. A tree that uses `UButton`, `ULink` or
 * `<NuxtLink>` then warns `injection "Symbol(route location)" not found` or
 * `Failed to resolve component: NuxtLink`, and Vue renders the unresolved tag as
 * an unknown element (`<nuxtlink to="/x">`). The test goes on to assert against
 * that element, so a link's `href` is never actually checked.
 *
 * {@link createVueTestEnv} returns one plugin that installs a real
 * `vue-router` (memory history) and a `NuxtLink` that renders what Nuxt's does,
 * an `<a href>` with the slot inside it:
 *
 * ```ts
 * const env = createVueTestEnv()
 * const wrapper = mount(Page, { global: { plugins: [env] } })
 * await env.router.isReady()
 *
 * const html = await renderToString(createSSRApp(Page).use(env))
 * ```
 *
 * To apply it to every `mount()` in a suite, set it once in the Vitest setup
 * file (`config` is from `@vue/test-utils`):
 *
 * ```ts
 * beforeEach(() => {
 *   config.global.plugins = [createVueTestEnv({ fallback: true })]
 * })
 * ```
 *
 * `fallback` defers to mount time and installs only what the test did not
 * bring: a test that passes its own router, or registers its own `NuxtLink`
 * double, keeps it. `createSSRApp` has no global config, so SSR tests call
 * `.use(createVueTestEnv())`.
 *
 * A Nuxt UI component that is not importable outside Nuxt (it reads
 * `#build/ui/*`) is not covered here; register a double with
 * {@link registerGlobalStubs}, or use `@nuxt/ui/vite` as `narduk-shell` does.
 * Needs `vue` and `vue-router`, both optional peers.
 */
import { defineComponent, h } from 'vue'
import { RouterLink, createMemoryHistory, createRouter } from 'vue-router'

import type { App, Component, Plugin, PropType } from 'vue'
import type { RouteLocationRaw, Router, RouteRecordRaw } from 'vue-router'

const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i

/**
 * A `NuxtLink` for tests: an in-app `to` renders through `RouterLink` (real
 * `href`, active classes), an external or `href`-only link a plain anchor.
 * Nuxt-only props (`prefetch`, `noPrefetch`, ...) are accepted and dropped.
 */
export const NuxtLinkStub = defineComponent({
  name: 'NuxtLink',
  inheritAttrs: false,
  props: {
    activeClass: String,
    exactActiveClass: String,
    external: Boolean,
    href: String,
    noPrefetch: Boolean,
    noRel: Boolean,
    prefetch: Boolean,
    rel: String,
    replace: Boolean,
    target: String,
    to: [String, Object] as PropType<RouteLocationRaw>,
  },
  setup(props, { attrs, slots }) {
    return () => {
      const target = props.to ?? props.href
      if (typeof target === 'string' && (props.external || EXTERNAL.test(target))) {
        return h(
          'a',
          { ...attrs, href: target, rel: props.rel, target: props.target },
          slots.default?.(),
        )
      }
      if (target === undefined) return h('a', attrs, slots.default?.())
      return h(
        RouterLink,
        {
          ...attrs,
          activeClass: props.activeClass,
          exactActiveClass: props.exactActiveClass,
          replace: props.replace,
          target: props.target,
          to: target,
        },
        slots.default ? { default: slots.default } : undefined,
      )
    }
  },
})

export interface VueTestEnvOptions {
  /** Routes for the memory router. Defaults to one catch-all, so any `to` resolves. */
  routes?: RouteRecordRaw[]
  /** Where the router starts. Defaults to `/`. */
  initialPath?: string
  /** Extra global components, registered by name. */
  components?: Record<string, Component>
  /**
   * Install the router and components when the app mounts, and only those the
   * test did not already provide. For `config.global.plugins` defaults.
   */
  fallback?: boolean
}

export type VueTestEnv = Plugin & { router: Router }

const EMPTY = defineComponent({ name: 'VueTestEnvRoute', render: () => null })

export function createVueTestEnv(options: VueTestEnvOptions = {}): VueTestEnv {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: options.routes ?? [{ path: '/:pathMatch(.*)*', component: EMPTY }],
  })
  if (options.initialPath) void router.push(options.initialPath)
  const components = { NuxtLink: NuxtLinkStub, ...options.components }
  return {
    router,
    install(app: App) {
      if (!options.fallback) {
        app.use(router)
        registerGlobalStubs(app, components)
        return
      }
      const mount = app.mount.bind(app) as App['mount']
      app.mount = (...args: Parameters<App['mount']>) => {
        if (!app.config.globalProperties.$router) app.use(router)
        registerGlobalStubs(app, components)
        return mount(...args)
      }
    },
  }
}

/** Register components on `app` under the names a Nuxt app auto-registers them as. */
export function registerGlobalStubs(app: App, components: Record<string, Component>): void {
  for (const [name, component] of Object.entries(components)) {
    if (!app.component(name)) app.component(name, component)
  }
}
