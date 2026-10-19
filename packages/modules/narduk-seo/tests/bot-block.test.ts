import { DEFAULT_BLOCKED_BOTS } from '@narduk-enterprises/narduk-core/shared/bot-block'
import { describe, expect, it } from 'vitest'

import { mergeBotBlockRobotsGroups, readCoreBotBlockOption } from '../shared/botBlock'

const robots = { disallow: ['/admin'], groups: [{ userAgent: ['GPTBot'], disallow: ['/'] }] }

describe('mergeBotBlockRobotsGroups', () => {
  it('appends one Disallow: / group for the default list', () => {
    const merged = mergeBotBlockRobotsGroups({ disallow: ['/admin'] }, undefined)

    expect(merged).toEqual({
      disallow: ['/admin'],
      groups: [{ userAgent: [...DEFAULT_BLOCKED_BOTS], disallow: ['/'] }],
    })
  })

  it('keeps the existing groups ahead of its own', () => {
    const merged = mergeBotBlockRobotsGroups(robots, true) as {
      groups: Array<{ userAgent: string[] }>
    }

    expect(merged.groups[0]).toEqual(robots.groups[0])
    expect(merged.groups[1]?.userAgent).toContain('SemrushBot')
  })

  it('emits nothing when disabled', () => {
    expect(mergeBotBlockRobotsGroups(robots, false)).toBe(robots)
    expect(mergeBotBlockRobotsGroups(robots, { enabled: false })).toBe(robots)
  })

  it('adds extra names and drops allowed ones', () => {
    const merged = mergeBotBlockRobotsGroups(
      {},
      { extra: ['NewSeoSpider'], allow: ['ahrefsbot'] },
    ) as {
      groups: Array<{ userAgent: string[] }>
    }
    const names = merged.groups[0]?.userAgent ?? []

    expect(names).toContain('NewSeoSpider')
    expect(names).not.toContain('AhrefsBot')
  })

  it('leaves a name another group already names to that group, case-insensitively', () => {
    const merged = mergeBotBlockRobotsGroups(
      { groups: [{ userAgent: ['bytespider'], allow: ['/'] }] },
      undefined,
    ) as { groups: Array<{ userAgent: string[] }> }

    expect(merged.groups[1]?.userAgent).not.toContain('Bytespider')
    expect(merged.groups[1]?.userAgent).toContain('SemrushBot')
  })
})

describe('readCoreBotBlockOption', () => {
  it('reads nardukCore.botBlock', () => {
    expect(readCoreBotBlockOption({ nardukCore: { botBlock: false } })).toBe(false)
    expect(readCoreBotBlockOption({})).toBeUndefined()
  })

  it('prefers an inline narduk-core module option, as core does', () => {
    const inline = { extra: ['X'] }
    expect(
      readCoreBotBlockOption({
        modules: ['other', ['@narduk-enterprises/narduk-core/nuxt', { botBlock: inline }]],
        nardukCore: { botBlock: false },
      }),
    ).toBe(inline)
    expect(
      readCoreBotBlockOption({
        modules: [['@narduk-enterprises/narduk-core', { botBlock: false }]],
      }),
    ).toBe(false)
  })

  it('ignores other modules and bare module names', () => {
    expect(
      readCoreBotBlockOption({
        modules: [
          '@narduk-enterprises/narduk-core',
          ['@narduk-enterprises/narduk-seo', { botBlock: false }],
        ],
        nardukCore: { botBlock: { extra: ['Y'] } },
      }),
    ).toEqual({ extra: ['Y'] })
  })
})
