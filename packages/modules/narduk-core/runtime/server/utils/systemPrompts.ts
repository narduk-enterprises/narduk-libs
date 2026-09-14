import { eq } from 'drizzle-orm'

import { getDatabaseRow, getDatabaseRows, useDatabase } from '#layer/server/utils/database'
import { systemPrompts } from '#narduk-core/schema'

import type { H3Event } from 'h3'

export interface AppSystemPromptConfig {
  content: string
  description: string
}

/**
 * Get a specific system prompt, auto-seeding defaults if not in DB.
 * The calling app must pass a DEFAULT_SYSTEM_PROMPTS map mapping prompt names to content.
 */
export async function getSystemPrompt(
  event: H3Event,
  name: string,
  defaults: Record<string, AppSystemPromptConfig>,
): Promise<string> {
  const db = useDatabase(event)
  const existing = await getDatabaseRow<typeof systemPrompts.$inferSelect>(
    db.select().from(systemPrompts).where(eq(systemPrompts.name, name)),
  )

  if (existing) {
    return existing.content
  }

  // Not found, seed it
  const defaultPrompt = defaults[name]
  if (!defaultPrompt) throw new Error(`Unknown system prompt: ${name}`)

  await db
    .insert(systemPrompts)
    .values({
      name,
      content: defaultPrompt.content,
      description: defaultPrompt.description,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()

  return defaultPrompt.content
}

/**
 * Get all system prompts, ensuring defaults are seeded in D1.
 */
export async function getAllSystemPrompts(
  event: H3Event,
  defaults: Record<string, AppSystemPromptConfig>,
): Promise<Array<{ content: string; description: string; name: string; updatedAt: string }>> {
  const db = useDatabase(event)
  const now = new Date().toISOString()

  // Fetch existing
  const existingRows = (await getDatabaseRows<typeof systemPrompts.$inferSelect>(
    db.select().from(systemPrompts),
  )) as Array<{
    content: string
    description: string
    name: string
    updatedAt: string
  }>
  const existingMap = new Map<string, (typeof existingRows)[number]>(
    existingRows.map((r) => [r.name, r]),
  )

  // Check what's missing
  const missingKeys = Object.keys(defaults).filter((k) => !existingMap.has(k))

  if (missingKeys.length > 0) {
    const toInsert = missingKeys.map((name) => ({
      name,
      content: defaults[name]!.content,
      description: defaults[name]!.description,
      updatedAt: now,
    }))

    await db.insert(systemPrompts).values(toInsert).onConflictDoNothing()

    // Update our map
    for (const item of toInsert) {
      existingMap.set(item.name, item)
    }
  }

  return Array.from(existingMap.values())
}
