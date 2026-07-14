export type ContextTrust = 'trusted' | 'reference' | 'untrusted'

export interface AiRequestContext {
  bindings?: unknown
  db?: unknown
  requestId: string
  tenantId?: string
  userId?: string
}

export interface AiContextChunk {
  data: unknown
  format: 'json' | 'text'
  id: string
  maxChars?: number
  retentionPriority: number
  trust: ContextTrust
}

export interface AiContextProvider {
  getCacheConfig?: (
    ctx: AiRequestContext,
  ) => { key: string; ttlSec: number } | null | Promise<{ key: string; ttlSec: number } | null>
  id: string
  provide: (ctx: AiRequestContext) => Promise<AiContextChunk | null>
}

export interface ProviderSelection {
  id: string
  required?: boolean
}

export interface InlineProviderOverride extends ProviderSelection, AiContextProvider {}

export interface ProviderOverrides {
  add?: InlineProviderOverride[]
  remove?: string[]
}

export interface PromptDefinition {
  contextPlacement: 'manual' | 'append'
  defaultProviders: ProviderSelection[]
  name: string
  outputSchema?: Record<string, unknown>
  template: string
}

export interface AiContextCacheAdapter {
  get: (key: string) => Promise<AiContextChunk | null>
  set: (key: string, chunk: AiContextChunk, ttlSec: number) => Promise<void>
}
