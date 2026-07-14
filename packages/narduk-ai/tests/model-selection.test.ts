import { describe, expect, it } from 'vitest'

// eslint-disable-next-line nuxt-redundant-auto-import/no-redundant-auto-import -- tests import the explicit package export directly.
import { buildXaiModelCatalog, pickPreferredModel } from '../app/utils/xaiModels'

describe('xAI model catalog', () => {
  it('sorts models, removes non-chat models, and selects the preferred live model', () => {
    expect(
      buildXaiModelCatalog(['grok-video', 'grok-3-mini', 'grok-4', 'grok-imagine', 'GROK-IMAGE']),
    ).toEqual({
      chatModels: ['grok-3-mini', 'grok-4'],
      preferredChatModel: 'grok-3-mini',
    })
  })

  it('falls back deterministically when no preferred model is available', () => {
    expect(pickPreferredModel(['z-model', 'a-model'], ['missing'])).toBe('z-model')
    expect(pickPreferredModel([])).toBeNull()
  })
})
