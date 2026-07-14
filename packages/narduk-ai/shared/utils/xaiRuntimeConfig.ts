import { z } from 'zod'

/** Empty is valid so apps can use stored model configuration without xAI access. */
export const xaiApiKeySchema = z.string().trim().default('')

export function validateXaiApiKey(value: unknown): string {
  return xaiApiKeySchema.parse(value)
}
