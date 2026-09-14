/**
 * useBreadcrumbSchema — typed wrapper around nuxt-schema-org for BreadcrumbList JSON-LD.
 */

import { defineBreadcrumb, useSchemaOrg } from '#imports'

interface BreadcrumbItem {
  name: string
  url: string
}

export function useBreadcrumbSchema(items: BreadcrumbItem[]) {
  useSchemaOrg([
    defineBreadcrumb({
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem' as const,
        position: index + 1,
        name: item.name,
        item: item.url,
      })),
    }),
  ])
}
