import { describe, expect, it } from 'vitest'

import { classifyTrackingHealth } from '../server/utils/analyticsHealth'
import {
  classifyChannel,
  classifyReferrerGroup,
  normalizeReferrerDomain,
  sumOriginRows,
  truncateOriginGroups,
} from '../server/utils/analyticsOrigins'

const SEARCH = 'Search engines'

describe('referrers', () => {
  it('lowercases and drops www', () => {
    expect(normalizeReferrerDomain(' WWW.Google.COM ')).toBe('google.com')
    expect(normalizeReferrerDomain(null)).toBe('')
  })

  it('groups search, AI engines, social and our own sites', () => {
    expect(classifyReferrerGroup('google.co.uk')).toBe(SEARCH)
    expect(classifyReferrerGroup('duckduckgo.com')).toBe(SEARCH)
    expect(classifyReferrerGroup('chatgpt.com')).toBe('AI and answer engines')
    expect(classifyReferrerGroup('perplexity.ai')).toBe('AI and answer engines')
    expect(classifyReferrerGroup('m.facebook.com')).toBe('Social')
    expect(classifyReferrerGroup('ops.nardukenterprises.com')).toBe('Our own sites')
    expect(classifyReferrerGroup('example.org')).toBe('Other')
  })

  it('files an AI assistant on a Google host under AI, not search', () => {
    expect(classifyReferrerGroup('gemini.google.com')).toBe('AI and answer engines')
  })

  it("treats the app's own host as its own site", () => {
    expect(classifyReferrerGroup('farm.example', 'www.farm.example')).toBe('Our own sites')
    expect(classifyReferrerGroup('app.farm.example', 'farm.example')).toBe('Our own sites')
  })

  it('does not match a look-alike suffix', () => {
    expect(classifyReferrerGroup('notnardukenterprises.com')).toBe('Other')
    expect(classifyReferrerGroup('evil-x.com')).toBe('Other')
  })

  it('does not read a host that merely contains a search label as that engine', () => {
    expect(classifyReferrerGroup('notgoogle.com')).toBe('Other')
    expect(classifyReferrerGroup('uk.search.yahoo.com')).toBe(SEARCH)
    expect(classifyReferrerGroup('yandex.com')).toBe(SEARCH)
  })

  it('knows the hosts the operator portal grouped on its own', () => {
    expect(classifyReferrerGroup('bard.google.com')).toBe('AI and answer engines')
    expect(classifyReferrerGroup('fb.com')).toBe('Social')
    expect(classifyReferrerGroup('mastodon.social')).toBe('Social')
    expect(classifyReferrerGroup('search.brave.com')).toBe(SEARCH)
  })

  it("reads PostHog's $direct and a full URL as what they are", () => {
    for (const blank of ['$direct', '(direct)', 'null', 'undefined', '  ']) {
      expect(normalizeReferrerDomain(blank)).toBe('')
    }
    expect(normalizeReferrerDomain('https://www.Reddit.com/r/x?y=1')).toBe('reddit.com')
    expect(classifyChannel(normalizeReferrerDomain('$direct'), '')).toBe('No referrer (unknown)')
  })

  it('never calls a blank referrer direct', () => {
    expect(classifyReferrerGroup('')).toBe('No referrer')
    expect(classifyChannel('', '')).toBe('No referrer (unknown)')
    expect(classifyChannel('', null)).not.toMatch(/direct/iu)
  })
})

describe('channels', () => {
  it('lets utm_medium win over the referrer', () => {
    expect(classifyChannel('google.com', 'cpc')).toBe('Paid')
    expect(classifyChannel('news.ycombinator.com', 'email')).toBe('Email')
    expect(classifyChannel('', 'social')).toBe('Organic social')
  })

  it('names the rest from the referrer', () => {
    expect(classifyChannel('google.com', '')).toBe('Organic search')
    expect(classifyChannel('claude.ai', '')).toBe('AI assistants')
    expect(classifyChannel('reddit.com', '')).toBe('Organic social')
    expect(classifyChannel('blog.example', '')).toBe('Referral')
  })
})

