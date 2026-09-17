/*
 * Server-render proof for NePageHeader and NeSectionHeader — the
 * packages/design/narduk-charts/src/ssr.test.ts pattern (narduk-charts#31).
 *
 * Every consumer of narduk-shell is a Nuxt/Nitro app, and the first render of
 * every page happens on a server with no `window`/`document` at all for the
 * Cloudflare Workers preset. This file therefore runs in vitest's `node`
 * environment (this package's default; *.mount.test.ts files opt INTO
 * happy-dom per file) and renders through `@vue/server-renderer`.
 *
 * Item 9 (narduk-libs#256) owns the two describes below. Later component
 * items should append their own describe blocks (or a sibling *.ssr.test.ts)
 * rather than rewriting these cases.
 */
import { createSSRApp, type Component } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from '@vue/server-renderer'

vi.mock('@nuxt/ui/components/PageHeader.vue', async () => {
  const { UPageHeaderStub } = await import('./support/nuxt-ui-stubs')
  return { default: UPageHeaderStub }
})
vi.mock('@nuxt/ui/components/Breadcrumb.vue', async () => {
  const { UBreadcrumbStub } = await import('./support/nuxt-ui-stubs')
  return { default: UBreadcrumbStub }
})
vi.mock('@nuxt/ui/components/Badge.vue', async () => {
  const { UBadgeStub } = await import('./support/nuxt-ui-stubs')
  return { default: UBadgeStub }
})

const { default: NePageHeader } = await import('../src/runtime/components/NePageHeader.vue')
const { default: NeSectionHeader } = await import('../src/runtime/components/NeSectionHeader.vue')

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(component: Component, props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(component, props))
}

describe('NePageHeader', () => {
  it('renders its h1 and description in the server output', async () => {
    const html = await render(NePageHeader, {
      title: 'Runners',
      description: 'Every self-hosted runner class.',
      eyebrow: 'Infrastructure',
    })

    expect(html).toContain('<h1')
    expect(html).toContain('Runners')
    expect(html).toContain('Every self-hosted runner class.')
    expect(html).toContain('Infrastructure')
  })

  it('renders the breadcrumb nav in the server output', async () => {
    const html = await render(NePageHeader, {
      title: 'Runners',
      breadcrumbs: [{ label: 'Infrastructure', to: '/infrastructure' }, { label: 'Runners' }],
    })

    expect(html).toContain('<nav')
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('href="/infrastructure"')
  })

  it('omits the breadcrumb nav when the trail is empty', async () => {
    const html = await render(NePageHeader, { title: 'Runners', breadcrumbs: [] })

    expect(html).not.toContain('<nav')
  })
})

describe('NeSectionHeader', () => {
  it('renders its heading and formatted count in the server output', async () => {
    const html = await render(NeSectionHeader, { title: 'Deployments', count: 1234 })

    expect(html).toContain('<h2')
    expect(html).toContain('Deployments')
    expect(html).toContain('1,234')
    expect(html).toContain('data-slot="count"')
  })

  it('hides the count badge when count is undefined', async () => {
    const html = await render(NeSectionHeader, { title: 'Recent' })

    expect(html).toContain('<h2')
    expect(html).toContain('Recent')
    expect(html).not.toContain('data-slot="count"')
  })
})

describe('server rendering without a DOM', () => {
  it('does not touch a DOM global merely by importing or rendering either component', async () => {
    await expect(render(NePageHeader, { title: 'Runners' })).resolves.toContain('<h1')
    await expect(render(NeSectionHeader, { title: 'Recent' })).resolves.toContain('<h2')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
