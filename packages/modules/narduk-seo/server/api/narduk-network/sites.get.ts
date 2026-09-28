import {
  resolveNardukCatalogBaseUrl,
  resolveNardukNetworkDirectory,
  resolveNardukNetworkDirectoryUrl,
} from '#narduk-seo-server/utils/nardukNetworkDirectory'

// The directory is a footer nicety: a slow endpoint must not hold the request
// open. A timeout rejects the fetch and lands in the catch below, which
// renders the directory empty exactly as any other upstream failure does.
const NETWORK_DIRECTORY_TIMEOUT_MS = 5_000

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const publicCatalogBaseUrl = runtimeConfig.public.publicCatalogBaseUrl
  const catalogUrl = resolveNardukCatalogBaseUrl(
    typeof publicCatalogBaseUrl === 'string' ? publicCatalogBaseUrl : undefined,
  )
  const nardukNetworkDirectoryUrl = runtimeConfig.public.nardukNetworkDirectoryUrl
  const directoryUrl = resolveNardukNetworkDirectoryUrl(
    typeof nardukNetworkDirectoryUrl === 'string' ? nardukNetworkDirectoryUrl : undefined,
  )
  const emptyDirectory = {
    ok: false,
    configured: directoryUrl !== null,
    catalogUrl,
    directoryUrl,
    updatedAt: null,
    sites: [],
  }

  // Unconfigured is the default. No endpoint means no outbound subrequest at
  // all — the directory just renders empty. See resolveNardukNetworkDirectoryUrl.
  if (!directoryUrl) return emptyDirectory

  const publicAppUrl = runtimeConfig.public.appUrl
  const currentAppUrl =
    (typeof publicAppUrl === 'string' && publicAppUrl) || getRequestURL(event).origin

  try {
    const response = await fetch(directoryUrl, {
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(NETWORK_DIRECTORY_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw createError({
        statusCode: response.status,
        statusMessage: `Network directory returned ${response.status}`,
      })
    }

    const payload = await response.json()
    const directory = resolveNardukNetworkDirectory(payload, {
      currentAppUrl,
    })

    return {
      ok: true,
      configured: true,
      catalogUrl,
      directoryUrl,
      ...directory,
    }
  } catch {
    return emptyDirectory
  }
})
