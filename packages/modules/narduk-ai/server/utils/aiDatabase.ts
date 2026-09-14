import { systemPrompts as pgSystemPrompts } from '@narduk-enterprises/narduk-core/server/database/pg-schema'
import { systemPrompts as d1SystemPrompts } from '@narduk-enterprises/narduk-core/server/database/schema'
import { useDatabase } from '@narduk-enterprises/narduk-core/server/utils/database'
import { useRuntimeConfig } from 'nitropack/runtime'

import type { H3Event } from 'h3'

/**
 * The system_prompts table is owned by narduk-core in v1. AI imports the
 * explicit core table for each supported backend and does not ship a schema or
 * migration of its own.
 */
export type AiSystemPrompt = typeof d1SystemPrompts.$inferSelect

export function useAiDatabase(event: H3Event) {
  return useDatabase(event)
}

export function getAiSystemPromptsTable(event: H3Event): typeof d1SystemPrompts {
  const config = useRuntimeConfig(event) as { databaseBackend?: unknown }
  if (config.databaseBackend === 'postgres') {
    return pgSystemPrompts as unknown as typeof d1SystemPrompts
  }
  return d1SystemPrompts
}
