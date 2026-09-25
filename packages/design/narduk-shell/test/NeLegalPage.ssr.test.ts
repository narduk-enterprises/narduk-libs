/*
 * Server-render proof for NeLegalPage (narduk-libs#388). A legal page is a
 * static, indexable page, so everything — the draft banner included — has to
 * be in the server output, not added after hydration.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeLegalPage from '../src/runtime/components/NeLegalPage.vue'
import { termsOfServiceTemplate } from '../src/runtime/utils/legal-templates'

import type { NeLegalPageProps } from '../src/runtime/components/ne-legal-page-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeLegalPageProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeLegalPage, props) }))
}

describe('NeLegalPage server-rendered without a DOM', () => {
  it('carries the draft banner, the contents and the placeholder marks into the first paint', async () => {
    const template = termsOfServiceTemplate({
      appName: 'Buoys',
      companyName: 'Example Co',
      contactEmail: 'legal@example.test',
    })
    const html = await render({
      lastUpdated: '2026-03-08',
      sections: template.sections,
      title: template.title,
    })

    expect(html).toContain('data-ne-legal-page')
    expect(html).toContain('data-ne-legal-status="draft"')
    expect(html).toContain('data-ne-legal-draft')
    expect(html).toContain('data-ne-legal-placeholder')
    expect(html).toContain('[PLACEHOLDER')
    expect(html).toContain('Last updated <time datetime="2026-03-08">Mar 8, 2026</time>')
    expect(html).toContain(`href="#${template.sections[0]!.id}"`)
  })

  it('renders an approved, placeholder-free page without the banner', async () => {
    const html = await render({
      sections: [{ body: 'Approved text supplied by the app.', id: 'scope', title: 'Scope' }],
      title: 'Terms',
      wordingApproved: true,
    })
    expect(html).toContain('data-ne-legal-status="approved"')
    expect(html).not.toContain('data-ne-legal-draft')
    expect(html).not.toContain('data-ne-legal-placeholder')
  })
})
