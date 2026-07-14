import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ADMIN_CHAT_MODEL_KV_KEY,
  ADMIN_CHAT_MODEL_TTL_SECONDS,
  DEFAULT_ADMIN_CHAT_MODEL,
  getStoredChatModel,
  resolveStoredChatModel,
  setStoredChatModel,
} from '../server/utils/chatModelConfig'

const mocks = vi.hoisted(() => ({
  grokListModels: vi.fn(),
  kvGet: vi.fn(),
  kvSet: vi.fn(),
}))

vi.mock('@narduk-enterprises/narduk-core/server/utils/kv', () => ({
  kvGet: mocks.kvGet,
  kvSet: mocks.kvSet,
}))

vi.mock('../server/utils/xai', () => ({
  grokListModels: mocks.grokListModels,
}))

describe('stored chat model behavior', () => {
  const event = {} as never

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the default model and persists overrides in KV', async () => {
    mocks.kvGet.mockResolvedValue(null)
    mocks.kvSet.mockResolvedValue()

    await expect(getStoredChatModel(event)).resolves.toBe(DEFAULT_ADMIN_CHAT_MODEL)
    await expect(setStoredChatModel(event, 'grok-4')).resolves.toBe('grok-4')
    expect(mocks.kvSet).toHaveBeenCalledWith(
      event,
      ADMIN_CHAT_MODEL_KV_KEY,
      { value: 'grok-4' },
      ADMIN_CHAT_MODEL_TTL_SECONDS,
    )
  })

  it('replaces unavailable stored models with the preferred live chat model', async () => {
    mocks.kvGet.mockResolvedValue({ value: 'grok-missing' })
    mocks.grokListModels.mockResolvedValue([
      { id: 'grok-4-1-fast-non-reasoning', object: 'model' },
      { id: 'grok-3-mini', object: 'model' },
      { id: 'grok-image', object: 'model' },
    ])

    await expect(resolveStoredChatModel(event, 'xai-key')).resolves.toBe(
      'grok-4-1-fast-non-reasoning',
    )
  })

  it('preserves a stored model when the live catalog still contains it', async () => {
    mocks.kvGet.mockResolvedValue({ value: 'custom-chat' })
    mocks.grokListModels.mockResolvedValue([{ id: 'custom-chat', object: 'model' }])

    await expect(resolveStoredChatModel(event, 'xai-key')).resolves.toBe('custom-chat')
  })
})
