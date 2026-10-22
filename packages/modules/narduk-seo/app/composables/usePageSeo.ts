import { useHead, useRuntimeConfig, useSiteConfig } from '#imports'

import { buildPageTitle } from '../utils/pageTitle'

import { useSeo } from './useSeo'

import type { SeoOptions } from './useSeo'

export interface PageSeoOptions extends SeoOptions {
  /** What goes between the page title and the site name. Default `·`. */
  titleSeparator?: string
  /**
   * `false` leaves the browser title as the bare `title`, with no site name:
   * for a page whose title already is the whole line (the home page, a
   * campaign page). Default: the site name is appended.
   */
  titleSuffix?: false
}

/**
 * `useSeo` plus the house browser title: `Trades · Stonx`.
 *
 * ```ts
 * usePageSeo({ title: 'Trades', description: 'Every fill in this game.' })
 * // <title>Trades · Stonx</title>, og:title "Trades"
 * ```
 *
 * The site name comes from the site config (`nuxt-site-config`, or
 * `runtimeConfig.public.appName` as `useSeo` already falls back to). Only the
 * browser `<title>` carries the suffix: `og:title`, the generated share card
 * and the description stay the page's own words, since a share preview already
 * names the site beside the title.
 *
 * A title that already names the site is not suffixed again, an empty title
 * yields the site name alone, and `titleSuffix: false` turns the suffix off.
 * See `buildPageTitle` for the exact rule. Everything else is `useSeo`.
 */
export function usePageSeo(options: PageSeoOptions) {
  const { titleSeparator, titleSuffix, ...seo } = options
  useSeo(seo)
  if (titleSuffix === false) return

  const siteConfig = useSiteConfig()
  const runtimeConfig = useRuntimeConfig()
  const siteName =
    (typeof siteConfig.name === 'string' && siteConfig.name) ||
    (typeof runtimeConfig.public.appName === 'string' ? runtimeConfig.public.appName : undefined)

  // A function template receives the page's current title, so a reactive
  // `title` getter, or a later `useHead({ title })`, still updates the browser
  // title.
  useHead({
    titleTemplate: (title?: string) =>
      buildPageTitle(title, { siteName, separator: titleSeparator }),
  })
}
