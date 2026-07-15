export interface XaiModelCatalog {
  chatModels: string[]
  preferredChatModel: string | null
}

export const PREFERRED_CHAT_MODELS = [
  'grok-4-1-fast-non-reasoning',
  'grok-3-mini',
  'grok-4',
  'grok-4.20-beta-latest-non-reasoning',
]

export function pickPreferredModel(
  availableModels: string[],
  preferredModels: string[] = PREFERRED_CHAT_MODELS,
): string | null {
  for (const model of preferredModels) {
    if (availableModels.includes(model)) {
      return model
    }
  }

  return availableModels[0] ?? null
}

export function buildXaiModelCatalog(modelIds: string[]): XaiModelCatalog {
  const sorted = [...modelIds].sort()
  const chatModels = sorted.filter((id) => {
    const normalized = id.toLowerCase()
    return (
      !normalized.includes('imagine') &&
      !normalized.includes('image') &&
      !normalized.includes('video')
    )
  })

  return {
    chatModels,
    preferredChatModel: pickPreferredModel(chatModels),
  }
}
