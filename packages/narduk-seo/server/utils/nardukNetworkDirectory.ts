import { z } from 'zod'

export const NARDUK_DEFAULT_CATALOG_BASE_URL = 'https://catalog.nard.uk'
export const NARDUK_COMMAND_PUBLIC_CATALOG_URL = 'https://command.nard.uk/api/apps'
export const NARDUK_NETWORK_DIRECTORY_URL = 'https://command.nard.uk/api/network.json'

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

const rawCommandPublicCatalogAppSchema = z
  .object({
    slug: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    primaryUrl: z.string().trim().url().nullable().optional(),
    shortDescription: z.string().trim().min(1).nullable().optional(),
    longDescription: z.string().trim().min(1).nullable().optional(),
  })
  .passthrough()

const rawCommandPublicCatalogGroupSchema = z
  .object({
    apps: z.array(z.unknown()).default([]),
  })
  .passthrough()

const rawCommandPublicCatalogSchema = z
  .object({
    groups: z.array(rawCommandPublicCatalogGroupSchema).default([]),
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

export function resolveNardukCatalogBaseUrl(value: null | string | undefined): string {
  const normalized = normalizeHttpsUrl(value ?? NARDUK_DEFAULT_CATALOG_BASE_URL)
  return normalized ?? NARDUK_DEFAULT_CATALOG_BASE_URL
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

export function resolveNardukNetworkDirectoryFromCommandCatalog(
  payload: unknown,
  options: ResolveNardukNetworkDirectoryOptions = {},
): NardukNetworkDirectory {
  const parsed = rawCommandPublicCatalogSchema.parse(payload)
  const sites = parsed.groups.flatMap((group) =>
    group.apps.flatMap((rawApp) => {
      const app = rawCommandPublicCatalogAppSchema.safeParse(rawApp)
      if (!app.success || !app.data.primaryUrl) return []

      return [
        {
          slug: app.data.slug,
          name: app.data.displayName,
          url: app.data.primaryUrl,
          description:
            app.data.shortDescription ??
            app.data.longDescription ??
            'Public Narduk Enterprises site.',
        },
      ]
    }),
  )

  return resolveNardukNetworkDirectory({ sites }, options)
}
