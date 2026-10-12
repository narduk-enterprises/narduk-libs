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
 * `ClientOnly` and `NuxtImg` are registered too (the slot, and a plain `<img>`).
 *
 * Nuxt UI components (`UButton`, ...) and an app's own auto-imported components
 * (`KitTile`, ...) do not resolve either. Name them with `stubNames`, or match
 * them with `stubPatterns` (e.g. {@link NUXT_UI_PATTERN}); each becomes a
 * {@link createStub} that renders its default slot, so a template that nests
 * them still mounts. A stub is a double: a test whose assertions depend on a
 * child's real output must mount the real child (import it, or register it
 * under `components`), not rely on a stub. A component the app registers
 * itself, or one `components` names, always wins over a pattern.
 *
 * A Nuxt UI component that is importable (`@nuxt/ui/vite`, as `narduk-shell`
 * does) needs none of this. Needs `vue` and `vue-router`, both optional peers.
 */
import { defineComponent, h } from 'vue'
import { RouterLink, createMemoryHistory, createRouter } from 'vue-router'

import type { App, Component, Plugin, PropType } from 'vue'
import type { RouteLocationRaw, Router, RouteRecordRaw } from 'vue-router'

/** Matches Nuxt UI's component names: `UButton`, `UCard`, `UDropdownMenu`, ... */
export const NUXT_UI_PATTERN = /^U[A-Z]/

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

/**
 * A double for a component a unit mount cannot resolve: a `<div data-stub="Name">`
 * holding the default slot. Attributes and listeners fall through to the div, so
 * `class`, `data-*` and `onClick` still reach the DOM; props are not interpreted.
 * Named slots are dropped.
 */
export function createStub(name: string): Component {
  return defineComponent({
    name,
    setup(_props, { slots }) {
      return () => h('div', { 'data-stub': name }, slots.default?.())
    },
  })
}

/** `<ClientOnly>`: unit tests render on one side, so render the slot. */
export const ClientOnlyStub = defineComponent({
  name: 'ClientOnly',
  setup(_props, { slots }) {
    return () => slots.default?.()
  },
})

/** `<NuxtImg>`: a plain `<img>`; Nuxt Image's own props (`quality`, `format`, ...) are dropped. */
export const NuxtImgStub = defineComponent({
  name: 'NuxtImg',
  inheritAttrs: false,
  props: [
    'densities',
    'fit',
    'format',
    'modifiers',
    'placeholder',
    'preload',
    'preset',
    'provider',
    'quality',
  ],
  setup(_props, { attrs }) {
    return () => h('img', attrs)
  },
})

export interface VueTestEnvOptions {
  /** Routes for the memory router. Defaults to one catch-all, so any `to` resolves. */
  routes?: RouteRecordRaw[]
  /** Where the router starts. Defaults to `/`. */
  initialPath?: string
  /** Extra global components, registered by name. They win over `stubNames` and `stubPatterns`. */
  components?: Record<string, Component>
  /** Component names to stub with {@link createStub}: an app's own `KitTile`, `AppHeader`, ... */
  stubNames?: readonly string[]
  /** Stub every component name a pattern matches, e.g. {@link NUXT_UI_PATTERN}. */
  stubPatterns?: readonly RegExp[]
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
  const components = {
    NuxtLink: NuxtLinkStub,
    ClientOnly: ClientOnlyStub,
    NuxtImg: NuxtImgStub,
    ...options.components,
  }
  const names = options.stubNames ?? []
  const patterns = options.stubPatterns ?? []
  const applyStubs = (app: App) => {
    registerGlobalStubs(app, components)
    if (names.length > 0 || patterns.length > 0) stubUnresolved(app, names, patterns)
  }
  return {
    router,
    install(app: App) {
      if (!options.fallback) {
        app.use(router)
        applyStubs(app)
        return
      }
      const mount = app.mount.bind(app) as App['mount']
      app.mount = (...args: Parameters<App['mount']>) => {
        if (!app.config.globalProperties.$router) app.use(router)
        applyStubs(app)
        return mount(...args)
      }
    },
  }
}

const STUBBED = new WeakSet<App>()

/**
 * Resolve a name that nothing registered to a {@link createStub}, when it is
 * listed in `names` or matched by `patterns`. Vue looks a global component up
 * by plain property reads on the app's registry, so a `get` trap on it is what
 * catches a name that was never registered; `app.component()` calls bypass the
 * trap so registering the real thing later neither warns nor loses.
 */
function stubUnresolved(app: App, names: readonly string[], patterns: readonly RegExp[]): void {
  if (STUBBED.has(app)) return
  STUBBED.add(app)
  const context = app._context
  const wanted = new Set(names)
  const made = new Map<string, Component>()
  let registering = false
  const component = app.component.bind(app) as (...args: unknown[]) => unknown
  app.component = ((...args: unknown[]) => {
    registering = true
    try {
      return component(...args)
    } finally {
      registering = false
    }
  }) as App['component']
  context.components = new Proxy(context.components, {
    get(target, key, receiver) {
      const found = Reflect.get(target, key, receiver) as Component | undefined
      if (found !== undefined || registering || typeof key !== 'string') return found
      if (!wanted.has(key) && !patterns.some((pattern) => pattern.test(key))) return found
      let stub = made.get(key)
      if (!stub) made.set(key, (stub = createStub(key)))
      return stub
    },
  })
}

/** Register components on `app` under the names a Nuxt app auto-registers them as. */
export function registerGlobalStubs(app: App, components: Record<string, Component>): void {
  for (const [name, component] of Object.entries(components)) {
    if (!app.component(name)) app.component(name, component)
  }
}
