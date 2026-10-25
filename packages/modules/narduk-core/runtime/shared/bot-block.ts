/**
 * Default-on block for SEO, backlink and scraper crawlers.
 *
 * The same list drives two things: the `00-0-bot-block` server middleware
 * (a 403 before any render) and narduk-seo's robots.txt (`Disallow: /` groups,
 * so a compliant crawler stops asking). It lives here, in the lowest package
 * both already depend on, and is imported rather than copied.
 *
 * This file imports nothing from Nitro or Nuxt: it is read at build time by
 * narduk-seo and at request time by the middleware.
 */

/**
 * User-agent tokens of crawlers that sell SEO, backlink or scraping data and
 * send an app's visitors nothing. Each unmatched request still pays for a full
 * SSR render (roughly 300-600 ms of Worker CPU), which on riverstat.us over
 * 2026-10-17..18 was 54% of 61.6k requests: SemrushBot 22.5k, AhrefsBot 3.8k,
 * MJ12bot 3.4k, DotBot 1.7k, SERankingBacklinksBot 0.7k, MochiImageCrawler 0.3k.
 * AionBot was about 43k requests a day on austin-texas-net from 2026-10-22
 * (measured 2026-10-25), crawling uncached server-rendered HTML at about 128 ms
 * of Worker CPU a render; it is part of the 80% of that app's Workers CPU that
 * crawlers spent.
 *
 * Matching is a case-insensitive substring of the User-Agent header.
 *
 * Deliberately NOT here: search engines (Googlebot, Google-*, bingbot,
 * Applebot, DuckDuckBot), social preview fetchers (facebookexternalhit,
 * Twitterbot, Slackbot, Discordbot, LinkedInBot), uptime monitors and
 * scripts. AI and answer-engine crawlers (GPTBot, ClaudeBot, ExaSearchBot,
 * PerplexityBot, ...) stay governed by narduk-seo's `aiCrawlers` option;
 * Bytespider is the one name in both lists, and `aiCrawlers.allow` wins over
 * this list in robots.txt.
 */
export const DEFAULT_BLOCKED_BOTS = [
  'SemrushBot',
  'AhrefsBot',
  'MJ12bot',
  'DotBot',
  'SERankingBacklinksBot',
  'DataForSeoBot',
  'BLEXBot',
  'Barkrowler',
  'serpstatbot',
  'PetalBot',
  'Bytespider',
  'MochiImageCrawler',
  'SeekportBot',
  'MegaIndex',
  'Linkdex',
  'AwarioBot',
  'ImagesiftBot',
  'Timpibot',
  'AionBot',
] as const

/** `nardukCore.botBlock`. */
export interface BotBlockOptions {
  /** User-agent substrings to let through even when a listed name matches. */
  allow?: string[]
  /** Default `true`. `false` turns the middleware and the robots.txt groups off. */
  enabled?: boolean
  /** More user-agent substrings to block, on top of `DEFAULT_BLOCKED_BOTS`. */
  extra?: string[]
}

export interface ResolvedBotBlock {
  allow: string[]
  enabled: boolean
  extra: string[]
}

function toTokenList(value: unknown, field: 'allow' | 'extra'): string[] {
  if (value === undefined || value === null || value === '') return []
  const list = typeof value === 'string' ? value.split(',') : value
  if (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`[narduk-core] nardukCore.botBlock.${field} must be an array of strings.`)
  }
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const entry of list as string[]) {
    const token = entry.trim()
    if (!token || seen.has(token.toLowerCase())) continue
    seen.add(token.toLowerCase())
    tokens.push(token)
  }
  return tokens
}

function toEnabled(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true
  if (typeof value === 'boolean') return value
  if (typeof value === 'string')
    return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
  return Boolean(value)
}

/** Normalise the option (or the runtime-config copy of it). Throws on a wrong shape. */
export function resolveBotBlockOptions(input?: unknown): ResolvedBotBlock {
  if (input === false) return { allow: [], enabled: false, extra: [] }
  if (input === undefined || input === null || input === true) {
    return { allow: [], enabled: true, extra: [] }
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('[narduk-core] nardukCore.botBlock must be a boolean or an options object.')
  }
  const options = input as Record<string, unknown>
  return {
    allow: toTokenList(options.allow, 'allow'),
    enabled: toEnabled(options.enabled),
    extra: toTokenList(options.extra, 'extra'),
  }
}

/**
 * The user-agent names this configuration blocks: defaults plus `extra`, minus
 * any name `allow` lists. Empty when disabled. Used for robots.txt groups.
 */
export function blockedBotNames(input?: unknown): string[] {
  const resolved = resolveBotBlockOptions(input)
  if (!resolved.enabled) return []
  const allowed = new Set(resolved.allow.map((token) => token.toLowerCase()))
  const seen = new Set<string>()
  const names: string[] = []
  for (const name of [...DEFAULT_BLOCKED_BOTS, ...resolved.extra]) {
    const key = name.toLowerCase()
    if (allowed.has(key) || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/**
 * A matcher over a User-Agent header value. An empty or missing User-Agent
 * never matches, and a User-Agent containing an `allow` token never matches.
 */
export function createBotMatcher(input?: unknown): (userAgent: string | undefined) => boolean {
  const resolved = resolveBotBlockOptions(input)
  if (!resolved.enabled) return () => false
  const blocked = blockedBotNames(resolved).map((name) => name.toLowerCase())
  const allowed = resolved.allow.map((token) => token.toLowerCase())
  return (userAgent) => {
    if (!userAgent) return false
    const ua = userAgent.toLowerCase()
    if (allowed.some((token) => ua.includes(token))) return false
    return blocked.some((name) => ua.includes(name))
  }
}
