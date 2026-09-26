// @vitest-environment happy-dom
/*
 * NeLegalPage, mounted (narduk-libs#388): title, a consistently formatted
 * "last updated" date, a table of contents built from the sections, and a
 * draft state that no app can switch off while a placeholder remains.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'

import NeLegalPage from '../src/runtime/components/NeLegalPage.vue'
import { privacyPolicyTemplate, type NeLegalPageProps } from '../src/index'

afterEach(() => {
  document.body.innerHTML = ''
})

const APPROVED = [
  { body: 'Approved paragraph one.', id: 'scope', title: 'Scope' },
  {
    body: ['Approved paragraph two.', 'Approved paragraph three.'],
    id: 'contact',
    title: 'Contact',
  },
]

function render(props: NeLegalPageProps, slots: Record<string, unknown> = {}) {
  return mount(NeLegalPage, { props, slots: slots as never })
}

describe('NeLegalPage: layout', () => {
  it('renders the title as the page h1 and the last-updated date through formatDate', () => {
    const wrapper = render({
      lastUpdated: '2026-03-08',
      sections: APPROVED,
      title: 'Privacy policy',
      wordingApproved: true,
    })
    const headings = wrapper.findAll('h1')
    expect(headings).toHaveLength(1)
    expect(headings[0]!.text()).toBe('Privacy policy')
    expect(wrapper.get('[data-ne-legal-updated]').text()).toBe('Last updated Mar 8, 2026')
    expect(wrapper.get('[data-ne-legal-updated] time').attributes('datetime')).toBe('2026-03-08')
  })

  it('formats an instant last-updated in the given zone, and omits it without one', () => {
    const zoned = render({
      lastUpdated: '2026-03-08T03:00:00Z',
      sections: APPROVED,
      timeZone: 'America/Chicago',
      title: 'Terms',
    })
    expect(zoned.get('[data-ne-legal-updated]').text()).toBe('Last updated Mar 7, 2026')

    const unzoned = render({
      lastUpdated: '2026-03-08T03:00:00Z',
      sections: APPROVED,
      title: 'Terms',
    })
    expect(unzoned.find('[data-ne-legal-updated]').exists()).toBe(false)
  })

  it('builds a table of contents that links to every section by id', () => {
    const wrapper = render({ sections: APPROVED, title: 'Terms', wordingApproved: true })
    const nav = wrapper.get('nav[aria-label="Contents"]')
    const links = nav.findAll('a')
    expect(links.map((link) => link.attributes('href'))).toEqual(['#scope', '#contact'])
    expect(links.map((link) => link.text())).toEqual(['Scope', 'Contact'])
    expect(wrapper.get('section#scope h2').text()).toBe('Scope')
    expect(wrapper.get('section#contact').findAll('p')).toHaveLength(2)
  })

  it('lets a section slot replace a body while the heading and anchor stay', () => {
    const wrapper = render(
      { sections: APPROVED, title: 'Terms', wordingApproved: true },
      {
        section: ({ section }: { section: { id: string } }) =>
          h('div', { class: 'custom' }, `custom ${section.id}`),
      },
    )
    expect(wrapper.get('section#scope .custom').text()).toBe('custom scope')
    expect(wrapper.get('section#scope h2').text()).toBe('Scope')
  })
})

describe('NeLegalPage: placeholders are obvious, and approval cannot hide one', () => {
  it('marks a template page as a draft with a visible banner and marked sections', () => {
    const template = privacyPolicyTemplate({
      appName: 'Buoys',
      companyName: 'Example Co',
      contactEmail: 'privacy@example.test',
    })
    const wrapper = render({ sections: template.sections, title: template.title })
    const root = wrapper.get('[data-ne-legal-page]')
    expect(root.attributes('data-ne-legal-status')).toBe('draft')
    expect(wrapper.find('[data-ne-legal-draft]').exists()).toBe(true)
    expect(wrapper.findAll('section[data-ne-legal-placeholder]')).toHaveLength(
      template.sections.length,
    )
  })

  it('stays a draft when an app claims approval but a placeholder remains', () => {
    const template = privacyPolicyTemplate({
      appName: 'Buoys',
      companyName: 'Example Co',
      contactEmail: 'privacy@example.test',
    })
    const wrapper = render({
      sections: [...APPROVED, template.sections[0]!],
      title: 'Privacy policy',
      wordingApproved: true,
    })
    expect(wrapper.get('[data-ne-legal-page]').attributes('data-ne-legal-status')).toBe('draft')
    expect(wrapper.find('[data-ne-legal-draft]').exists()).toBe(true)
    expect(wrapper.findAll('section[data-ne-legal-placeholder]')).toHaveLength(1)
  })

  it('is a draft by default even with app-written sections, until wording is approved', () => {
    const draft = render({ sections: APPROVED, title: 'Terms' })
    expect(draft.get('[data-ne-legal-page]').attributes('data-ne-legal-status')).toBe('draft')
    expect(draft.find('[data-ne-legal-draft]').exists()).toBe(true)
    expect(draft.find('[data-ne-legal-placeholder]').exists()).toBe(false)

    const approved = render({ sections: APPROVED, title: 'Terms', wordingApproved: true })
    expect(approved.get('[data-ne-legal-page]').attributes('data-ne-legal-status')).toBe('approved')
    expect(approved.find('[data-ne-legal-draft]').exists()).toBe(false)
  })
})