describe('origin rows', () => {
  it('sums rows that share a group and label, largest first', () => {
    expect(
      sumOriginRows([
        { label: 'a', sessions: 2 },
        { label: 'b', sessions: 5 },
        { label: 'a', sessions: 4 },
        { group: 'g', label: 'a', sessions: 1 },
      ]),
    ).toEqual([
      { label: 'a', sessions: 6 },
      { label: 'b', sessions: 5 },
      { group: 'g', label: 'a', sessions: 1 },
    ])
  })

  it('shows truncation: the tail is folded into one counted row, unknown rows stay', () => {
    const rows = [
      { label: 'a', sessions: 9 },
      { label: 'b', sessions: 7 },
      { label: 'c', sessions: 3 },
      { label: 'd', sessions: 2 },
      { label: 'No referrer (unknown)', sessions: 40, unknown: true },
    ]
    const { rows: kept, truncated } = truncateOriginGroups(rows, 2)
    expect(truncated).toBe(true)
    expect(kept).toEqual([
      { label: 'No referrer (unknown)', sessions: 40, unknown: true },
      { label: 'a', sessions: 9 },
      { label: 'b', sessions: 7 },
      { group: undefined, label: '2 more', other: true, sessions: 5 },
    ])
    expect(kept.reduce((sum, row) => sum + row.sessions, 0)).toBe(61)
  })

  it('reports no truncation when everything fits, and truncates per group', () => {
    expect(truncateOriginGroups([{ label: 'a', sessions: 1 }], 5).truncated).toBe(false)
    const grouped = truncateOriginGroups(
      [
        { group: 'x', label: 'x1', sessions: 3 },
        { group: 'x', label: 'x2', sessions: 2 },
        { group: 'y', label: 'y1', sessions: 1 },
      ],
      1,
    )
    expect(grouped.rows.map((row) => row.label)).toEqual(['x1', '1 more', 'y1'])
  })
})

describe('classifyTrackingHealth', () => {
  const NOW = Date.UTC(2026, 9, 5, 18, 0, 0)
  const DAY = 86_400_000
  const input = (over: Partial<Parameters<typeof classifyTrackingHealth>[0]>) => ({
    events28d: 840,
    events7d: 210,
    lastEventMs: NOW - 60_000,
    markedEvents28d: 0,
    nowMs: NOW,
    ...over,
  })

  it('is silent with no events in 28 days, and says so rather than reading as tracking', () => {
    const health = classifyTrackingHealth(input({ events28d: 0, events7d: 0, lastEventMs: null }))
    expect(health.state).toBe('silent')
    expect(health.markedShare).toBeNull()
    expect(health.lastEventAt).toBeNull()
  })

  it('is tracking on a steady rate', () => {
    const health = classifyTrackingHealth(input({}))
    expect(health.state).toBe('tracking')
    expect(health.recentPerDay).toBe(30)
    expect(health.baselinePerDay).toBe(30)
  })

  it("flags a sharp drop against the app's own baseline", () => {
    expect(classifyTrackingHealth(input({ events28d: 840, events7d: 70 })).state).toBe('drop')
  })

  it('flags a quiet app that stopped for over two days', () => {
    expect(classifyTrackingHealth(input({ lastEventMs: NOW - 3 * DAY })).state).toBe('quiet')
  })

  it('does not call a tiny site quiet: its baseline is too thin to judge', () => {
    expect(
      classifyTrackingHealth(input({ events28d: 20, events7d: 1, lastEventMs: NOW - 5 * DAY }))
        .state,
    ).toBe('tracking')
  })

  it('reports the marker coverage as a share', () => {
    expect(classifyTrackingHealth(input({ markedEvents28d: 210 })).markedShare).toBe(0.25)
  })
})
