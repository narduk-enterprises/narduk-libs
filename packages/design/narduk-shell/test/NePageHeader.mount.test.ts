// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

// Hoisted above the imports below by vitest; see test/support/nuxt-ui-stubs.ts
// for why NePageHeader's real @nuxt/ui dependencies are replaced here rather
// than mounted for real.
vi.mock('@nuxt/ui/components/PageHeader.vue', async () => {
  const { UPageHeaderStub } = await import('./support/nuxt-ui-stubs')
  return { default: UPageHeaderStub }
})
vi.mock('@nuxt/ui/components/Breadcrumb.vue', async () => {
  const { UBreadcrumbStub } = await import('./support/nuxt-ui-stubs')
  return { default: UBreadcrumbStub }
})

const { default: NePageHeader } = await import('../src/runtime/components/NePageHeader.vue')

describe('NePageHeader', () => {
  it('renders the title as a single h1 by default', () => {
    const wrapper = mount(NePageHeader, { props: { title: 'Runners' } })

    const headings = wrapper.findAll('h1')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.text()).toBe('Runners')
  })

  it('renders the eyebrow above the title', () => {
    const wrapper = mount(NePageHeader, {
      props: { title: 'Runners', eyebrow: 'Infrastructure' },
    })

    expect(wrapper.find('[data-slot="headline"]').text()).toBe('Infrastructure')
  })

  it('renders the description', () => {
    const wrapper = mount(NePageHeader, {
      props: { title: 'Runners', description: 'Every self-hosted runner class.' },
    })

    expect(wrapper.find('[data-slot="description"]').text()).toBe('Every self-hosted runner class.')
  })

  it('omits the description block entirely when no description is given', () => {
    const wrapper = mount(NePageHeader, { props: { title: 'Runners' } })

    expect(wrapper.find('[data-slot="description"]').exists()).toBe(false)
  })

  it('renders breadcrumbs as a labelled nav with the right links, above the header', () => {
    const wrapper = mount(NePageHeader, {
      props: {
        title: 'Runners',
        breadcrumbs: [{ label: 'Infrastructure', to: '/infrastructure' }, { label: 'Runners' }],
      },
    })

    const nav = wrapper.get('nav[aria-label="Breadcrumb"]')

    const links = nav.findAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]?.attributes('href')).toBe('/infrastructure')
    expect(links[0]?.text()).toBe('Infrastructure')
    expect(nav.text()).toContain('Runners')

    // Breadcrumb precedes the header in document order. Compared as elements
    // rather than as substrings of the markup: both stubs mark their own root
    // `data-slot="root"`, so an index comparison would pass on the breadcrumb's
    // own root and prove nothing about the header.
    const heading = wrapper.get('h1')
    expect(
      nav.element.compareDocumentPosition(heading.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  /*
   * UBreadcrumb's own root already IS the nav landmark
   * (`<Primitive as="nav" aria-label="breadcrumb">`), and an `aria-label`
   * passed to it falls through onto that same root. NePageHeader used to wrap
   * it in a second `<nav aria-label="Breadcrumb">`, so every page using the
   * shared header shipped two identically named navigation landmarks. The
   * test above asserted that *a* labelled nav existed and so never saw it:
   * only the count does.
   */
  it('emits exactly one breadcrumb landmark, not a nested pair', () => {
    const wrapper = mount(NePageHeader, {
      props: {
        title: 'Runners',
        breadcrumbs: [{ label: 'Infrastructure', to: '/infrastructure' }, { label: 'Runners' }],
      },
    })

    expect(wrapper.findAll('nav')).toHaveLength(1)
    expect(wrapper.findAll('[aria-label="Breadcrumb"]')).toHaveLength(1)
    expect(wrapper.findAll('nav nav')).toHaveLength(0)
  })

  it('renders no breadcrumb nav when the list is empty or absent', () => {
    const withoutProp = mount(NePageHeader, { props: { title: 'Runners' } })
    expect(withoutProp.find('nav').exists()).toBe(false)

    const withEmpty = mount(NePageHeader, { props: { title: 'Runners', breadcrumbs: [] } })
    expect(withEmpty.find('nav').exists()).toBe(false)
  })

  it('places the actions slot next to the title, never inside the heading element', () => {
    const wrapper = mount(NePageHeader, {
      props: { title: 'Runners' },
      slots: { actions: '<button type="button">New runner</button>' },
    })

    const heading = wrapper.find('h1')
    expect(heading.find('button').exists()).toBe(false)

    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('New runner')
  })

  it('lets the #title slot override the title text, still inside the single h1', () => {
    const wrapper = mount(NePageHeader, {
      props: { title: 'Runners' },
      slots: { title: '<span data-testid="custom-title">Runners <em>(beta)</em></span>' },
    })

    const headings = wrapper.findAll('h1')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.find('[data-testid="custom-title"]').exists()).toBe(true)
  })

  it('renders the default slot content below the header', () => {
    const wrapper = mount(NePageHeader, {
      props: { title: 'Runners' },
      slots: { default: '<p data-testid="extra">Extra content</p>' },
    })

    expect(wrapper.find('[data-testid="extra"]').exists()).toBe(true)
  })

  describe('as override', () => {
    it('renders the given tag instead of h1, and stops UPageHeader from also rendering one', () => {
      const wrapper = mount(NePageHeader, { props: { title: 'Widget total', as: 'h2' } })

      expect(wrapper.find('h1').exists()).toBe(false)
      const h2 = wrapper.find('h2')
      expect(h2.exists()).toBe(true)
      expect(h2.text()).toBe('Widget total')
    })

    it('still keeps actions out of the overridden heading element', () => {
      const wrapper = mount(NePageHeader, {
        props: { title: 'Widget total', as: 'h2' },
        slots: { actions: '<button type="button">Refresh</button>' },
      })

      expect(wrapper.find('h2').find('button').exists()).toBe(false)
      expect(wrapper.find('button').exists()).toBe(true)
    })

    it('still shows the eyebrow above the overridden heading', () => {
      const wrapper = mount(NePageHeader, {
        props: { title: 'Widget total', as: 'h2', eyebrow: 'Dashboard' },
      })

      expect(wrapper.find('[data-slot="headline"]').text()).toContain('Dashboard')
      expect(wrapper.find('[data-slot="headline"]').find('h2').exists()).toBe(true)
    })
  })
})
