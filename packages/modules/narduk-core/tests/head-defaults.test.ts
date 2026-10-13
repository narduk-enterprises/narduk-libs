import { describe, expect, it } from 'vitest'

import {
  applyHeadDefaults,
  type HeadOptionsLike,
  MOBILE_VIEWPORT,
  NUXT_DEFAULT_VIEWPORT,
} from '../src/head-defaults'

/** Mobile web QA rules 2, 5, 13, 16, 20: the head every app inherits. */

const metaNamed = (head: HeadOptionsLike | undefined, name: string) =>
  (head?.meta ?? []).filter((entry) => entry.name === name)

describe('applyHeadDefaults', () => {
  it('sets viewport-fit=cover with no zoom lock on a stock Nuxt viewport', () => {
    const app = { head: { viewport: NUXT_DEFAULT_VIEWPORT } }
    applyHeadDefaults(app)

    expect(app.head.viewport).toBe(MOBILE_VIEWPORT)
    expect(app.head.viewport).not.toMatch(/maximum-scale|user-scalable/)
  })

  it('adds color-scheme, both theme-colors, format-detection and the apple meta', () => {
    const app: { head?: HeadOptionsLike } = {}
    applyHeadDefaults(app)

    expect(metaNamed(app.head, 'color-scheme')[0]?.content).toBe('light dark')
    expect(metaNamed(app.head, 'theme-color').map((entry) => entry.media)).toEqual([
      '(prefers-color-scheme: light)',
      '(prefers-color-scheme: dark)',
    ])
    expect(metaNamed(app.head, 'format-detection')[0]?.content).toBe('telephone=no')
    expect(metaNamed(app.head, 'apple-mobile-web-app-capable')[0]?.content).toBe('yes')
    expect(metaNamed(app.head, 'apple-mobile-web-app-status-bar-style')).toHaveLength(1)
  })

  it('keeps an app viewport and any meta the app already set', () => {
    const app = {
      head: {
        viewport: 'width=device-width, initial-scale=1, viewport-fit=contain',
        meta: [
          { name: 'theme-color', content: '#123456' },
          { name: 'color-scheme', content: 'dark' },
        ],
      },
    }
    applyHeadDefaults(app)

    expect(app.head.viewport).toBe('width=device-width, initial-scale=1, viewport-fit=contain')
    expect(metaNamed(app.head, 'theme-color')).toEqual([
      { name: 'theme-color', content: '#123456' },
    ])
    expect(metaNamed(app.head, 'color-scheme')[0]?.content).toBe('dark')
    expect(metaNamed(app.head, 'format-detection')).toHaveLength(1)
  })

  it('adds nothing when switched off', () => {
    const app: { head?: HeadOptionsLike } = {}
    applyHeadDefaults(app, false)

    expect(app.head).toBeUndefined()
  })

  it('is idempotent', () => {
    const app: { head?: HeadOptionsLike } = {}
    applyHeadDefaults(app)
    const once = JSON.stringify(app)
    applyHeadDefaults(app)

    expect(JSON.stringify(app)).toBe(once)
  })
})
