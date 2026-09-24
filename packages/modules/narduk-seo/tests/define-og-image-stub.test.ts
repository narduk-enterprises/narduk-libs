import { describe, expect, it } from 'vitest'

import { defineOgImage } from '../shared/defineOgImageStub'

describe('defineOgImage stub (narduk-libs#170)', () => {
  it('is a no-op so #imports still resolves when the peer is omitted', () => {
    expect(defineOgImage('Default', { title: 'Example' }, { alt: 'Example' })).toBeUndefined()
  })
})
