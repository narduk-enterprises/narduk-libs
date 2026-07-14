import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  defineAdminMutation: vi.fn(),
  defineAdminQuery: vi.fn(),
  getStoredChatModel: vi.fn(),
  resolveStoredChatModel: vi.fn(),
  setStoredChatModel: vi.fn(),
  withValidatedBody: vi.fn(),
  useRuntimeConfig: vi.fn(),
}))

vi.mock('@narduk-enterprises/narduk-core/server/utils/mutation', () => ({
  defineAdminMutation: mocks.defineAdminMutation,
  defineAdminQuery: mocks.defineAdminQuery,
  withValidatedBody: mocks.withValidatedBody,
}))

vi.mock('@narduk-enterprises/narduk-core/server/utils/rateLimit', () => ({
  RATE_LIMIT_POLICIES: {
    adminAiModel: { namespace: 'admin-ai-model' },
    adminSystemPrompts: { namespace: 'admin-system-prompts' },
  },
}))

vi.mock('@narduk-enterprises/narduk-core/server/utils/database', () => ({
  executeDatabaseQuery: vi.fn(),
  getDatabaseRows: vi.fn(),
}))

vi.mock('#server/utils/chatModelConfig', () => ({
  getStoredChatModel: mocks.getStoredChatModel,
  resolveStoredChatModel: mocks.resolveStoredChatModel,
  setStoredChatModel: mocks.setStoredChatModel,
}))

vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: mocks.useRuntimeConfig }))

describe('AI admin route contracts', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.defineAdminQuery.mockImplementation((_options, handler) => handler)
    mocks.defineAdminMutation.mockImplementation((options, handler) => {
      return async (event: { body?: unknown }) =>
        handler({ event, body: await options.parseBody(event), admin: { id: 'admin' } })
    })
    mocks.withValidatedBody.mockImplementation(
      (validate: (value: unknown) => unknown) => async (event: { body?: unknown }) =>
        validate(event.body),
    )
    mocks.useRuntimeConfig.mockReturnValue({ xaiApiKey: 'xai-key' })
  })

  it('authenticates model reads through the admin query wrapper and uses private config', async () => {
    mocks.resolveStoredChatModel.mockResolvedValue('grok-4')
    const handler = (await import('../server/api/admin/ai/model.get')).default as (
      event: unknown,
    ) => Promise<{ currentModel: string }>

    await expect(handler({ event: {} })).resolves.toEqual({ currentModel: 'grok-4' })
    expect(mocks.defineAdminQuery).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimit: { namespace: 'admin-ai-model' } }),
      expect.any(Function),
    )
    expect(mocks.resolveStoredChatModel).toHaveBeenCalledWith({}, 'xai-key')
  })

  it('validates model writes before mutating stored state', async () => {
    mocks.setStoredChatModel.mockResolvedValue('grok-4')
    const handler = (await import('../server/api/admin/ai/model.put')).default as (event: {
      body: unknown
    }) => Promise<unknown>

    await expect(handler({ body: { model: 'grok-4' } })).resolves.toEqual({
      success: true,
      model: 'grok-4',
    })
    expect(mocks.setStoredChatModel).toHaveBeenCalledWith({ body: { model: 'grok-4' } }, 'grok-4')
    await expect(handler({ body: { model: '' } })).rejects.toThrow()
  })

  it('applies the same admin and validation wrappers to prompt writes', async () => {
    vi.doMock('#server/utils/aiDatabase', () => ({
      getAiSystemPromptsTable: vi.fn(),
      useAiDatabase: vi.fn(),
    }))
    const handler = (await import('../server/api/admin/system-prompts/index.put')).default
    expect(handler).toBeTypeOf('function')
    expect(mocks.defineAdminMutation).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimit: { namespace: 'admin-system-prompts' } }),
      expect.any(Function),
    )
    expect(mocks.withValidatedBody).toHaveBeenCalledWith(expect.any(Function))
  })
})
