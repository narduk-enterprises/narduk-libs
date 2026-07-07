import { useFetch, useRuntimeConfig } from '#imports'

export interface NardukNetworkDirectoryResponse {
  catalogUrl: string
  directoryUrl: string
  ok: boolean
  sites: NardukNetworkDirectorySite[]
  updatedAt: null | string
}

export interface NardukNetworkDirectorySite {
  description: string
  name: string
  slug: string
  url: string
}

export function useNardukNetworkDirectory() {
  const runtimeConfig = useRuntimeConfig()
  const catalogUrl = runtimeConfig.public.publicCatalogBaseUrl

  return useFetch<NardukNetworkDirectoryResponse>('/api/narduk-network/sites', {
    default: () => ({
      ok: false,
      catalogUrl,
      directoryUrl: '',
      updatedAt: null,
      sites: [],
    }),
  })
}
