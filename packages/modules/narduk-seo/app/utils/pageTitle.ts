/**
 * The page-title rule `usePageSeo` applies, kept pure so it can be tested (and
 * reused for a `<title>` built outside a page) without a Nuxt app.
 *
 * `Trades · Stonx`: the page, a separator, the site. Three cases are not a
 * plain join:
 *
 * - No page title (the home page): the site name alone, not `· Stonx`.
 * - The title already names the site (`Stonx rules`, `Stonx`): left as written,
 *   never `Stonx rules · Stonx`. The match is case-insensitive.
 * - No site name configured: the page title alone.
 */

/** The house separator: a middle dot, spaced. */
export const PAGE_TITLE_SEPARATOR = '·'

export interface PageTitleOptions {
  /** What goes between the page and the site. Default `·`. */
  separator?: string
  /** The site name; usually `useSiteConfig().name`. */
  siteName?: string
}

function clean(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildPageTitle(
  title: string | null | undefined,
  options: PageTitleOptions = {},
): string {
  const page = clean(title ?? undefined)
  const site = clean(options.siteName)
  if (!page) return site
  if (!site) return page
  if (page.toLowerCase().includes(site.toLowerCase())) return page
  const separator = clean(options.separator) || PAGE_TITLE_SEPARATOR
  return `${page} ${separator} ${site}`
}
