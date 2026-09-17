// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const numberFormatLocales: unknown[] = []
const OriginalNumberFormat = Intl.NumberFormat

beforeAll(() => {
  function TrackingNumberFormat(locale?: string | string[], options?: Intl.NumberFormatOptions) {
    numberFormatLocales.push(locale)
    return new OriginalNumberFormat(locale, options)
  }
  vi.spyOn(Intl, 'NumberFormat').mockImplementation(
    TrackingNumberFormat as unknown as typeof Intl.NumberFormat,
  )
})

afterAll(() => {
  vi.restoreAllMocks()
})

vi.mock('@nuxt/ui/components/Badge.vue', async () => {
  const { UBadgeStub } = await import('./support/nuxt-ui-stubs')
  return { default: UBadgeStub }
})

const { default: NeSectionHeader } = await import('../src/runtime/components/NeSectionHeader.vue')

describe('NeSectionHeader', () => {
  it('renders the title as an h2 by default', () => {
    const wrapper = mount(NeSectionHeader, { props: { title: 'Recent' } })

    const headings = wrapper.findAll('h2')
    expect(headings).toHaveLength(1)
    expect(headings[0]?.text()).toBe('Recent')
  })

  it('hides the count badge when the prop is undefined', () => {
    const wrapper = mount(NeSectionHeader, { props: { title: 'Recent' } })

    expect(wrapper.find('[data-slot="count"]').exists()).toBe(false)
    expect(wrapper.find('h2').text()).toBe('Recent')
  })

  it('renders a token-themed badge next to the title with an accessible label', () => {
    const wrapper = mount(NeSectionHeader, { props: { title: 'Deployments', count: 12345 } })

    const count = wrapper.find('[data-slot="count"]')
    expect(count.exists()).toBe(true)
    expect(count.text()).toBe('12,345')
    expect(numberFormatLocales).toContain('en-US')
    expect(count.attributes('aria-label')).toBe('12345 items')
    // Sibling of the heading, not nested inside it.
    expect(wrapper.find('h2').find('[data-slot="count"]').exists()).toBe(false)
  })

  it('uses the singular label for a count of exactly one', () => {
    const wrapper = mount(NeSectionHeader, { props: { title: 'Deployments', count: 1 } })

    expect(wrapper.find('[data-slot="count"]').attributes('aria-label')).toBe('1 item')
  })

  it('renders zero as a real, visible count rather than treating it as absent', () => {
    const wrapper = mount(NeSectionHeader, { props: { title: 'Deployments', count: 0 } })

    const count = wrapper.find('[data-slot="count"]')
    expect(count.exists()).toBe(true)
    expect(count.text()).toBe('0')
  })

  it('renders the description', () => {
    const wrapper = mount(NeSectionHeader, {
      props: { title: 'Recent', description: 'The last 24 hours.' },
    })

    expect(wrapper.text()).toContain('The last 24 hours.')
  })

  it('places actions next to the title, never inside the heading element', () => {
    const wrapper = mount(NeSectionHeader, {
      props: { title: 'Recent' },
      slots: { actions: '<button type="button">View all</button>' },
    })

    expect(wrapper.find('h2').find('button').exists()).toBe(false)
    const button = wrapper.find('button')
    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('View all')
  })

  it('honours an as override for the heading level', () => {
    const wrapper = mount(NeSectionHeader, { props: { title: 'Recent', as: 'h3' } })

    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.find('h3').text()).toBe('Recent')
  })

  it('renders the default slot content below the header row', () => {
    const wrapper = mount(NeSectionHeader, {
      props: { title: 'Recent' },
      slots: { default: '<p data-testid="extra">Extra content</p>' },
    })

    expect(wrapper.find('[data-testid="extra"]').exists()).toBe(true)
  })
})
