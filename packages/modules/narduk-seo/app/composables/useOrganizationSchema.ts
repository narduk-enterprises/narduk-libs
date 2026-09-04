// useOrganizationSchema — typed wrapper around nuxt-schema-org for Organization JSON-LD.

import { toValue, useSchemaOrg } from '#imports'

import type { MaybeRefOrGetter } from 'vue'

export interface OrganizationSchemaInput {
  description?: string
  logo?: string
  name?: string
  sameAs?: string[]
  url?: string
}

export function useOrganizationSchema(
  input?: MaybeRefOrGetter<OrganizationSchemaInput | undefined>,
): void {
  const value = toValue(input)
  if (!value) {
    useSchemaOrg([])
    return
  }

  const canEmitOrganization =
    (value.name?.trim().length ?? 0) > 0 ||
    (value.url?.trim().length ?? 0) > 0 ||
    (value.logo?.trim().length ?? 0) > 0 ||
    (value.description?.trim().length ?? 0) > 0 ||
    (value.sameAs?.length ?? 0) > 0
  if (!canEmitOrganization) {
    useSchemaOrg([])
    return
  }

  const node = {
    '@type': 'Organization' as const,
    ...(value.name && { name: value.name }),
    ...(value.url && { url: value.url }),
    ...(value.logo && { logo: value.logo }),
    ...(value.description && { description: value.description }),
    ...(value.sameAs && value.sameAs.length > 0 && { sameAs: value.sameAs }),
  }

  useSchemaOrg([node])
}
