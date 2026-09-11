import { afterEach, describe, expect, it, vi } from 'vitest'

import { APP_SETTINGS_PROFILE_DEPRECATION_MESSAGE } from '../runtime/app/components/shared/appSettingsProfileDeprecation'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

async function load() {
  return import('../runtime/app/components/shared/appSettingsProfileDeprecation')
}

describe('AppSettingsProfile deprecation warning', () => {
  it('warns once in development and points at NeSettingsPage', async () => {
    const { warnAppSettingsProfileDeprecated } = await load()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnAppSettingsProfileDeprecated(true)
    warnAppSettingsProfileDeprecated(true)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(APP_SETTINGS_PROFILE_DEPRECATION_MESSAGE)
    expect(APP_SETTINGS_PROFILE_DEPRECATION_MESSAGE).toContain('NeSettingsPage')
  })

  it('is silent outside development', async () => {
    const { warnAppSettingsProfileDeprecated } = await load()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnAppSettingsProfileDeprecated(false)

    expect(warn).not.toHaveBeenCalled()
  })

  it('flags narduk-shell as pre-1.0 so a stable-consumer migration decision is informed', () => {
    // narduk-shell publishes 0.0.0 plus pending `minor` changesets (this one
    // included) while narduk-core is stable 1.x. Sending a 1.x consumer to a
    // pre-1.0 replacement, with a hard "removed in the next major" attached,
    // is a real migration cost the message must not hide. Same rationale as
    // AppConfirmModal's deprecation message (narduk-libs#282).
    expect(APP_SETTINGS_PROFILE_DEPRECATION_MESSAGE).toContain('pre-1.0')
  })
})

describe('AppSettingsProfile deprecation warning under SSR-style invocation (narduk-libs#282)', () => {
  // AppSettingsProfile's `<script setup>` calls `warnAppSettingsProfileDeprecated()`
  // unconditionally at the top level, with no `import.meta.server` guard, so
  // it runs during SSR just as it does on the client. What matters for SSR is
  // how the module-scope `warned` flag behaves across repeated invocations
  // that stand in for repeated requests hitting one running server.
  it('warns once across many SSR renders sharing one persistent server process', async () => {
    const { warnAppSettingsProfileDeprecated } = await load()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Three renderToString-style invocations against one module instance --
    // the normal shape of a long-lived Node/Nitro server process, where the
    // module graph loads once and is reused for every request it serves.
    warnAppSettingsProfileDeprecated(true)
    warnAppSettingsProfileDeprecated(true)
    warnAppSettingsProfileDeprecated(true)

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('documents that a fresh module registry per request would re-warn every request', async () => {
    // Residual risk named in the narduk-libs#282 review: a deployment shape
    // that gives each request a fresh module registry (rather than reusing
    // one warm instance, as Cloudflare Workers isolates and a persistent
    // Node/Nitro server both do) would re-run this module's top-level
    // `let warned = false` on every request, so the "once" guard is
    // per-registry-instance, not truly global. `vi.resetModules()` plus a
    // fresh dynamic import stands in for that fresh registry.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const firstRequest = await load()
    firstRequest.warnAppSettingsProfileDeprecated(true)

    vi.resetModules()
    const secondRequest = await load()
    secondRequest.warnAppSettingsProfileDeprecated(true)

    expect(warn).toHaveBeenCalledTimes(2)
  })
})
