import { afterEach, describe, expect, it, vi } from 'vitest'

// CI installs Miniflare 5, so the real-runtime suite in d1.test.ts only runs
// the converter path. This pins the other branch: a Miniflare with no
// `convertV4MiniflareOptions` export (every 4.x) gets the options unchanged.
describe('createD1QueryHarness on Miniflare 4', () => {
  afterEach(() => {
    vi.doUnmock('miniflare')
    vi.resetModules()
  })

  it('passes the v4 options straight to the constructor when there is no converter', async () => {
    const constructed: unknown[] = []
    vi.doMock('miniflare', () => ({
      // Declared, not omitted: Vitest throws on reading an export a mock lacks.
      convertV4MiniflareOptions: undefined,
      Miniflare: class {
        constructor(options: unknown) {
          constructed.push(options)
        }
        getD1Database() {
          return Promise.resolve({})
        }
        dispose() {
          return Promise.resolve()
        }
      },
    }))
    const { createD1QueryHarness } = await import('../src/d1.js')

    const harness = await createD1QueryHarness({ migrations: [], compatibilityDate: '2026-01-01' })
    await harness.dispose()

    expect(constructed).toEqual([
      {
        compatibilityDate: '2026-01-01',
        d1Databases: ['DB'],
        modules: true,
        script: 'export default { fetch() { return new Response("narduk-testkit d1") } }',
      },
    ])
  })
})
