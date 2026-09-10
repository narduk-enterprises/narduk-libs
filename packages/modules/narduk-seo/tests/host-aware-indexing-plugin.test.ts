// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const useHead = vi.fn()
const useRobotsRule = vi.fn()

vi.mock('#imports', () => ({
  defineNuxtPlugin: <T>(definition: T): T => definition,
  useHead,
  useRequestURL: () => new URL('https://preview.example.workers.dev'),
  useRobotsRule,
  useRuntimeConfig: () => ({
    public: { nardukSeoHostAwareIndexing: true, siteUrl: 'https://example.com' },
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('host-aware indexing plugin', () => {
  it('uses app-safe head metadata on the client without invoking the server robots composable', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { applyHostAwareNoindexRule } = await import('../app/plugins/hostAwareIndexing')

    applyHostAwareNoindexRule(false)

    expect(useRobotsRule).not.toHaveBeenCalled()
    expect(useHead).toHaveBeenCalledWith({
      meta: [
        {
          name: 'robots',
          content: 'noindex, nofollow',
        },
      ],
    })
    expect(warning).not.toHaveBeenCalled()
  })

  it('uses the robots module on the server so rendered pages receive its response header', async () => {
    const { applyHostAwareNoindexRule } = await import('../app/plugins/hostAwareIndexing')

    applyHostAwareNoindexRule(true)

    expect(useRobotsRule).toHaveBeenCalledWith('noindex, nofollow')
    expect(useHead).not.toHaveBeenCalled()
  })
})
