import { expect } from 'vitest'

import { DevicesError } from '../../server/utils/devices-error'

/**
 * Resolve to the `DevicesError` a call rejects with, so every test asserts the
 * code in its own body rather than inside a helper.
 */
export async function errorOf(promise: Promise<unknown>): Promise<DevicesError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(DevicesError)
    return error as DevicesError
  }
  throw new Error('expected the call to reject')
}

export async function codeOf(promise: Promise<unknown>): Promise<string> {
  return (await errorOf(promise)).code
}
