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
})
