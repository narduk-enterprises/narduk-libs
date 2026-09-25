// @vitest-environment happy-dom
/*
 * NeAppShell, mounted — components backlog item 18 (narduk-libs#265).
 *
 * The real Nuxt UI dashboard primitives and `UNavigationMenu` are mounted,
 * not stubs, under a real memory router. The shell's claims are about what
 * those primitives do with the input it gives them — which link the ROUTER
 * marks active, which element really receives focus — and a stub would only
 * echo the input back.
 *
 * The desktop rail is the copy asserted on: `UDashboardSidebar` mounts its
 * mobile slide-over copy only while open, so there is exactly one rail here.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { defineComponent, h, nextTick, toValue, type Component } from 'vue'

import { useAppConfig } from '#imports'

import NeAppShell from '../src/runtime/components/NeAppShell.vue'
import { useNardukShellSections } from '../src/runtime/composables/use-narduk-shell-sections'
import { applyShellBrand, SHELL_BRAND_STYLE_KEY } from '../src/runtime/plugins/shell-brand'

import type { NeAppShellSection } from '../src/runtime/components/ne-app-shell-types'

/*
 * `useHead` is spied rather than backed by a real head: `@unhead/vue` is Nuxt's,
 * not a dependency of this package, so a test cannot create one. The spy
 * captures what the brand plugin hands Nuxt, and the brand test below puts
 * that `<style>` into the document itself.
 */
const useHead = vi.hoisted(() => vi.fn())
vi.mock('#imports', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useHead,
}))

const Blank: Component = defineComponent({ setup: () => () => h('div') })

const SECTIONS: NeAppShellSection[] = [
  {
    id: 'operate',
    label: 'Operate',
    items: [
      { label: 'Overview', to: '/' },
      { label: 'Runners', to: '/runners', badge: 3 },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    items: [
      { label: 'Hosts', to: '/hosts' },
      { label: 'Networks', to: '/networks' },
    ],
  },
]

let router: Router
let wrapper: VueWrapper | undefined

beforeEach(async () => {
  // One record per page, the shape Nuxt generates from `pages/`. A single
  // catch-all record would make every link "active", since vue-router's
  // active state compares the matched records.
  router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/runners', '/hosts', '/networks', '/admin/users'].map((path) => ({
      path,
      component: Blank,
    })),
  })
  await router.push('/runners')
  await router.isReady()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  useNardukShellSections().value = []
  delete useAppConfig().nardukShell
  useHead.mockReset()
  document.head.querySelectorAll('style[data-test-brand]').forEach((style) => style.remove())
  document.body.querySelectorAll('[data-test-teleported]').forEach((node) => node.remove())
})

async function render(
  props: Record<string, unknown> = { sections: SECTIONS },
  slots: Record<string, string> = {},
) {
  wrapper = mount(NeAppShell, {
    attachTo: document.body,
    global: { plugins: [router] },
    props,
    slots: { default: '<p data-page>page body</p>', ...slots },
  })
  await flushPromises()
  return wrapper
}

function links(root: VueWrapper) {
  return root.findAll('nav [data-slot="link"]')
}

function activeLabels(root: VueWrapper) {
  return links(root)
    .filter((link) => link.attributes('aria-current') === 'page')
    .map((link) => link.get('[data-slot="linkLabel"]').text())
}

describe('NeAppShell: sections are labelled and always expanded', () => {
  it('renders one nav landmark holding one labelled group per section', async () => {
    const shell = await render()
    const navs = shell.findAll('nav')
    expect(navs).toHaveLength(1)
    expect(navs[0]!.attributes('aria-label')).toBe('Main')

    const groups = shell.findAll('nav [role="group"]')
    expect(groups.map((group) => group.attributes('aria-label'))).toEqual([
      'Operate',
      'Infrastructure',
    ])
    expect(groups.map((group) => group.get('.ne-app-shell__section-label').text())).toEqual([
      'Operate',
      'Infrastructure',
    ])
  })

  it('renders every item of every section as a link, with nothing collapsed', async () => {
    const shell = await render()
    expect(links(shell).map((link) => [link.text(), link.attributes('href')])).toEqual([
      ['Overview', '/'],
      ['Runners3', '/runners'],
      ['Hosts', '/hosts'],
      ['Networks', '/networks'],
    ])
    expect(shell.find('nav [data-state="open"], nav [hidden]').exists()).toBe(false)
  })

  it('names the nav from navLabel', async () => {
    const shell = await render({ navLabel: 'Portal', sections: SECTIONS })
    expect(shell.get('nav').attributes('aria-label')).toBe('Portal')
  })

  it('renders an item badge beside its label', async () => {
    const shell = await render()
    expect(links(shell)[1]!.get('[data-slot="linkTrailingBadge"]').text()).toBe('3')
  })
})

