// useItemListSchema — typed wrapper around nuxt-schema-org for ItemList JSON-LD.

import { toValue, useSchemaOrg } from '#imports'

import type { MaybeRefOrGetter } from 'vue'

export interface ItemListEntry {
  name: string
  position?: number
  url: string
}

export interface ItemListSchemaOptions {
  description?: string
  name?: string
}

export function useItemListSchema(
  items: MaybeRefOrGetter<ItemListEntry[]>,
  options: ItemListSchemaOptions = {},
): void {
  const resolved = toValue(items)
  if (!Array.isArray(resolved) || resolved.length === 0) return

  const itemListElement = resolved.map((entry, index) => ({
    '@type': 'ListItem' as const,
    position: entry.position ?? index + 1,
    name: entry.name,
    url: entry.url,
  }))

  useSchemaOrg([
    {
      '@type': 'ItemList' as const,
      ...(options.name && { name: options.name }),
      ...(options.description && { description: options.description }),
      numberOfItems: itemListElement.length,
      itemListElement,
    },
  ])
}
