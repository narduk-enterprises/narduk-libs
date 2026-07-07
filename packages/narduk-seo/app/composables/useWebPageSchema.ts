/**
 * useWebPageSchema — typed wrapper around nuxt-schema-org for WebPage JSON-LD.
 *
 * Inputs accept `MaybeRefOrGetter` so callers can pass plain strings, refs, or
 * getters without losing backward compatibility. Reactive values are resolved
 * via `toValue` at call time.
 *
 * @example
 * ```ts
 * useWebPageSchema({ name: 'About Us', description: 'Our story...' })
 * useWebPageSchema({ name: () => page.value?.title, type: 'AboutPage' })
 * ```
 */

import { defineWebPage, toValue, useSchemaOrg } from '#imports'

import type { MaybeRefOrGetter } from 'vue'

type WebPageType =
  | 'WebPage'
  | 'AboutPage'
  | 'ContactPage'
  | 'CollectionPage'
  | 'FAQPage'
  | 'ItemPage'
  | 'SearchResultsPage'

interface WebPageOptions {
  description?: MaybeRefOrGetter<string | undefined>
  name?: MaybeRefOrGetter<string | undefined>
  type?: WebPageType
}

export function useWebPageSchema(options: WebPageOptions = {}) {
  const { name, description, type = 'WebPage' } = options
  const resolvedName = toValue(name)
  const resolvedDescription = toValue(description)

  useSchemaOrg([
    defineWebPage({
      '@type': type,
      name: resolvedName,
      description: resolvedDescription,
    }),
  ])
}
