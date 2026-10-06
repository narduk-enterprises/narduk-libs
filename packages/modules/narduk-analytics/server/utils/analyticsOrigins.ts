/**
 * Origin grouping for the admin Analytics page: where sessions come from.
 *
 * A blank referrer is *unknown* (direct, an app, a stripped header), never
 * "direct". Rows that are unknown carry `unknown: true` so a reader can draw
 * them apart and never fold them into a named channel.
 */

export type AnalyticsOriginDimension =
  'campaigns' | 'channels' | 'countries' | 'landing' | 'referrers'

export const ANALYTICS_ORIGIN_DIMENSIONS: readonly AnalyticsOriginDimension[] = [
  'channels',
  'referrers',
  'campaigns',
  'landing',
  'countries',
]

export type AnalyticsReferrerGroup =
  'AI and answer engines' | 'No referrer' | 'Other' | 'Our own sites' | 'Search engines' | 'Social'

const SEARCH_ENGINES = [
  'google.',
  'bing.com',
  'duckduckgo.com',
  'yahoo.',
  'ecosia.org',
  'brave.com',
  'baidu.com',
  'yandex.',
  'startpage.com',
  'kagi.com',
]

// Checked before search engines: gemini.google.com is an assistant, not search.
const AI_ENGINES = [
  'chatgpt.com',
  'chat.openai.com',
  'perplexity.ai',
  'gemini.google.com',
  'bard.google.com',
  'copilot.microsoft.com',
  'claude.ai',
  'you.com',
  'phind.com',
  'grok.com',
]

const SOCIAL = [
  'facebook.com',
  'fb.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  't.co',
  'linkedin.com',
  'lnkd.in',
  'reddit.com',
  'youtube.com',
  'pinterest.com',
  'tiktok.com',
  'threads.net',
  'bsky.app',
  'mastodon.social',
  'news.ycombinator.com',
]

const OWN_SITES = ['nardukenterprises.com']

// An entry ending in a dot ("google.") names a label with any suffix, so it
// covers every country domain (google.co.uk, uk.search.yahoo.com) but not a
// host that merely contains it (notgoogle.com); any other entry matches the
// host or a subdomain.
const matches = (domain: string, list: readonly string[]) =>
  list.some((item) =>
    item.endsWith('.')
      ? domain.startsWith(item) || domain.includes(`.${item}`)
      : domain === item || domain.endsWith(`.${item}`),
  )

/**
 * What PostHog and browsers write when there was no referrer. `$direct` means
 * only "the browser sent none", which is as often a privacy setting, an app
 * webview or a stripped redirect as a typed URL, so it is unknown, never
 * "direct".
 */
const BLANK_REFERRERS = new Set(['$direct', '(direct)', 'null', 'undefined'])

/**
 * Lowercase host with any scheme, path and leading `www.` removed; `''` when
 * there is none (including PostHog's `$direct`).
 */
export function normalizeReferrerDomain(value: string | null | undefined): string {
  const host = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//u, '')
    .replace(/\/.*$/u, '')
    .replace(/^www\./u, '')
  return BLANK_REFERRERS.has(host) ? '' : host
}

export function classifyReferrerGroup(domain: string, ownHost = ''): AnalyticsReferrerGroup {
  if (!domain) return 'No referrer'
  const own = normalizeReferrerDomain(ownHost)
  if (matches(domain, OWN_SITES) || (own && (domain === own || domain.endsWith(`.${own}`)))) {
    return 'Our own sites'
  }
  if (matches(domain, AI_ENGINES)) return 'AI and answer engines'
  if (matches(domain, SEARCH_ENGINES)) return 'Search engines'
  if (matches(domain, SOCIAL)) return 'Social'
  return 'Other'
}

export type AnalyticsChannel =
  | 'AI assistants'
  | 'Email'
  | 'No referrer (unknown)'
  | 'Organic search'
  | 'Organic social'
  | 'Our own sites'
  | 'Paid'
  | 'Referral'

const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paidsearch', 'paid-search', 'display'])
const EMAIL_MEDIUMS = new Set(['email', 'newsletter', 'e-mail'])
const SOCIAL_MEDIUMS = new Set(['social', 'social-network', 'social-media'])

/** A channel from the landing referrer domain and `utm_medium`. UTM wins over the referrer. */
export function classifyChannel(
  domain: string,
  medium: string | null | undefined,
  ownHost = '',
): AnalyticsChannel {
  const m = String(medium ?? '')
    .trim()
    .toLowerCase()
  if (PAID_MEDIUMS.has(m)) return 'Paid'
  if (EMAIL_MEDIUMS.has(m)) return 'Email'
  if (SOCIAL_MEDIUMS.has(m)) return 'Organic social'
  switch (classifyReferrerGroup(domain, ownHost)) {
    case 'AI and answer engines':
      return 'AI assistants'
    case 'Search engines':
      return 'Organic search'
    case 'Social':
      return 'Organic social'
    case 'Our own sites':
      return 'Our own sites'
    case 'No referrer':
      return 'No referrer (unknown)'
    case 'Other':
      return 'Referral'
  }
}

export interface AnalyticsOriginRow {
  group?: string
  label: string
  other?: boolean
  sessions: number
  /** True for a row that says "we do not know", never a named origin. */
  unknown?: boolean
}

/** Sum rows that share a group and label, largest first. */
export function sumOriginRows(rows: AnalyticsOriginRow[]): AnalyticsOriginRow[] {
  const byLabel = new Map<string, AnalyticsOriginRow>()
  for (const row of rows) {
    const key = `${row.group ?? ''}\u0000${row.label}`
    const found = byLabel.get(key)
    if (found) found.sessions += row.sessions
    else byLabel.set(key, { ...row })
  }
  return [...byLabel.values()].sort((a, b) => b.sessions - a.sessions)
}

/**
 * Keep the top `perGroup` named rows of each group, keep every unknown row,
 * and roll the rest into one "N more" row, so truncation is shown, not hidden.
 */
export function truncateOriginGroups(
  rows: AnalyticsOriginRow[],
  perGroup: number,
): { rows: AnalyticsOriginRow[]; truncated: boolean } {
  const groups = new Map<string, AnalyticsOriginRow[]>()
  for (const row of rows) {
    const key = row.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const out: AnalyticsOriginRow[] = []
  let truncated = false
  for (const [group, list] of groups) {
    const sorted = [...list].sort((a, b) => b.sessions - a.sessions)
    const named = sorted.filter((row) => !row.unknown)
    const keep = named.slice(0, perGroup)
    const rest = named.slice(perGroup)
    out.push(
      ...[...keep, ...sorted.filter((row) => row.unknown)].sort((a, b) => b.sessions - a.sessions),
    )
    if (rest.length > 0) {
      truncated = true
      out.push({
        group: group || undefined,
        label: `${rest.length} more`,
        other: true,
        sessions: rest.reduce((sum, row) => sum + row.sessions, 0),
      })
    }
  }
  return { rows: out, truncated }
}
