import type { SitemapUrl } from '@nuxtjs/sitemap'

export type SitemapChangefreq = NonNullable<SitemapUrl['changefreq']>
export type SitemapPriority = NonNullable<SitemapUrl['priority']>

type ItemValue<T, V> = V | ((item: T, index: number) => V | null | undefined)

export interface SitemapUrlsFromListingOptions<T> {
  /** `<changefreq>` for every row, or a per-item builder. */
  changefreq?: ItemValue<T, SitemapChangefreq>
  /**
   * The item's last-modified time. Dates and epoch milliseconds become ISO
   * strings; strings pass through trimmed. Missing or unparseable values are
   * omitted rather than emitted as an invalid `<lastmod>`.
   */
  lastmod?: (item: T, index: number) => Date | string | number | null | undefined
  /**
   * Builds the URL for one listing item: a site-relative path (`/buoys/42`) or
   * an absolute URL. A blank, `null` or `undefined` result drops the item.
   */
  loc: (item: T, index: number) => string | null | undefined
  /** `<priority>` for every row, or a per-item builder. */
  priority?: ItemValue<T, SitemapPriority>
}

function resolveItemValue<T, V>(
  value: ItemValue<T, V> | undefined,
  item: T,
  index: number,
): V | undefined {
  const resolved =
    typeof value === 'function' ? (value as (item: T, index: number) => V)(item, index) : value
  return resolved ?? undefined
}

function normalizeLastmod(value: Date | string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || Number.isNaN(Date.parse(trimmed))) return undefined
    return trimmed
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * Turns a listing of entities (products, articles, buoys, ...) into
 * `@nuxtjs/sitemap` URL rows, for a sitemap source handler or the `urls`
 * option. Pure and config-safe: no Nuxt or Nitro imports.
 *
 * Rows keep input order. Items whose `loc` builder returns a blank value are
 * skipped, and a repeated `loc` keeps its first row, so an entity listed
 * twice (say, under two categories) is emitted once.
 */
export function sitemapUrlsFromListing<T>(
  items: Iterable<T> | null | undefined,
  options: SitemapUrlsFromListingOptions<T>,
): SitemapUrl[] {
  if (!items) return []

  const rows: SitemapUrl[] = []
  const seen = new Set<string>()
  let index = 0

  for (const item of items) {
    const itemIndex = index++
    const loc = options.loc(item, itemIndex)?.trim()
    if (!loc || seen.has(loc)) continue
    seen.add(loc)

    const row: SitemapUrl = { loc }
    const lastmod = options.lastmod ? normalizeLastmod(options.lastmod(item, itemIndex)) : undefined
    if (lastmod) row.lastmod = lastmod
    const changefreq = resolveItemValue(options.changefreq, item, itemIndex)
    if (changefreq) row.changefreq = changefreq
    const priority = resolveItemValue(options.priority, item, itemIndex)
    if (priority !== undefined) row.priority = priority

    rows.push(row)
  }

  return rows
}
