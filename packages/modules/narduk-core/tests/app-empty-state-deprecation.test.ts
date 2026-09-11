import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadDeprecation() {
  vi.resetModules()
  return import('../runtime/app/components/shared/appEmptyStateDeprecation')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppEmptyState deprecation warning (D4)', () => {
  it('points at NeStatePanel once in dev and is silent in production', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { warnAppEmptyStateDeprecated, APP_EMPTY_STATE_DEPRECATION_MESSAGE } =
      await loadDeprecation()

    warnAppEmptyStateDeprecated(false)
    expect(warn).not.toHaveBeenCalled()

    warnAppEmptyStateDeprecated(true)
    warnAppEmptyStateDeprecated(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(APP_EMPTY_STATE_DEPRECATION_MESSAGE)
    expect(APP_EMPTY_STATE_DEPRECATION_MESSAGE).toContain('NeStatePanel')
    expect(APP_EMPTY_STATE_DEPRECATION_MESSAGE).toContain('@narduk-enterprises/narduk-shell')
  })

  it('flags narduk-shell as pre-1.0 so a stable-consumer migration decision is informed', async () => {
    // narduk-shell publishes 0.1.0 in this same release batch
    // (packages/design/narduk-shell/package.json is 0.0.0 plus seven pending
    // `minor` changesets) while narduk-core is stable 1.x. Sending a 1.x
    // consumer to a pre-1.0 replacement, with a hard "removed in the next
    // major" attached, is a real migration cost the message must not hide.
    const { APP_EMPTY_STATE_DEPRECATION_MESSAGE } = await loadDeprecation()

    expect(APP_EMPTY_STATE_DEPRECATION_MESSAGE).toContain('pre-1.0')
  })
})

describe('AppEmptyState deprecation warning under SSR-style invocation (narduk-libs#282)', () => {
  // `<AppEmptyState>`'s `<script setup>` calls `warnAppEmptyStateDeprecated()`
  // unconditionally at the top level, with no `import.meta.server` guard, so
  // it runs during SSR just as it does on the client. What matters for SSR is
  // how the module-scope `warned` flag behaves across repeated invocations
  // that stand in for repeated requests hitting one running server.
  it('warns once across many SSR renders sharing one persistent server process', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { warnAppEmptyStateDeprecated } = await loadDeprecation()

    // Three renderToString-style invocations against one module instance --
    // the normal shape of a long-lived Node/Nitro server process, where the
    // module graph loads once and is reused for every request it serves.
    warnAppEmptyStateDeprecated(true)
    warnAppEmptyStateDeprecated(true)
    warnAppEmptyStateDeprecated(true)

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

    const firstRequest = await loadDeprecation()
    firstRequest.warnAppEmptyStateDeprecated(true)

    vi.resetModules()
    const secondRequest = await loadDeprecation()
    secondRequest.warnAppEmptyStateDeprecated(true)

    expect(warn).toHaveBeenCalledTimes(2)
  })
})
