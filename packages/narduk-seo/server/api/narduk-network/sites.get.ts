import {
  NARDUK_DEFAULT_CATALOG_BASE_URL,
  resolveNardukCatalogBaseUrl,
  resolveNardukNetworkDirectory,
  resolveNardukNetworkDirectoryUrl,
} from '#narduk-seo-server/utils/nardukNetworkDirectory'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const catalogBaseUrl = resolveNardukCatalogBaseUrl(
    runtimeConfig.public.publicCatalogBaseUrl || NARDUK_DEFAULT_CATALOG_BASE_URL,
  )
  const directoryUrl = resolveNardukNetworkDirectoryUrl(catalogBaseUrl)
  const currentAppUrl = runtimeConfig.public.appUrl || getRequestURL(event).origin

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
      catalogUrl: catalogBaseUrl,
      directoryUrl,
      ...directory,
    }
  } catch {
    return {
      ok: false,
      catalogUrl: catalogBaseUrl,
      directoryUrl,
      updatedAt: null,
      sites: [],
    }
  }
})
