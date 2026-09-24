/**
 * Downstream modules must be able to add a CSP source without forking the
 * policy or racing `narduk-core` setup. The CSP contribution hook is that
 * extension point; a late listener is a build error, not a silent drop
 * (narduk-libs#410).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyCspContributionPoint, CSP_LATE_CONTRIBUTION_ERROR } from '../src/csp-contributions'

import type * as SecurityHeaders from '../runtime/shared/security-headers'
import type { CspContributionHost, MutableSecurityHeadersAllowlist } from '../src/csp-contributions'
import type { NardukCoreModuleOptions } from '../src/module'
import type * as NuxtKit from '@nuxt/kit'

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

/**
 * The published entry through the real `@nuxt/kit` `defineNuxtModule`, not an
 * identity mock: the wrapper wraps kit's `normalizedModule`, whose
 * `getOptions` merges inline options, `nuxt.options.nardukCore` and the
 * defaults with defu. Feeding it options that were already resolved doubled
 * every array in an app's config (narduk-libs#850 review), so these assert on
 * the exact arrays `setup()` sees. Only the kit calls that touch the build
 * (templates, plugins, server dirs, `installModule`) are stubbed.
 */
describe('the published module entry through the real defineNuxtModule', () => {
  const APP_SCRIPT_ORIGIN = 'https://app-script.example'
  const WEBHOOK_PATH = '/api/webhook'

  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('@nuxt/kit')
    vi.doUnmock('../runtime/shared/security-headers')
  })

  async function loadRealEntry() {
    const installModule = vi.fn()
    vi.resetModules()
    vi.doMock('@nuxt/kit', async (importOriginal) => ({
      ...(await importOriginal<typeof NuxtKit>()),
      addComponentsDir: vi.fn(),
      addImportsDir: vi.fn(),
      addPlugin: vi.fn(),
      addServerHandler: vi.fn(),
      addServerScanDir: vi.fn(),
      addTemplate: vi.fn((template: { src: string }) => ({
        filename: template.src.split('/').pop(),
      })),
      installModule,
    }))
    const headersModule = await vi.importActual<typeof SecurityHeaders>(
      '../runtime/shared/security-headers',
    )
    const resolveSecurityHeaders = vi.fn(headersModule.resolveSecurityHeaders)
    vi.doMock('../runtime/shared/security-headers', () => ({
      ...headersModule,
      resolveSecurityHeaders,
    }))
    const { default: mod } = (await import('../src/module-entry')) as unknown as {
      default: (inlineOptions: unknown, nuxt: unknown) => Promise<unknown>
    }
    const { createHooks } = await import('hookable')
    const hooks = createHooks()
    let cspHookCalls = 0
    hooks.hook(CSP_HOOK, () => {
      cspHookCalls += 1
    })
    const nuxt = {
      _version: '4.5.2',
      hooks,
      hook: hooks.hook.bind(hooks),
      callHook: hooks.callHook.bind(hooks),
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
        runtimeConfig: {} as Record<string, unknown>,
        ui: {},
        vite: {},
        nardukCore: {
          app: false,
          coreModules: false,
          image: false,
          server: false,
          csrf: { exemptPaths: [WEBHOOK_PATH] },
          security: {
            headers: { enabled: true, allow: { script: [APP_SCRIPT_ORIGIN] } },
          },
        } as NardukCoreModuleOptions,
      },
    }
    function setupSecurityHeaders() {
      expect(resolveSecurityHeaders).toHaveBeenCalledTimes(1)
      return resolveSecurityHeaders.mock.calls[0]?.[0]
    }
    function nuxtSecurityScriptSrc() {
      const call = installModule.mock.calls.find((entry) => entry[0] === 'nuxt-security')
      expect(call).toBeDefined()
      return (call?.[1] as { headers: { contentSecurityPolicy: { 'script-src': string[] } } })
        .headers.contentSecurityPolicy['script-src']
    }
    return {
      mod,
      nuxt,
      cspHookCalls: () => cspHookCalls,
      setupSecurityHeaders,
      nuxtSecurityScriptSrc,
    }
  }

  it('reaches nuxt-security script-src with a contributed origin', async () => {
    const entry = await loadRealEntry()
    entry.nuxt.hook(CSP_HOOK, (allow: MutableSecurityHeadersAllowlist) => {
      allow.script.push(WIDGETS_ORIGIN)
    })

    await entry.mod({}, entry.nuxt)

    expect(entry.nuxtSecurityScriptSrc()).toEqual(
      expect.arrayContaining([APP_SCRIPT_ORIGIN, WIDGETS_ORIGIN]),
    )
    expect(entry.setupSecurityHeaders()).toEqual({
      enabled: true,
      allow: { script: [WIDGETS_ORIGIN, APP_SCRIPT_ORIGIN] },
    })
    await expect(entry.nuxt.callHook('modules:done')).resolves.toBeUndefined()
  })

  it('hands setup the app arrays exactly once when nothing is contributed', async () => {
    const entry = await loadRealEntry()

    await entry.mod(undefined, entry.nuxt)

    expect(entry.nuxt.options.runtimeConfig.nardukCsrf).toEqual({ exemptPaths: [WEBHOOK_PATH] })
    expect(entry.setupSecurityHeaders()).toEqual({
      enabled: true,
      allow: { script: [APP_SCRIPT_ORIGIN] },
    })
  })

  it('keeps inline arrays exact alongside a contribution', async () => {
    const entry = await loadRealEntry()
    entry.nuxt.options.nardukCore = {
      ...entry.nuxt.options.nardukCore,
      csrf: { exemptPaths: [] },
      security: { headers: { enabled: true, allow: { script: [] } } },
    }
    entry.nuxt.hook(CSP_HOOK, (allow: MutableSecurityHeadersAllowlist) => {
      allow.script.push(WIDGETS_ORIGIN)
    })

    await entry.mod(
      {
        csrf: { exemptPaths: [WEBHOOK_PATH] },
        security: { headers: { enabled: true, allow: { script: [APP_SCRIPT_ORIGIN] } } },
      },
      entry.nuxt,
    )

    expect(entry.nuxt.options.runtimeConfig.nardukCsrf).toEqual({ exemptPaths: [WEBHOOK_PATH] })
    expect(entry.setupSecurityHeaders()).toEqual({
      enabled: true,
      allow: { script: [APP_SCRIPT_ORIGIN, WIDGETS_ORIGIN] },
    })
  })

  it('keeps a boolean headers switch when a contribution arrives', async () => {
    const entry = await loadRealEntry()
    entry.nuxt.options.nardukCore = {
      ...entry.nuxt.options.nardukCore,
      security: { headers: false },
    }
    entry.nuxt.hook(CSP_HOOK, (allow: MutableSecurityHeadersAllowlist) => {
      allow.script.push(WIDGETS_ORIGIN)
    })

    await entry.mod({}, entry.nuxt)

    expect(entry.setupSecurityHeaders()).toEqual({
      enabled: false,
      allow: { script: [WIDGETS_ORIGIN] },
    })
  })

  it('fires the hook once and registers one modules:done check, skipping a duplicate install', async () => {
    const entry = await loadRealEntry()

    await entry.mod({}, entry.nuxt)
    expect(entry.cspHookCalls()).toBe(1)

    await expect(entry.mod({}, entry.nuxt)).resolves.toBe(false)
    expect(entry.cspHookCalls()).toBe(1)

    await entry.nuxt.callHook('modules:done')
    expect(entry.cspHookCalls()).toBe(2)
  })
})
