const PACKAGE_NAME = '@narduk-enterprises/narduk-seo'

/**
 * Maintained AI-crawler user-agent tokens that `nardukSeo.aiCrawlers` can
 * allow or disallow via @nuxtjs/robots groups. Keep this list in lockstep
 * with the README; apps should import it rather than copy names.
 */
export const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'Google-Extended',
  'PerplexityBot',
  'CCBot',
  'Bytespider',
  'Amazonbot',
  'Applebot-Extended',
  'meta-externalagent',
  'cohere-ai',
] as const

export type AiCrawlerUserAgent = (typeof AI_CRAWLERS)[number]

export interface AiCrawlerLists {
  allow?: readonly string[]
  disallow?: readonly string[]
}

export type AiCrawlersOption = 'allow' | 'disallow' | AiCrawlerLists

export interface AiCrawlerRobotsGroup {
  allow?: string[]
  disallow?: string[]
  userAgent: string[]
}

const knownCrawlers = new Set<string>(AI_CRAWLERS)

function configError(message: string): Error {
  return new Error(`[${PACKAGE_NAME}] ${message}`)
}

function normalizeUserAgentList(value: unknown, field: 'allow' | 'disallow'): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw configError(`nardukSeo.aiCrawlers.${field} must be an array of user-agent names.`)
  }

  const trimmed = value.map((item) => item.trim())
  if (trimmed.some((item) => item.length === 0)) {
    throw configError(`nardukSeo.aiCrawlers.${field} must not contain empty user-agent names.`)
  }

  const unknown = trimmed.filter((item) => !knownCrawlers.has(item))
  if (unknown.length > 0) {
    throw configError(
      `nardukSeo.aiCrawlers.${field} contains unknown crawler(s): ${unknown.join(', ')}. ` +
        `Valid names: ${AI_CRAWLERS.join(', ')}.`,
    )
  }

  return [...new Set(trimmed)]
}

/**
 * Extra @nuxtjs/robots groups for the AI-crawler policy.
 *
 * `'allow'` (the default) returns no groups so existing apps keep the same
 * robots.txt. `'disallow'` emits one group that blocks every known AI crawler.
 * The object form emits groups only for the listed names.
 */
export function resolveAiCrawlerRobotsGroups(option: unknown = 'allow'): AiCrawlerRobotsGroup[] {
  if (option === undefined || option === 'allow') return []

  if (option === 'disallow') {
    return [{ userAgent: [...AI_CRAWLERS], disallow: ['/'] }]
  }

  if (!option || typeof option !== 'object' || Array.isArray(option)) {
    throw configError("nardukSeo.aiCrawlers must be 'allow', 'disallow', or { allow, disallow }.")
  }

  const lists = option as AiCrawlerLists
  const allow = normalizeUserAgentList(lists.allow, 'allow')
  const disallow = normalizeUserAgentList(lists.disallow, 'disallow')
  const overlap = allow.filter((userAgent) => disallow.includes(userAgent))
  if (overlap.length > 0) {
    throw configError(
      `nardukSeo.aiCrawlers lists both allow and disallow for: ${overlap.join(', ')}.`,
    )
  }

  const groups: AiCrawlerRobotsGroup[] = []
  if (disallow.length > 0) groups.push({ userAgent: disallow, disallow: ['/'] })
  if (allow.length > 0) groups.push({ userAgent: allow, allow: ['/'] })
  return groups
}

export function mergeAiCrawlerRobotsGroups(
  robots: Record<string, unknown>,
  option: unknown,
): Record<string, unknown> {
  const extraGroups = resolveAiCrawlerRobotsGroups(option)
  if (extraGroups.length === 0) return robots

  const existingGroups = Array.isArray(robots.groups) ? robots.groups : []
  return {
    ...robots,
    groups: [...existingGroups, ...extraGroups],
  }
}
