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
})
