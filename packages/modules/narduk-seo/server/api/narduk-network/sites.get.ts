import {
  resolveNardukCatalogBaseUrl,
  resolveNardukNetworkDirectory,
  resolveNardukNetworkDirectoryUrl,
} from '#narduk-seo-server/utils/nardukNetworkDirectory'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const catalogUrl = resolveNardukCatalogBaseUrl(runtimeConfig.public.publicCatalogBaseUrl)
  const directoryUrl = resolveNardukNetworkDirectoryUrl(
    runtimeConfig.public.nardukNetworkDirectoryUrl,
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
