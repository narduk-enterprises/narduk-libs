/*
 * Server-render proof for NeRelativeTime: no DOM, no timer. The server renders
 * the whole <time> -- datetime, tooltip and text -- from a clock it reads once,
 * and starts no interval (there is no window to tick in).
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeRelativeTime from '../src/runtime/components/NeRelativeTime.vue'
import { timeAgoSubscriberCount } from '../src/runtime/composables/use-time-ago'

import type { NeRelativeTimeProps } from '../src/runtime/components/ne-relative-time-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeRelativeTimeProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeRelativeTime, props) }))
}

const base = { timeZone: 'America/Chicago', now: '2026-03-08T20:30:00Z' }

describe('NeRelativeTime server rendering', () => {
  it('renders the time element complete in the first paint', async () => {
    const html = await render({ ...base, value: '2026-03-08T20:12:00Z' })

    expect(html).toContain('<time')
    expect(html).toContain('datetime="2026-03-08T20:12:00.000Z"')
    expect(html).toContain('title="Mar 8, 2026, 3:12 PM CDT"')
    expect(html).toContain('>18 minutes ago</time>')
    expect(html).toContain('data-allow-mismatch="text"')
  })

  it('renders a date after a week', async () => {
    expect(await render({ ...base, value: '2026-02-20T20:30:00Z' })).toContain(
      '>Feb 20, 2026</time>',
    )
  })

  it('renders the empty text with no datetime for a missing value', async () => {
    const html = await render({ ...base, value: undefined })
    expect(html).toContain('>—</time>')
    expect(html).not.toContain('datetime=')
  })

  it('renders from the ambient clock when no `now` is given, and starts no ticker', async () => {
    const html = await render({ timeZone: 'UTC', value: Date.now() - 3 * 3_600_000 })
    expect(html).toContain('>3 hours ago</time>')
    expect(timeAgoSubscriberCount()).toBe(0)
  })

  it('renders the same string twice', async () => {
    const props = { ...base, value: '2026-03-08T20:12:00Z' }
    expect(await render(props)).toBe(await render(props))
  })
})
