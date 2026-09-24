/**
 * Downstream modules must be able to add a CSP source without forking the
 * policy or racing `narduk-core` setup. The CSP contribution hook is that
 * extension point; a late listener is a build error, not a silent drop
 * (narduk-libs#410).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyCspContributionPoint, CSP_LATE_CONTRIBUTION_ERROR } from '../src/csp-contributions'

import type { CspContributionHost, MutableSecurityHeadersAllowlist } from '../src/csp-contributions'

const CSP_HOOK = 'narduk-core:csp'
const WIDGETS_ORIGIN = 'https://widgets.example'

type HookHandler = (...args: never[]) => unknown

function createHookable() {
  const hooks = new Map<string, HookHandler[]>()
  return {
    hooks,
    hook(name: string, handler: HookHandler) {
      hooks.set(name, [...(hooks.get(name) || []), handler])
    },
    async callHook(name: string, ...args: unknown[]) {
      for (const handler of hooks.get(name) || []) {
        await handler(...(args as never[]))
      }
    },
    async run(name: string) {
      for (const handler of hooks.get(name) || []) {
        await handler()
      }
    },
  }
}

describe('CSP contribution point (narduk-libs#410)', () => {
  it('merges a hook script origin into the app allowlist', async () => {
    const nuxt = createHookable()
    const options: CspContributionHost = {
      security: { headers: { enabled: true } },
    }
    nuxt.hook(CSP_HOOK, (allow: MutableSecurityHeadersAllowlist) => {
      allow.script.push(WIDGETS_ORIGIN)
    })

    await applyCspContributionPoint(options, nuxt)

    expect(options.security?.headers).toEqual({
      enabled: true,
      allow: expect.objectContaining({
        script: [WIDGETS_ORIGIN],
      }),
    })
  })

  it('keeps the app allowlist and appends the contribution', async () => {
    const nuxt = createHookable()
    const options = {
      security: {
        headers: {
          enabled: true,
          allow: { script: ['https://app.example'], connect: ['https://api.example'] },
        },
      },
    }
    nuxt.hook(CSP_HOOK, (allow: MutableSecurityHeadersAllowlist) => {
      allow.script.push('https://cdn.example')
    })

    await applyCspContributionPoint(options, nuxt)

    const headers = options.security.headers
    expect(headers.allow?.script).toEqual(['https://app.example', 'https://cdn.example'])
    expect(headers.allow?.connect).toEqual(['https://api.example'])
  })

  it('fails the build when a contribution arrives after the policy is resolved', async () => {
    const nuxt = createHookable()
    const options = { security: { headers: { enabled: true } } }
    await applyCspContributionPoint(options, nuxt)

    nuxt.hook(CSP_HOOK, (allow: MutableSecurityHeadersAllowlist) => {
      allow.script.push('https://too-late.example')
    })

    await expect(nuxt.run('modules:done')).rejects.toThrow(CSP_LATE_CONTRIBUTION_ERROR)
  })

  it('does not throw at modules:done when every contribution was merged', async () => {
    const nuxt = createHookable()
    const options = { security: { headers: { enabled: true } } }
    nuxt.hook(CSP_HOOK, (allow: MutableSecurityHeadersAllowlist) => {
      allow.connect.push('https://on-time.example')
    })
    await applyCspContributionPoint(options, nuxt)

    await expect(nuxt.run('modules:done')).resolves.toBeUndefined()
  })
})

describe('the published module entry applies contributions before nuxt-security', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('@nuxt/kit')
  })

  it('installs the contributed script origin without the app restating the policy', async () => {
    const installModule = vi.fn()
    vi.resetModules()
    vi.doMock('@nuxt/kit', () => ({
      addComponentsDir: vi.fn(),
      addImportsDir: vi.fn(),
      addPlugin: vi.fn(),
      addServerHandler: vi.fn(),
      addServerScanDir: vi.fn(),
      addTemplate: vi.fn((template: { src: string }) => ({
        filename: template.src.split('/').pop(),
      })),
      createResolver: (url: string) => ({
        resolve: (path: string) => new URL(path, url).pathname,
      }),
      defineNuxtModule: (definition: unknown) => definition,
      installModule,
    }))

    const { default: mod } = (await import('../src/module-entry')) as unknown as {
      default: {
        setup: (options: unknown, nuxt: Record<string, unknown>) => Promise<void>
      }
    }
    const nuxt = createHookable()
    const nuxtWithOptions = {
      ...nuxt,
      options: {
        alias: {},
        app: {},
        appConfig: {},
        build: { transpile: [] },
        colorMode: {},
        css: [],
        devServer: {},
        future: {},
        icon: {},
        nitro: {},
        runtimeConfig: {},
        ui: {},
        vite: {},
      },
    }
    nuxt.hook(CSP_HOOK, (allow: MutableSecurityHeadersAllowlist) => {
      allow.script.push(WIDGETS_ORIGIN)
    })

    await mod.setup(
      { app: false, coreModules: false, image: false, server: false, security: { headers: true } },
      nuxtWithOptions,
    )

    const securityCall = installModule.mock.calls.find((entry) => entry[0] === 'nuxt-security')
    expect(securityCall).toBeDefined()
    const scriptSrc = (
      securityCall?.[1] as {
        headers: { contentSecurityPolicy: { 'script-src': string[] } }
      }
    ).headers.contentSecurityPolicy['script-src']
    expect(scriptSrc).toContain(WIDGETS_ORIGIN)
  })
})
