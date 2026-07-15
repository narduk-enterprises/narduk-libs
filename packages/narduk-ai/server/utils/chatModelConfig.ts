import { kvGet, kvSet } from '@narduk-enterprises/narduk-core/server/utils/kv'

import { buildXaiModelCatalog } from '../../app/utils/xaiModels'

import { grokListModels } from './xai'

import type { H3Event } from 'h3'

export const ADMIN_CHAT_MODEL_KV_KEY = 'admin:chatModel'
export const DEFAULT_ADMIN_CHAT_MODEL = 'grok-3-mini'
export const ADMIN_CHAT_MODEL_TTL_SECONDS = 365 * 24 * 60 * 60

export async function getStoredChatModel(event: H3Event): Promise<string> {
  const configModel = await kvGet<{ value?: string }>(event, ADMIN_CHAT_MODEL_KV_KEY)
  return configModel?.value ?? DEFAULT_ADMIN_CHAT_MODEL
}

export async function setStoredChatModel(event: H3Event, model: string): Promise<string> {
  await kvSet(event, ADMIN_CHAT_MODEL_KV_KEY, { value: model }, ADMIN_CHAT_MODEL_TTL_SECONDS)
  return model
}

export async function resolveStoredChatModel(event: H3Event, apiKey: string): Promise<string> {
  const storedModel = await getStoredChatModel(event)
  const catalog = buildXaiModelCatalog((await grokListModels(apiKey)).map((model) => model.id))

  if (catalog.chatModels.includes(storedModel)) {
    return storedModel
  }

  return catalog.preferredChatModel ?? DEFAULT_ADMIN_CHAT_MODEL
}
