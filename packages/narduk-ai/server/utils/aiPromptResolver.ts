import { escapeXmlAttribute, escapeXmlText } from './aiXmlEscape'

import type {
  AiContextCacheAdapter,
  AiContextChunk,
  AiContextProvider,
  AiRequestContext,
  InlineProviderOverride,
  PromptDefinition,
  ProviderOverrides,
  ProviderSelection,
} from './aiContracts'

export interface ResolvedPromptChunk extends AiContextChunk {
  cacheHit: boolean
  cacheKey: string | null
  charCount: number
  providerId: string
  required: boolean
  serialized: string
}

export interface ResolvedPromptContext {
  charBudget: number | null
  chunks: ResolvedPromptChunk[]
  contextBlock: string
  droppedProviderIds: string[]
  orderedProviderIds: string[]
  outputSchemaBlock: string
  renderedPrompt: string
  usedChars: number
}

export interface ResolvePromptContextOptions {
  cache?: AiContextCacheAdapter | null
  charBudget?: number | null
  manualContextPlaceholder?: string
  manualOutputSchemaPlaceholder?: string
  prompt: PromptDefinition
  providerOverrides?: ProviderOverrides
  providerRegistry: Record<string, AiContextProvider> | Map<string, AiContextProvider>
  requestContext: AiRequestContext
}

const DEFAULT_MANUAL_CONTEXT_PLACEHOLDER = '{{context}}'
const DEFAULT_MANUAL_OUTPUT_SCHEMA_PLACEHOLDER = '{{output_schema}}'
const CONTEXT_SEPARATOR = '\n\n'

function getRegistryProvider(
  registry: ResolvePromptContextOptions['providerRegistry'],
  id: string,
): AiContextProvider | null {
  if (registry instanceof Map) {
    return registry.get(id) ?? null
  }

  if (!Object.hasOwn(registry, id)) {
    return null
  }

  return registry[id] ?? null
}

function createOutputSchemaBlock(prompt: PromptDefinition): string {
  if (!prompt.outputSchema) return ''

  return [
    '<output-schema format="json-schema">',
    escapeXmlText(JSON.stringify(prompt.outputSchema, null, 2)),
    '</output-schema>',
  ].join('\n')
}

function applyMaxChars(value: string, maxChars: number | undefined): string {
  if (maxChars == null || value.length <= maxChars) {
    return value
  }
  if (maxChars <= 0) {
    return ''
  }

  const suffix = '\n...[truncated]'
  if (maxChars <= suffix.length) {
    return value.slice(0, maxChars)
  }
  return `${value.slice(0, maxChars - suffix.length)}${suffix}`
}

function serializeChunk(chunk: AiContextChunk): string {
  const raw =
    chunk.format === 'json' ? JSON.stringify(chunk.data ?? null, null, 2) : String(chunk.data ?? '')
  const bounded = applyMaxChars(raw, chunk.maxChars)
  const escapedId = escapeXmlAttribute(String(chunk.id))
  const escapedTrust = escapeXmlAttribute(String(chunk.trust))
  const escapedFormat = escapeXmlAttribute(String(chunk.format))
  const content = chunk.trust === 'trusted' ? bounded : escapeXmlText(bounded)

  return [
    `<context id="${escapedId}" trust="${escapedTrust}" format="${escapedFormat}">`,
    content,
    '</context>',
  ].join('\n')
}

function resolveProviderSelections(
  prompt: PromptDefinition,
  overrides: ProviderOverrides | undefined,
): Array<ProviderSelection | InlineProviderOverride> {
  const removed = new Set(overrides?.remove ?? [])
  const selections: Array<ProviderSelection | InlineProviderOverride> = prompt.defaultProviders
    .filter((selection) => !removed.has(selection.id))
    .map((selection) => ({ ...selection }))

  for (const added of overrides?.add ?? []) {
    const existingIndex = selections.findIndex((selection) => selection.id === added.id)
    if (existingIndex >= 0) {
      selections.splice(existingIndex, 1)
    }
    selections.push({ ...added })
  }

  return selections
}

function renderPrompt(
  prompt: PromptDefinition,
  contextBlock: string,
  outputSchemaBlock: string,
  manualContextPlaceholder: string,
  manualOutputSchemaPlaceholder: string,
): string {
  if (prompt.contextPlacement === 'manual') {
    const blockedValues = [prompt.template, contextBlock, outputSchemaBlock]
    let contextSentinel = '__NARDUK_CONTEXT_BLOCK__'
    while (blockedValues.some((value) => value.includes(contextSentinel))) {
      contextSentinel = `_${contextSentinel}_`
    }

    let outputSchemaSentinel = '__NARDUK_OUTPUT_SCHEMA_BLOCK__'
    while (blockedValues.some((value) => value.includes(outputSchemaSentinel))) {
      outputSchemaSentinel = `_${outputSchemaSentinel}_`
    }

    return prompt.template
      .replaceAll(manualContextPlaceholder, contextSentinel)
      .replaceAll(manualOutputSchemaPlaceholder, outputSchemaSentinel)
      .replaceAll(contextSentinel, contextBlock)
      .replaceAll(outputSchemaSentinel, outputSchemaBlock)
  }

  const appendedParts = [prompt.template.trimEnd()]
  if (contextBlock) {
    appendedParts.push(contextBlock)
  }
  if (outputSchemaBlock) {
    appendedParts.push(outputSchemaBlock)
  }
  return appendedParts.join(CONTEXT_SEPARATOR)
}

