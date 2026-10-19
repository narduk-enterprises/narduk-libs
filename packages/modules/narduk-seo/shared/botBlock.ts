import { blockedBotNames } from '@narduk-enterprises/narduk-core/shared/bot-block'

/**
 * Append `Disallow: /` groups for narduk-core's default-blocked SEO, backlink
 * and scraper crawlers (`DEFAULT_BLOCKED_BOTS`), so a compliant crawler stops
 * asking before narduk-core's `00-0-bot-block` middleware has to refuse it.
 *
 * `botBlock` is the app's `nardukCore.botBlock` option, so one switch governs
 * the 403 and the robots.txt: `false` or `{ enabled: false }` emits nothing,
 * `extra` adds names, `allow` removes them.
 *
 * A name already in a group (an `aiCrawlers` allow or disallow, or a group the
 * app wrote) is left to that group: two groups naming one crawler is ambiguous
 * under RFC 9309, and the app's explicit choice wins over the default.
 */
export function mergeBotBlockRobotsGroups(
  robots: Record<string, unknown>,
  botBlock: unknown,
): Record<string, unknown> {
  const existingGroups = Array.isArray(robots.groups) ? robots.groups : []
  const named = new Set<string>()
  for (const group of existingGroups) {
    const userAgent = (group as { userAgent?: unknown } | null)?.userAgent
    for (const name of Array.isArray(userAgent) ? userAgent : [userAgent]) {
      if (typeof name === 'string') named.add(name.toLowerCase())
    }
  }

  const names = blockedBotNames(botBlock).filter((name) => !named.has(name.toLowerCase()))
  if (names.length === 0) return robots

  return {
    ...robots,
    groups: [...existingGroups, { userAgent: names, disallow: ['/'] }],
  }
}
