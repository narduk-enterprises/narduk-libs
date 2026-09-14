import { describe, expect, it } from 'vitest'

// Explicit import (not a Nuxt auto-import): tests import the explicit package export directly.
import { validateXaiApiKey, xaiApiKeySchema } from '../shared/utils/xaiRuntimeConfig'

describe('private xAI runtime configuration', () => {
  it('trims valid credentials and allows an intentionally missing key', () => {
    expect(validateXaiApiKey('  xai-key  ')).toBe('xai-key')
    expect(validateXaiApiKey(undefined)).toBe('')
    expect(xaiApiKeySchema.parse('')).toBe('')
  })

  it('rejects non-string runtime configuration values', () => {
    expect(() => validateXaiApiKey(123)).toThrow()
    expect(() => validateXaiApiKey(null)).toThrow()
  })
})
