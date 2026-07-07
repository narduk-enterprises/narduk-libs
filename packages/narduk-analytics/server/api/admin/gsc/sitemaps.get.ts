import { resolveGscSiteUrl } from '#narduk-analytics-server/utils/siteConfig'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const config = useRuntimeConfig(event)
  const siteUrl = resolveGscSiteUrl(config, event)

  if (!siteUrl) {
    throw createError({ statusCode: 500, statusMessage: 'GSC_SITE_URL or SITE_URL not configured' })
  }

  interface RawSitemapContent {
    indexed?: string | number
    submitted?: string | number
    type: string
  }

  interface RawSitemap {
    contents?: RawSitemapContent[]
    errors?: number
    isPending: boolean
    isSitemapsIndex: boolean
    lastDownloaded: string
    lastSubmitted: string
    path: string
    warnings?: number
  }

  try {
    const data = await googleApiFetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
      GSC_SCOPES,
      {},
      event,
    )

    const rawSitemaps = (data as { sitemap?: RawSitemap[] }).sitemap ?? []
    const sitemaps = rawSitemaps.map((sitemap) => ({
      path: sitemap.path,
      lastSubmitted: sitemap.lastSubmitted,
      lastDownloaded: sitemap.lastDownloaded,
      isPending: sitemap.isPending,
      isSitemapsIndex: sitemap.isSitemapsIndex,
      warnings: sitemap.warnings ?? 0,
      errors: sitemap.errors ?? 0,
      contents: (sitemap.contents ?? []).map((content) => ({
        type: content.type,
        submitted: content.submitted ? Number(content.submitted) : 0,
        indexed: content.indexed ? Number(content.indexed) : 0,
      })),
    }))

    return {
      siteUrl,
      sitemaps,
    }
  } catch (error: unknown) {
    const err = error as { message?: string; statusCode?: number; statusMessage?: string }
    throw createError({
      statusCode: err.statusCode ?? 500,
      statusMessage: `GSC Sitemaps Error: ${err.statusMessage ?? err.message}`,
    })
  }
})
