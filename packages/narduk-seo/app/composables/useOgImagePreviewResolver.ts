export function useOgImagePreviewResolver() {
  const appFetch = useAppFetch()

  // Accept concrete query shapes (e.g. OgPreviewResolveQuery) — they are not assignable to `Record<string, …>` without an index signature.
  return async (query: object) => {
    const response = await appFetch<{ path: string }>('/api/og-image/resolve', {
      query: query as Record<string, string | undefined>,
    })

    return response.path
  }
}