describe('NeAppShell: the active item follows the route', () => {
  it('marks the item the router matches, and only that one', async () => {
    const shell = await render()
    expect(activeLabels(shell)).toEqual(['Runners'])
    expect(links(shell)[1]!.attributes('data-active')).toBeDefined()
  })

  it('moves the mark when the route changes', async () => {
    const shell = await render()
    await router.push('/hosts')
    await flushPromises()
    expect(activeLabels(shell)).toEqual(['Hosts'])
    expect(links(shell)[1]!.attributes('data-active')).toBeUndefined()
  })

  it('keeps a parent item active on a nested route (router matching, not string equality)', async () => {
    const nested = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Blank },
        { path: '/runners', component: Blank, children: [{ path: ':id', component: Blank }] },
        { path: '/:pathMatch(.*)*', component: Blank },
      ],
    })
    await nested.push('/runners/r-17')
    await nested.isReady()
    router = nested
    const shell = await render()
    expect(links(shell)[1]!.attributes('data-active')).toBeDefined()
    expect(links(shell)[0]!.attributes('data-active')).toBeUndefined()
  })
})

describe('NeAppShell: arrow keys walk the rail', () => {
  async function focusedAfter(from: number, key: string) {
    const shell = await render()
    const all = links(shell)
    ;(all[from]!.element as HTMLElement).focus()
    await all[from]!.trigger('keydown', { key })
    return links(shell).findIndex((link) => link.element === document.activeElement)
  }

  it('ArrowDown moves to the next link, across a section boundary', async () => {
    expect(await focusedAfter(0, 'ArrowDown')).toBe(1)
    wrapper?.unmount()
    expect(await focusedAfter(1, 'ArrowDown')).toBe(2)
  })

  it('ArrowUp moves to the previous link, across a section boundary', async () => {
    expect(await focusedAfter(2, 'ArrowUp')).toBe(1)
  })

  it('wraps at both ends', async () => {
    expect(await focusedAfter(3, 'ArrowDown')).toBe(0)
    wrapper?.unmount()
    expect(await focusedAfter(0, 'ArrowUp')).toBe(3)
  })

  it('Home and End jump to the first and last link', async () => {
    expect(await focusedAfter(2, 'Home')).toBe(0)
    wrapper?.unmount()
    expect(await focusedAfter(1, 'End')).toBe(3)
  })

  it('moves focus only: the route does not change and every link stays tabbable', async () => {
    const shell = await render()
    ;(links(shell)[0]!.element as HTMLElement).focus()
    await links(shell)[0]!.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/runners')
    expect(links(shell).every((link) => link.attributes('tabindex') !== '-1')).toBe(true)
  })

  it('leaves other keys alone', async () => {
    expect(await focusedAfter(1, 'ArrowRight')).toBe(1)
  })
})

describe('NeAppShell: slots', () => {
  it('renders the rail-top and rail-bottom slots in the rail', async () => {
    const shell = await render(
      { sections: SECTIONS },
      { 'rail-bottom': '<span data-user>Logan</span>', 'rail-top': '<span data-logo>Acme</span>' },
    )
    const rail = shell.get('.ne-app-shell__rail')
    expect(rail.get('[data-ne-slot="rail-top"] [data-logo]').text()).toBe('Acme')
    expect(rail.get('[data-ne-slot="rail-bottom"] [data-user]').text()).toBe('Logan')
  })

  it('renders no rail header or footer when those slots are empty', async () => {
    const shell = await render()
    expect(shell.find('[data-ne-slot="rail-top"]').exists()).toBe(false)
    expect(shell.find('[data-ne-slot="rail-bottom"]').exists()).toBe(false)
  })

  it('renders the navbar slots in the navbar row', async () => {
    const shell = await render(
      { sections: SECTIONS },
      { navbar: '<span data-crumb>Runners</span>', 'navbar-right': '<button>Search</button>' },
    )
    const navbar = shell.get('.ne-app-shell__navbar')
    expect(navbar.get('[data-ne-slot="navbar"] [data-crumb]').text()).toBe('Runners')
    expect(navbar.get('[data-ne-slot="navbar-right"] button').text()).toBe('Search')
    expect(navbar.classes()).not.toContain('ne-app-shell__navbar--toggle-only')
  })

  it('marks a navbar with no content as toggle-only, and never draws the navbar h1', async () => {
    const shell = await render()
    expect(shell.get('.ne-app-shell__navbar').classes()).toContain(
      'ne-app-shell__navbar--toggle-only',
    )
    expect(shell.find('h1').exists()).toBe(false)
  })

  it('renders the page inside the one main landmark, which the skip link targets', async () => {
    const shell = await render()
    const main = shell.get('main')
    expect(shell.findAll('main')).toHaveLength(1)
    expect(main.get('[data-page]').text()).toBe('page body')
    expect(shell.get('.ne-app-shell__skip').attributes('href')).toBe(`#${main.attributes('id')}`)
    expect(shell.get('.ne-app-shell__skip').text()).toBe('Skip to content')
  })
})

