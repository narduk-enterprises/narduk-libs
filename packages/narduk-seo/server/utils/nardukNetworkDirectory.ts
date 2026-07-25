import { z } from 'zod'

const rawNardukNetworkSiteSchema = z
  .object({
    slug: z.string().trim().min(1),
    name: z.string().trim().min(1),
    url: z.string().trim().url(),
    description: z.string().trim().min(1),
    public: z.boolean().optional(),
    indexable: z.boolean().optional(),
  })
  .passthrough()

const rawNardukNetworkDirectorySchema = z
  .object({
    updatedAt: z.string().trim().min(1).optional(),
    sites: z.array(z.unknown()).default([]),
  })
  .passthrough()

interface NardukNetworkSite {
  description: string
  name: string
  slug: string
  url: string
}

interface NardukNetworkDirectory {
  sites: NardukNetworkSite[]
  updatedAt: null | string
}

interface ResolveNardukNetworkDirectoryOptions {
  currentAppUrl?: null | string
}

function normalizeHttpsUrl(value: string): null | string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null

    url.hash = ''
    url.search = ''
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'

    if (url.pathname === '/') {
      return url.origin
    }

    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

function normalizeOrigin(value: null | string | undefined): null | string {
  if (!value) return null

  try {
    return new URL(value).origin.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Normalizes an optional catalog-hub base URL. There is no built-in default:
 * this package must not pin every downstream app to one hostname.
 */
export function resolveNardukCatalogBaseUrl(value?: null | string): null | string {
  const trimmed = value?.trim()
  if (!trimmed) return null

  return normalizeHttpsUrl(trimmed)
}

/**
 * Resolves the injectable network-directory endpoint.
 *
 * The value is an absolute HTTPS URL supplied by the consuming app
 * (`nardukSeo.networkDirectoryUrl`, or `NUXT_PUBLIC_NARDUK_NETWORK_DIRECTORY_URL`
 * at runtime). **There is deliberately no default.** When it is unset this
 * returns `null` and the directory feature disables itself: the server route
 * performs no outbound fetch and `/narduk-network` renders an empty directory.
 *
 * Failing quiet is correct here — the directory is a marketing cross-link
 * surface, not a gate — and it keeps a published library from generating
 * traffic against a hostname its consumers never chose.
 */
export function resolveNardukNetworkDirectoryUrl(directoryUrl?: null | string): null | string {
  const trimmed = directoryUrl?.trim()
  if (!trimmed) return null

  return normalizeHttpsUrl(trimmed)
}

export function resolveNardukNetworkDirectory(
  payload: unknown,
  options: ResolveNardukNetworkDirectoryOptions = {},
): NardukNetworkDirectory {
  const parsed = rawNardukNetworkDirectorySchema.parse(payload)
  const currentOrigin = normalizeOrigin(options.currentAppUrl)
  const seenUrls = new Set<string>()
  const sites: NardukNetworkSite[] = []

  for (const rawSite of parsed.sites) {
    const site = rawNardukNetworkSiteSchema.safeParse(rawSite)
    if (!site.success) continue

    const siteData = site.data
    if (siteData.public === false || siteData.indexable === false) continue

    const normalizedUrl = normalizeHttpsUrl(siteData.url)
    if (!normalizedUrl) continue

    const siteOrigin = normalizeOrigin(normalizedUrl)
    if (siteOrigin && currentOrigin && siteOrigin === currentOrigin) continue

    const dedupeKey = normalizedUrl.toLowerCase()
    if (seenUrls.has(dedupeKey)) continue
    seenUrls.add(dedupeKey)

    sites.push({
      slug: siteData.slug,
      name: siteData.name,
      description: siteData.description,
      url: normalizedUrl,
    })
  }

  return {
    updatedAt: parsed.updatedAt ?? null,
    sites,
  }
}
