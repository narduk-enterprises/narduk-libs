/*
 * Server-render proof for NePageHeader and NeSectionHeader — the
 * packages/design/narduk-charts/src/ssr.test.ts pattern (narduk-charts#31).
 *
 * Every consumer of narduk-shell is a Nuxt/Nitro app, and the first render of
 * every page happens on a server with no `window`/`document` at all for the
 * Cloudflare Workers preset. This file therefore runs in vitest's `node`
 * environment (this package's default; NePageHeader.mount.test.ts and
 * NeSectionHeader.mount.test.ts opt INTO happy-dom per file) and renders
 * through `@vue/server-renderer`.
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

const { default: NePageHeader } = await import('../src/runtime/components/NePageHeader.vue')
const { default: NeSectionHeader } = await import('../src/runtime/components/NeSectionHeader.vue')

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(component: Component, props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(component, props))
}

describe('server rendering without a DOM', () => {
  it('NePageHeader renders its h1 and description in the server output', async () => {
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

  it('NePageHeader renders the breadcrumb nav in the server output', async () => {
    const html = await render(NePageHeader, {
      title: 'Runners',
      breadcrumbs: [{ label: 'Infrastructure', to: '/infrastructure' }, { label: 'Runners' }],
    })

    expect(html).toContain('<nav')
    expect(html).toContain('aria-label="Breadcrumb"')
    expect(html).toContain('href="/infrastructure"')
  })

  it('NeSectionHeader renders its heading and formatted count in the server output', async () => {
    const html = await render(NeSectionHeader, { title: 'Deployments', count: 1234 })

    expect(html).toContain('<h2')
    expect(html).toContain('Deployments')
    expect(html).toContain(new Intl.NumberFormat().format(1234))
  })

  it('does not touch a DOM global merely by importing or rendering either component', async () => {
    await expect(render(NePageHeader, { title: 'Runners' })).resolves.toContain('<h1')
    await expect(render(NeSectionHeader, { title: 'Recent' })).resolves.toContain('<h2')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })
})
