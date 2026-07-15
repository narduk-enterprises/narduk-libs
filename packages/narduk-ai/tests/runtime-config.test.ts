import { describe, expect, it } from 'vitest'

// eslint-disable-next-line nuxt-redundant-auto-import/no-redundant-auto-import -- tests import the explicit package export directly.
import { validateXaiApiKey, xaiApiKeySchema } from '../shared/utils/xaiRuntimeConfig'

describe('private xAI runtime configuration', () => {
  it('trims valid credentials and allows an intentionally missing key', () => {
    expect(validateXaiApiKey('  xai-key  ')).toBe('xai-key')
    // eslint-disable-next-line unicorn/no-useless-undefined -- verifies the schema default.
    expect(validateXaiApiKey(undefined)).toBe('')
    expect(xaiApiKeySchema.parse('')).toBe('')
  })

  it('rejects non-string runtime configuration values', () => {
    expect(() => validateXaiApiKey(123)).toThrow()
    expect(() => validateXaiApiKey(null)).toThrow()
  })
})
