/**
 * `NeDataAttribution`'s caller-built shapes (narduk-libs#388).
 *
 * Kept in a plain module so the package root can re-export them as type-only
 * exports without compiling the SFC.
 *
 * `NeDataSource` is structural on purpose. The issue asks for a credit driven
 * by `narduk-data` manifest metadata (a source and a publish time), and this
 * package does not depend on `narduk-data` or on narduk-core's server client:
 * a caller maps its own manifest — `NardukDataFreshness.observedAt` or
 * `evaluatedAt`, a product's display name and licence — onto these four
 * fields. Anything with a `name` and an optional time already fits.
 */
import type { NeDateInput } from '../../format'

/** A licence, as a bare name (`'CC0'`) or a name with the licence's own page. */
export type NeDataLicense = string | { name: string; href?: string }

/** One upstream the page's data came from. */
export interface NeDataSource {
  /** Display name, e.g. `NOAA NDBC`. Always rendered as text. */
  name: string
  /**
   * The source's own page. Only an absolute `http:` / `https:` URL becomes a
   * link; anything else (`javascript:`, `data:`, a relative path) renders the
   * name as plain text, because an attribution href usually comes from data
   * rather than from the app's own code.
   */
  href?: string
  /** The data's licence, shown in parentheses after the name. */
  license?: NeDataLicense
  /**
   * When this source's data was published. Set it when sources update on
   * different clocks; it is shown beside this source. Otherwise use the
   * component's shared `updatedAt`.
   */
  updatedAt?: NeDateInput
}

export interface NeDataAttributionProps {
  /** One source or several. Several are joined as `A, B and C`. */
  sources: NeDataSource | readonly NeDataSource[]
  /**
   * IANA zone every time is formatted in. **Required**, like every date in
   * `./format`: a credit rendered in the host zone differs between the Worker
   * and the browser and fails hydration.
   */
  timeZone: string
  /**
   * The instant to measure against. Set it for a relative time
   * (`updated 3 hours ago`); omit it for an absolute one
   * (`updated Mar 8, 2026, 3:30 AM`). Never read from the ambient clock.
   */
  now?: NeDateInput
  /** One publish time for all the sources, shown once at the end. */
  updatedAt?: NeDateInput
  /** The lead-in. Defaults to `Data from`. */
  label?: string
  /**
   * Open source and licence links in a new tab (`target="_blank"`). Off by
   * default; `rel="noopener noreferrer"` is set on every link either way.
   */
  newTab?: boolean
}

const EXTERNAL_HREF = /^https?:\/\//i

/**
 * The href to render as a link, or `undefined` for one that must stay text.
 * `URL` parsing rather than a prefix test alone, so a malformed value such as
 * `https://` with no host is refused too.
 */
export function safeAttributionHref(href: string | undefined): string | undefined {
  if (!href || !EXTERNAL_HREF.test(href.trim())) return undefined
  try {
    const url = new URL(href.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}
