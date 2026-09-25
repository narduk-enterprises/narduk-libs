/*
 * Server-render proof for NeDataAttribution (narduk-libs#388). The credit is
 * in the first paint, so the relative time has to come out of the server
 * byte-identical to the browser's — which is only true because `now` and the
 * zone are the caller's, never the ambient clock or the host zone.
 */
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'

import NeDataAttribution from '../src/runtime/components/NeDataAttribution.vue'

import type { NeDataAttributionProps } from '../src/runtime/components/ne-data-attribution-types'

it('runs in an environment with no DOM, which is the whole point of this file', () => {
  expect(typeof document).toBe('undefined')
  expect(typeof window).toBe('undefined')
})

function render(props: NeDataAttributionProps): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(NeDataAttribution, props) }))
}

describe('NeDataAttribution server-rendered without a DOM', () => {
  it('carries the source, the link and the relative time into the first paint', async () => {
    const html = await render({
      now: '2026-03-08T12:00:00Z',
      sources: [{ href: 'https://www.ndbc.noaa.gov/', name: 'NOAA NDBC' }],
      timeZone: 'America/Chicago',
      updatedAt: '2026-03-08T09:00:00Z',
    })

    expect(html).toContain('data-ne-data-attribution')
    expect(html).toContain('NOAA NDBC')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('3 hours ago')
    expect(html).toContain('datetime="2026-03-08T09:00:00.000Z"')
  })

  it('renders the same string twice, because nothing reads the clock', async () => {
    const props: NeDataAttributionProps = {
      now: '2026-03-08T12:00:00Z',
      sources: [{ name: 'USGS' }],
      timeZone: 'UTC',
      updatedAt: '2026-03-07T12:00:00Z',
    }
    const first = await render(props)
    const second = await render(props)
    expect(first).toBe(second)
    expect(first).toContain('yesterday')
  })
})