function sortDropCandidates(
  chunks: ResolvedPromptChunk[],
): Array<{ chunk: ResolvedPromptChunk; index: number }> {
  return chunks
    .map((chunk, index) => ({ chunk, index }))
    .filter(({ chunk }) => !chunk.required)
    .sort((left, right) => {
      if (left.chunk.retentionPriority !== right.chunk.retentionPriority) {
        return left.chunk.retentionPriority - right.chunk.retentionPriority
      }
      return right.index - left.index
    })
}

function getContextBlockLength(chunks: ResolvedPromptChunk[]): number {
  if (chunks.length === 0) {
    return 0
  }

  return (
    chunks.reduce((total, chunk) => total + chunk.charCount, 0) +
    CONTEXT_SEPARATOR.length * (chunks.length - 1)
  )
}

function applyCharacterBudget(
  chunks: ResolvedPromptChunk[],
  charBudget: number | null | undefined,
): { droppedProviderIds: string[]; kept: ResolvedPromptChunk[]; usedChars: number } {
  if (charBudget == null) {
    return {
      kept: chunks,
      droppedProviderIds: [],
      usedChars: getContextBlockLength(chunks),
    }
  }

  const normalizedBudget = Math.max(charBudget, 0)
  const kept = [...chunks]
  let usedChars = getContextBlockLength(kept)
  if (usedChars <= normalizedBudget) {
    return { kept, droppedProviderIds: [], usedChars }
  }

  const droppedProviderIds: string[] = []
  for (const candidate of sortDropCandidates(kept)) {
    const index = kept.indexOf(candidate.chunk)
    if (index < 0) continue

    droppedProviderIds.push(kept[index]!.providerId)
    kept.splice(index, 1)
    usedChars = getContextBlockLength(kept)

    if (usedChars <= normalizedBudget) {
      return { kept, droppedProviderIds, usedChars }
    }
  }

  const requiredProviderIds = kept
    .filter((chunk) => chunk.required)
    .map((chunk) => chunk.providerId)
  throw new Error(
    `Character budget exceeded by required context providers: ${requiredProviderIds.join(', ')}`,
  )
}

async function resolveSelectionChunk(
  selection: ProviderSelection | InlineProviderOverride,
  options: ResolvePromptContextOptions,
): Promise<ResolvedPromptChunk | null> {
  const inlineProvider = 'provide' in selection ? selection : null
  const provider = inlineProvider ?? getRegistryProvider(options.providerRegistry, selection.id)
  if (!provider) {
    if (selection.required) {
      throw new Error(`Required AI context provider "${selection.id}" is not registered.`)
    }
    return null
  }

  const cacheConfig = provider.getCacheConfig
    ? await provider.getCacheConfig(options.requestContext)
    : null
  const cachedChunk = cacheConfig && options.cache ? await options.cache.get(cacheConfig.key) : null
  const chunk = cachedChunk ?? (await provider.provide(options.requestContext))
  if (!chunk) {
    if (selection.required) {
      throw new Error(`Required AI context provider "${selection.id}" returned no context.`)
    }
    return null
  }

  if (cacheConfig && options.cache && !cachedChunk) {
    await options.cache.set(cacheConfig.key, chunk, cacheConfig.ttlSec)
  }

  const serialized = serializeChunk(chunk)
  return {
    ...chunk,
    providerId: provider.id,
    required: Boolean(selection.required),
    serialized,
    charCount: serialized.length,
    cacheKey: cacheConfig?.key ?? null,
    cacheHit: Boolean(cachedChunk),
  }
}

export async function resolvePromptContext(
  options: ResolvePromptContextOptions,
): Promise<ResolvedPromptContext> {
  const selections = resolveProviderSelections(options.prompt, options.providerOverrides)
  const resolvedChunks = (
    await Promise.all(selections.map((selection) => resolveSelectionChunk(selection, options)))
  ).filter((chunk): chunk is ResolvedPromptChunk => Boolean(chunk))

  const { kept, droppedProviderIds, usedChars } = applyCharacterBudget(
    resolvedChunks,
    options.charBudget,
  )
  const contextBlock = kept.map((chunk) => chunk.serialized).join(CONTEXT_SEPARATOR)
  const outputSchemaBlock = createOutputSchemaBlock(options.prompt)
  const renderedPrompt = renderPrompt(
    options.prompt,
    contextBlock,
    outputSchemaBlock,
    options.manualContextPlaceholder ?? DEFAULT_MANUAL_CONTEXT_PLACEHOLDER,
    options.manualOutputSchemaPlaceholder ?? DEFAULT_MANUAL_OUTPUT_SCHEMA_PLACEHOLDER,
  )

  return {
    orderedProviderIds: selections.map((selection) => selection.id),
    droppedProviderIds,
    chunks: kept,
    usedChars,
    charBudget: options.charBudget ?? null,
    contextBlock,
    outputSchemaBlock,
    renderedPrompt,
  }
}
