import { describe, expect, it } from 'vitest'

import { sanitizeFields } from '../src/index.js'

describe('ponytail-5 #7 compound sensitive key names', () => {
  it.each(['userEmail', 'systemPrompt', 'homeAddress'])('redacts %s', (key) => {
    const out = JSON.stringify(sanitizeFields({ [key]: 'a@b.com do-not-log 1 Main St' }))
    expect(out).not.toContain('do-not-log')
  })

  it('keeps token counts visible', () => {
    expect(sanitizeFields({ promptTokens: 12 })).toEqual({ promptTokens: 12 })
  })
})
