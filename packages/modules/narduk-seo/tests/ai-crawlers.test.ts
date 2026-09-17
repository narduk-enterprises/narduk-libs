import { describe, expect, it } from 'vitest'

import {
  AI_CRAWLERS,
  mergeAiCrawlerRobotsGroups,
  resolveAiCrawlerRobotsGroups,
} from '../shared/aiCrawlers'

describe('AI_CRAWLERS', () => {
  it('exports the maintained AI-crawler user-agent list', () => {
    expect([...AI_CRAWLERS]).toEqual([
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
    ])
  })
})

describe('resolveAiCrawlerRobotsGroups', () => {
  it('emits no groups for the default allow policy', () => {
    expect(resolveAiCrawlerRobotsGroups()).toEqual([])
    expect(resolveAiCrawlerRobotsGroups(undefined)).toEqual([])
    expect(resolveAiCrawlerRobotsGroups('allow')).toEqual([])
  })

  it('disallows every known AI crawler', () => {
    expect(resolveAiCrawlerRobotsGroups('disallow')).toEqual([
      { userAgent: [...AI_CRAWLERS], disallow: ['/'] },
    ])
  })

  it('emits groups only for the listed allow and disallow names', () => {
    expect(
      resolveAiCrawlerRobotsGroups({
        allow: ['GPTBot', 'OAI-SearchBot'],
        disallow: ['CCBot', 'Bytespider'],
      }),
    ).toEqual([
      { userAgent: ['CCBot', 'Bytespider'], disallow: ['/'] },
      { userAgent: ['GPTBot', 'OAI-SearchBot'], allow: ['/'] },
    ])
  })

  it('treats a missing list as empty', () => {
    expect(resolveAiCrawlerRobotsGroups({ disallow: ['GPTBot'] })).toEqual([
      { userAgent: ['GPTBot'], disallow: ['/'] },
    ])
    expect(resolveAiCrawlerRobotsGroups({ allow: ['GPTBot'] })).toEqual([
      { userAgent: ['GPTBot'], allow: ['/'] },
    ])
    expect(resolveAiCrawlerRobotsGroups({ allow: [], disallow: [] })).toEqual([])
  })

  it('rejects unknown, overlapping, or malformed lists', () => {
    expect(() => resolveAiCrawlerRobotsGroups('Allow')).toThrow(
      /must be 'allow', 'disallow', or \{ allow, disallow \}/u,
    )
    expect(() => resolveAiCrawlerRobotsGroups({ disallow: ['GPTBot', 'NotABot'] })).toThrow(
      /unknown crawler\(s\): NotABot/u,
    )
    expect(() => resolveAiCrawlerRobotsGroups({ allow: ['GPTBot'], disallow: ['GPTBot'] })).toThrow(
      /both allow and disallow for: GPTBot/u,
    )
    expect(() => resolveAiCrawlerRobotsGroups({ allow: 'GPTBot' })).toThrow(
      /aiCrawlers\.allow must be an array/u,
    )
    expect(() => resolveAiCrawlerRobotsGroups({ disallow: [''] })).toThrow(
      /must not contain empty user-agent names/u,
    )
  })
})

describe('mergeAiCrawlerRobotsGroups', () => {
  const productionRobots = {
    disallowNonIndexableRoutes: false,
    disallow: ['/admin/'],
  }

  it('leaves existing robots options untouched when the policy is allow', () => {
    expect(mergeAiCrawlerRobotsGroups(productionRobots, 'allow')).toBe(productionRobots)
    expect(mergeAiCrawlerRobotsGroups(productionRobots, 'allow')).toEqual(productionRobots)
  })

  it('appends AI groups onto an app-supplied groups list', () => {
    const robots = {
      ...productionRobots,
      groups: [{ userAgent: ['BadBot'], disallow: ['/'] }],
    }

    expect(mergeAiCrawlerRobotsGroups(robots, 'disallow')).toEqual({
      ...robots,
      groups: [
        { userAgent: ['BadBot'], disallow: ['/'] },
        { userAgent: [...AI_CRAWLERS], disallow: ['/'] },
      ],
    })
  })
})