describe('NeAppShell: useNardukShellSections() drives the rail', () => {
  it('renders the shared sections when no sections prop is given', async () => {
    useNardukShellSections().value = [SECTIONS[0]!]
    const shell = await render({})
    expect(shell.findAll('nav [role="group"]')).toHaveLength(1)
    expect(links(shell).map((link) => link.attributes('href'))).toEqual(['/', '/runners'])
  })

  it('re-renders the rail when the shared state is mutated', async () => {
    const sections = useNardukShellSections()
    sections.value = [SECTIONS[0]!]
    const shell = await render({})

    sections.value.push({
      id: 'admin',
      label: 'Admin',
      items: [{ label: 'Users', to: '/admin/users' }],
    })
    await nextTick()
    expect(shell.findAll('nav [role="group"]').map((g) => g.attributes('aria-label'))).toEqual([
      'Operate',
      'Admin',
    ])

    sections.value[0]!.items.pop()
    await nextTick()
    expect(links(shell).map((link) => link.text())).toEqual(['Overview', 'Users'])
  })

  it('prefers the sections prop over the shared state', async () => {
    useNardukShellSections().value = [SECTIONS[1]!]
    const shell = await render({ sections: [SECTIONS[0]!] })
    expect(shell.get('nav [role="group"]').attributes('aria-label')).toBe('Operate')
  })
})

describe('NeAppShell: variant', () => {
  it("defaults to 'rail' and exposes it on the root", async () => {
    const shell = await render()
    expect(shell.get('.ne-app-shell').attributes('data-variant')).toBe('rail')
  })
})

describe('NeAppShell: nardukShell accent and structure override the brand tokens', () => {
  /** What the brand plugin handed `useHead`: the style entries, unwrapped. */
  function brandStyles(): Array<{ key: string; textContent: string }> {
    expect(useHead).toHaveBeenCalledTimes(1)
    return toValue(useHead.mock.calls[0]![0].style)
  }

  /** Puts the plugin's rule into the document, as Nuxt's head would. */
  function installBrandStyle() {
    const [entry] = brandStyles()
    const style = document.createElement('style')
    style.dataset.testBrand = ''
    style.textContent = entry!.textContent
    document.head.append(style)
  }

  /** The theme's own declarations the override has to beat (theme.css shape). */
  function installThemeDefaults() {
    const style = document.createElement('style')
    style.dataset.testBrand = ''
    style.textContent = [
      ':root, .light { --ne-accent: #0f766e; --ne-structure: #1e293b; }',
      '.dark { --ne-accent: #2dd4bf; --ne-structure: #0f172a; }',
    ].join('\n')
    document.head.append(style)
  }

  function token(element: Element, name: string) {
    return getComputedStyle(element).getPropertyValue(name).trim()
  }

  it('sets nothing when neither option is given', () => {
    applyShellBrand()
    expect(brandStyles()).toEqual([])
  })

  it('writes one keyed head style carrying both tokens', () => {
    useAppConfig().nardukShell = { accent: '#7c3aed', structure: 'oklch(0.3 0.05 260)' }
    applyShellBrand()
    const styles = brandStyles()
    expect(styles).toHaveLength(1)
    expect(styles[0]!.key).toBe(SHELL_BRAND_STYLE_KEY)
    expect(styles[0]!.textContent).toContain('--ne-accent: #7c3aed;')
    expect(styles[0]!.textContent).toContain('--ne-structure: oklch(0.3 0.05 260);')
  })

  it('overrides only the token that was given', () => {
    useAppConfig().nardukShell = { accent: '#7c3aed' }
    applyShellBrand()
    expect(brandStyles()[0]!.textContent).not.toContain('--ne-structure')
  })

  /*
   * The rule is declared on the document root, so every element inherits it —
   * the shell, and an overlay Nuxt UI teleports to <body>, which no style on
   * the shell's own root could reach. happy-dom does not implement custom
   * property inheritance, so the proof is at the root the rule targets: that
   * it matches there and outranks theme.css's `:root` / `.light` / `.dark`.
   */
  it('declares the tokens on the document root, over the theme defaults', async () => {
    document.documentElement.classList.add('dark')
    try {
      useAppConfig().nardukShell = { accent: '#7c3aed', structure: '#111827' }
      applyShellBrand()
      installBrandStyle()
      // After the brand rule, so it wins on specificity, not source order.
      installThemeDefaults()
      await render()

      expect(token(document.documentElement, '--ne-accent')).toBe('#7c3aed')
      expect(token(document.documentElement, '--ne-structure')).toBe('#111827')
    } finally {
      document.documentElement.classList.remove('dark')
    }
  })

  it('wins inside a subtree pinned to the dark scheme', () => {
    useAppConfig().nardukShell = { accent: '#7c3aed' }
    applyShellBrand()
    installBrandStyle()
    installThemeDefaults()

    const pinned = document.createElement('div')
    pinned.className = 'dark'
    pinned.dataset.testTeleported = ''
    document.body.append(pinned)
    expect(token(pinned, '--ne-accent')).toBe('#7c3aed')
  })

  it('follows a runtime change to app.config', () => {
    useAppConfig().nardukShell = { accent: '#7c3aed' }
    applyShellBrand()
    ;(useAppConfig().nardukShell as { accent: string }).accent = '#be123c'
    expect(brandStyles()[0]!.textContent).toContain('--ne-accent: #be123c;')
  })
})
