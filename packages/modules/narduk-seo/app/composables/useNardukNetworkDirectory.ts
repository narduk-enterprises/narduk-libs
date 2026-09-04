import { useFetch, useRuntimeConfig } from '#imports'

export interface NardukNetworkDirectoryResponse {
  catalogUrl: null | string
  /** False when no directory endpoint is configured — the feature is off. */
  configured: boolean
  directoryUrl: null | string
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
  const configured = Boolean(String(runtimeConfig.public.nardukNetworkDirectoryUrl ?? '').trim())
  const emptyDirectory = (): NardukNetworkDirectoryResponse => ({
    ok: false,
    configured,
    catalogUrl: null,
    directoryUrl: null,
    updatedAt: null,
    sites: [],
  })

  // No configured endpoint means no directory to load — skip the request
  // rather than round-tripping to a route that can only answer "empty".
  return useFetch<NardukNetworkDirectoryResponse>('/api/narduk-network/sites', {
    immediate: configured,
    default: emptyDirectory,
  })
}
