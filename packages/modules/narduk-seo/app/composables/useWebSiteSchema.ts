// useWebSiteSchema — typed wrapper around nuxt-schema-org for WebSite JSON-LD (incl. SearchAction).

import { toValue, useSchemaOrg } from '#imports'

import type { MaybeRefOrGetter } from 'vue'

export interface WebSiteSchemaInput {
  description?: string
  isPartOfUrl?: string
  name?: string
  sameAs?: string[]
  searchActionUrlTemplate?: string
  url?: string
}

export function useWebSiteSchema(input?: MaybeRefOrGetter<WebSiteSchemaInput | undefined>): void {
  const resolved = toValue(input)
  const value: WebSiteSchemaInput = resolved ?? {}
  const { name, url, description, searchActionUrlTemplate, isPartOfUrl, sameAs } = value

  useSchemaOrg([
    {
      '@type': 'WebSite' as const,
      ...(name && { name }),
      ...(url && { url }),
      ...(description && { description }),
      ...(sameAs && sameAs.length > 0 && { sameAs }),
      ...(isPartOfUrl && {
        isPartOf: {
          '@type': 'WebSite' as const,
          url: isPartOfUrl,
        },
      }),
      ...(searchActionUrlTemplate && {
        potentialAction: {
          '@type': 'SearchAction' as const,
          target: {
            '@type': 'EntryPoint' as const,
            urlTemplate: searchActionUrlTemplate,
          },
          'query-input': 'required name=search_term_string',
        },
      }),
    },
  ])
}
