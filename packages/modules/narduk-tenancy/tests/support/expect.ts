import { expect } from 'vitest'

import { TenancyError } from '../../server/utils/tenancy-error'

/**
 * Resolve to the `TenancyError.code` a call rejects with, so every test asserts
 * the code in its own body rather than inside a helper.
 */
export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(TenancyError)
    return (error as TenancyError).code
  }
  return 'did-not-reject'
}
