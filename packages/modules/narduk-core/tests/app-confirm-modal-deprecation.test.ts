import { afterEach, describe, expect, it, vi } from 'vitest'

import { APP_CONFIRM_MODAL_DEPRECATION_MESSAGE } from '../runtime/app/components/shared/appConfirmModalDeprecation'

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

async function load() {
  return import('../runtime/app/components/shared/appConfirmModalDeprecation')
}

describe('AppConfirmModal deprecation warning', () => {
  it('warns once in development and points at NeConfirmDialog', async () => {
    const { warnAppConfirmModalDeprecated } = await load()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnAppConfirmModalDeprecated(true)
    warnAppConfirmModalDeprecated(true)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(APP_CONFIRM_MODAL_DEPRECATION_MESSAGE)
    expect(APP_CONFIRM_MODAL_DEPRECATION_MESSAGE).toContain('NeConfirmDialog')
    expect(APP_CONFIRM_MODAL_DEPRECATION_MESSAGE).toContain('useConfirm()')
  })

  it('is silent outside development', async () => {
    const { warnAppConfirmModalDeprecated } = await load()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnAppConfirmModalDeprecated(false)

    expect(warn).not.toHaveBeenCalled()
  })

  it('flags narduk-shell as pre-1.0 so a stable-consumer migration decision is informed', () => {
    // narduk-shell publishes 0.1.0 in this same release batch
    // (packages/design/narduk-shell/package.json is 0.0.0 plus seven pending
    // `minor` changesets) while narduk-core is stable 1.x. Sending a 1.x
    // consumer to a pre-1.0 replacement, with a hard "removed in the next
    // major" attached, is a real migration cost the message must not hide.
    expect(APP_CONFIRM_MODAL_DEPRECATION_MESSAGE).toContain('pre-1.0')
  })
})

describe('AppConfirmModal deprecation warning under SSR-style invocation (narduk-libs#282)', () => {
  // `<AppConfirmModal>`'s `<script setup>` calls `warnAppConfirmModalDeprecated()`
  // unconditionally at the top level, with no `import.meta.server` guard, so
  // it runs during SSR just as it does on the client. What matters for SSR is
  // how the module-scope `warned` flag behaves across repeated invocations
  // that stand in for repeated requests hitting one running server.
  it('warns once across many SSR renders sharing one persistent server process', async () => {
    const { warnAppConfirmModalDeprecated } = await load()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Three renderToString-style invocations against one module instance --
    // the normal shape of a long-lived Node/Nitro server process, where the
    // module graph loads once and is reused for every request it serves.
    warnAppConfirmModalDeprecated(true)
    warnAppConfirmModalDeprecated(true)
    warnAppConfirmModalDeprecated(true)

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
    firstRequest.warnAppConfirmModalDeprecated(true)

    vi.resetModules()
    const secondRequest = await load()
    secondRequest.warnAppConfirmModalDeprecated(true)

    expect(warn).toHaveBeenCalledTimes(2)
  })
})
